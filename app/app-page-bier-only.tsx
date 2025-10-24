'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'

type PopupData = { title: string; message: string; onConfirm: () => void }
type Toast = { id: number; text: string; type?: 'success' | 'error' }
type Drink = { id: number; name: string; price_cents: number; crate_price_cents: number }
type Booking = { created_at: string; text: string }

const BOTTLES_PER_CRATE = 20
const FREE_POOL_TABLE = 'free_pool'
const FREE_POOL_ID = 1

const euro = (cents: number) => `${(cents / 100).toFixed(2)} €`
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

export default function HomePage() {
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [freePool, setFreePool] = useState<number>(0)
  const [freeChoiceDrink, setFreeChoiceDrink] = useState<Drink | null>(null)
  const [pendingQty, setPendingQty] = useState<number>(0)
  const [popup, setPopup] = useState<PopupData | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  // Getränke & Daten laden
  useEffect(() => {
    const fetchDrinks = async () => {
      const { data, error } = await supabase.from('drinks').select('*').order('name')
      if (!error) setDrinks(data || [])
    }
    fetchDrinks()
  }, [])

  const loadFreePool = async () => {
    const { data } = await supabase
      .from(FREE_POOL_TABLE)
      .select('quantity_remaining')
      .eq('id', FREE_POOL_ID)
      .maybeSingle()
    setFreePool(data?.quantity_remaining ?? 0)
  }

  const loadStats = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('open_balance_cents')
      .eq('id', user.id)
      .maybeSingle()
    setBalance(profile?.open_balance_cents ?? 0)

    const { data: cons } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, created_at, drinks(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)

    const drinkBookings: Booking[] = (cons || []).map((r: any) => ({
      created_at: r.created_at,
      text:
        r.unit_price_cents === 0
          ? `🎉 ${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Freibier)`
          : `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (${euro(r.unit_price_cents * r.quantity)})`,
    }))
    setBookings(drinkBookings)
  }

  useEffect(() => {
    loadStats()
    loadFreePool()
    const ch = supabase
      .channel('free-pool-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: FREE_POOL_TABLE }, loadFreePool)
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [])

  // Getränk verbuchen
  const openConfirmDrinkPopup = () => {
    if (!selectedDrink) return addToast('Bitte Getränk wählen', 'error')
    if (freePool > 0 && selectedDrink.name.toLowerCase().includes('bier')) {
      setFreeChoiceDrink(selectedDrink)
      setPendingQty(quantity)
      return
    }
    setPopup({
      title: 'Buchung bestätigen',
      message: `Du buchst ${quantity} × ${selectedDrink.name} = ${euro(selectedDrink.price_cents * quantity)}.\n\nJetzt wirklich verbuchen?`,
      onConfirm: () => void handlePaidBooking(selectedDrink, quantity),
    })
  }

  const handlePaidBooking = async (drink: Drink, qty: number) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return
    const now = new Date().toISOString()
    const totalCents = drink.price_cents * qty

    await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: drink.id,
      quantity: qty,
      unit_price_cents: drink.price_cents,
      source: 'single',
      created_at: now,
    })

    await supabase.rpc('increment_balance', {
      user_id_input: user.id,
      amount_input: totalCents,
    })

    addToast(`💰 ${qty}× ${drink.name} verbucht`)
    setQuantity(1)
    setSelectedDrink(null)
    await loadStats()
  }

  const finalizeFreeDecision = async (takeFree: boolean) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user || !freeChoiceDrink) return

    const now = new Date().toISOString()
    let freeQty = 0
    let paidQty = 0

    if (takeFree) {
      freeQty = Math.min(pendingQty, freePool)
      paidQty = Math.max(0, pendingQty - freeQty)
      if (freeQty > 0)
        await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: freeQty })
      setFreePool((p) => Math.max(0, p - freeQty))
    } else paidQty = pendingQty

    if (freeQty > 0)
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: freeChoiceDrink.id,
        quantity: freeQty,
        unit_price_cents: 0,
        source: 'single',
        created_at: now,
      })

    if (paidQty > 0) {
      const totalCents = freeChoiceDrink.price_cents * paidQty
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: freeChoiceDrink.id,
        quantity: paidQty,
        unit_price_cents: freeChoiceDrink.price_cents,
        source: 'single',
        created_at: now,
      })
      await supabase.rpc('increment_balance', {
        user_id_input: user.id,
        amount_input: totalCents,
      })
    }

    addToast(
      takeFree
        ? `🎉 ${freeQty}× Freibier + 💰 ${paidQty}× bezahlt (${freeChoiceDrink.name})`
        : `💰 ${paidQty}× ${freeChoiceDrink.name} bezahlt verbucht`
    )

    setFreeChoiceDrink(null)
    setPendingQty(0)
    setQuantity(1)
    setSelectedDrink(null)
    await loadStats()
  }

  const handleCrateCreate = async (price_cents: number) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user || !selectedDrink) return

    await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: -BOTTLES_PER_CRATE })
    setFreePool((p) => p + BOTTLES_PER_CRATE)

    if (price_cents > 0) {
      await supabase.rpc('increment_balance', {
        user_id_input: user.id,
        amount_input: price_cents,
      })
      setBalance((b) => b + price_cents)
    }

    addToast(
      price_cents > 0
        ? `📦 Kiste (${selectedDrink.name}) gekauft → +${BOTTLES_PER_CRATE} Freibier`
        : `🧊 Eigene Kiste (${selectedDrink.name}) → +${BOTTLES_PER_CRATE} Freibier (0 €)`
    )
    setQuantity(1)
    setSelectedDrink(null)
  }

  const totalPrice = useMemo(() => (selectedDrink ? selectedDrink.price_cents * quantity : 0), [selectedDrink, quantity])

  return (
    <>
      <TopNav />
      <div className="pt-20 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white px-4 pb-24">
        <div className="max-w-md mx-auto space-y-6">
          <section>
            <h2 className="text-xl font-semibold">💰 Kontostand</h2>
            <p className={`text-lg font-medium ${balance >= 0 ? 'text-red-400' : 'text-green-400'}`}>
              {balance >= 0 ? '-' : '+'}{Math.abs(balance / 100).toFixed(2)} €
            </p>
          </section>

          <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6">
            <h1 className="text-2xl font-semibold mb-4">🍺 Getränk verbuchen</h1>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {drinks.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDrink(d)}
                  className={`p-3 rounded-xl border text-sm ${
                    selectedDrink?.id === d.id
                      ? 'bg-white text-black border-white'
                      : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>

            {selectedDrink && (
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-10 h-10 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-2xl">–</button>
                  <span className="w-8 text-center text-xl">{quantity}</span>
                  <button onClick={() => setQuantity((q) => q + 1)} className="w-10 h-10 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-2xl">+</button>
                </div>
                <span className="text-sm text-neutral-400">{euro(selectedDrink.price_cents)} / Stück</span>
              </div>
            )}

            <button
              disabled={!selectedDrink}
              onClick={openConfirmDrinkPopup}
              className="w-full h-12 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              Jetzt verbuchen {selectedDrink ? `• ${euro(totalPrice)}` : ''}
            </button>
          </section>

          {/* 🎉 Freibier-Kisten NUR bei Bier anzeigen */}
          {selectedDrink && selectedDrink.name.toLowerCase() === 'bier' && (
            <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 space-y-3">
              <h2 className="text-xl font-semibold">🎉 Freibier-Pool (global)</h2>
              <p className="text-sm text-neutral-300">
                Verfügbar: <span className="font-semibold text-emerald-400">{freePool}</span> Flaschen für alle Getränke
              </p>
              <p className="text-sm text-neutral-400">
                Kistenpreis Bier: {euro(selectedDrink.crate_price_cents)} • {BOTTLES_PER_CRATE} Flaschen
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button onClick={() => handleCrateCreate(selectedDrink.crate_price_cents)} className="bg-blue-700 hover:bg-blue-800 py-3 rounded-lg font-medium">
                  Kiste kaufen ({euro(selectedDrink.crate_price_cents)})
                </button>
                <button onClick={() => handleCrateCreate(0)} className="bg-yellow-600 hover:bg-yellow-700 py-3 rounded-lg font-medium">
                  Eigene Kiste (0 €)
                </button>
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold mb-2">🧾 Letzte Buchungen</h2>
            <ul className="text-sm divide-y divide-neutral-800">
              {bookings.length === 0 && <li className="py-2 text-neutral-500">Keine Buchungen</li>}
              {bookings.map((b, i) => (
                <li key={i} className="py-2 flex justify-between">
                  <span>{shortDate(b.created_at)} {b.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* 🎉 Freibier-Entscheidung */}
        <AnimatePresence>
          {freeChoiceDrink && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
              <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className="bg-neutral-900/90 border border-neutral-800 p-6 rounded-2xl max-w-sm w-full text-center shadow-2xl">
                <h4 className="text-lg font-semibold mb-3">Freibier oder bezahlen?</h4>
                <p className="text-sm text-neutral-300 mb-6">
                  Für den <span className="font-semibold text-white">globalen Freibier-Pool</span> sind aktuell&nbsp;
                  <span className="font-semibold text-emerald-400">{freePool}</span> Flaschen verfügbar.
                  <br />
                  Du möchtest <span className="font-semibold">{pendingQty}</span> × {freeChoiceDrink.name} verbuchen.
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <button onClick={() => finalizeFreeDecision(true)} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white">🎉 Freibier nutzen</button>
                  <button onClick={() => finalizeFreeDecision(false)} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white">💰 Bezahlen</button>
                </div>
                <button onClick={() => { setFreeChoiceDrink(null); setPendingQty(0); }} className="mt-4 text-sm text-neutral-400 underline">Abbrechen</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toasts */}
        <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className={`px-4 py-2 rounded-lg text-sm shadow-lg ${t.type === 'error' ? 'bg-red-700' : 'bg-green-700'}`}
              >
                {t.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}
