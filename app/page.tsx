'use client'

import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'
import { PiggyBank, Beer, Gift, Wallet } from 'lucide-react'

const BOTTLES_PER_CRATE = 20
const FREE_POOL_TABLE = 'free_pool'
const FREE_POOL_ID = 1
const euro = (c: number) => `${(c / 100).toFixed(2)} €`
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE')

export default function HomePage() {
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<any[]>([])
  const [freePool, setFreePool] = useState<number>(0)
  const [toasts, setToasts] = useState<any[]>([])
  const [bierPrice, setBierPrice] = useState<number>(0)
  const [freeChoiceDrink, setFreeChoiceDrink] = useState<any | null>(null)
  const [pendingQty, setPendingQty] = useState<number>(0)
  const [popup, setPopup] = useState(false)
  const [freePopup, setFreePopup] = useState(false)
  const [partialPopup, setPartialPopup] = useState<{ free: number; pay: number } | null>(null)

  const addToast = (t: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, t, type }])
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 3000)
  }

  const refreshBookings = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return
    const { data } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, created_at, drinks(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)
    setBookings(
      (data || []).map((r: any) => ({
        created_at: r.created_at,
        text:
          r.unit_price_cents === 0
            ? `🎉 ${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Freibier)`
            : `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (${euro(
                r.unit_price_cents * r.quantity,
              )})`,
      })),
    )
  }

  useEffect(() => {
    const init = async () => {
      const { data: drinks } = await supabase.from('drinks').select('*').order('name')
      setDrinks(drinks || [])
      const bier = drinks?.find((d: any) => d.name.toLowerCase() === 'bier')
      if (bier) setBierPrice(bier.crate_price_cents)

      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) return

      const prof = await supabase.from('profiles').select('open_balance_cents').eq('id', user.id).maybeSingle()
      setBalance(prof.data?.open_balance_cents ?? 0)

      const pool = await supabase.from(FREE_POOL_TABLE).select('quantity_remaining').eq('id', FREE_POOL_ID).maybeSingle()
      setFreePool(pool.data?.quantity_remaining ?? 0)

      await refreshBookings()
    }
    init()
  }, [])

  // ---------------- Buchung ----------------
  const handlePaidBooking = async (drink: any, qty: number) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return
    const total = drink.price_cents * qty

    const { error: insErr } = await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: drink.id,
      quantity: qty,
      unit_price_cents: drink.price_cents,
      source: 'single',
      created_at: new Date().toISOString(),
    })
    if (insErr) return addToast('❌ Buchung fehlgeschlagen', 'error')

    await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: total })
    setBalance((b) => b + total)
    addToast(`💰 ${qty}× ${drink.name} verbucht`)
    setSelectedDrink(null)
    setQuantity(1)
    setPopup(false)
    setFreeChoiceDrink(null)
    await refreshBookings()
  }

  // ---------------- Freibier ----------------
  const handleFreeBooking = async (drink: any, qty: number) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const freeQty = Math.min(qty, freePool)
    const payQty = qty - freeQty

    if (payQty > 0 && freeQty > 0) {
      setPartialPopup({ free: freeQty, pay: payQty })
      return
    }

    // Vollständige Freibierbuchung
    const { error: insErr } = await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: drink.id,
      quantity: freeQty,
      unit_price_cents: 0,
      source: 'single',
      created_at: new Date().toISOString(),
    })
    if (insErr) return addToast('❌ Freibierbuchung fehlgeschlagen', 'error')

    await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: freeQty })
    setFreePool((p) => Math.max(0, p - freeQty))
    addToast(`🎉 ${freeQty}× ${drink.name} als Freibier verbucht`)
    setFreeChoiceDrink(null)
    await refreshBookings()
  }

  const confirmPartialFreeBooking = async () => {
    if (!freeChoiceDrink || !partialPopup) return
    const { free, pay } = partialPopup
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const now = new Date().toISOString()

    // Freibierteil
    if (free > 0) {
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: freeChoiceDrink.id,
        quantity: free,
        unit_price_cents: 0,
        source: 'single',
        created_at: now,
      })
      await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: free })
    }

    // Bezahlter Teil
    if (pay > 0) {
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: freeChoiceDrink.id,
        quantity: pay,
        unit_price_cents: freeChoiceDrink.price_cents,
        source: 'single',
        created_at: now,
      })
      const total = freeChoiceDrink.price_cents * pay
      await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: total })
      setBalance((b) => b + total)
      addToast(`💰 ${pay}× bezahlt, 🎉 ${free}× frei (${freeChoiceDrink.name})`)
    }

    setFreePool((p) => Math.max(0, p - free))
    setPartialPopup(null)
    setFreeChoiceDrink(null)
    await refreshBookings()
  }

  const handleProvideFreeDrinks = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return
    await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: -BOTTLES_PER_CRATE })
    setFreePool((p) => p + BOTTLES_PER_CRATE)
    await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: bierPrice })
    setBalance((b) => b + bierPrice)
    addToast('🎉 20 Freigetränke bereitgestellt!')
    setFreePopup(false)
  }

  // ---------------- UI ----------------
  const totalPrice = useMemo(() => (selectedDrink ? selectedDrink.price_cents * quantity : 0), [selectedDrink, quantity])

  return (
    <>
      <TopNav />
      <div className="pt-20 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white px-4 pb-24">
        <div className="max-w-md mx-auto space-y-6">
          {/* Karten im Profilstil */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Card icon={<PiggyBank />} color="from-rose-900/80 to-rose-800/40" label="Kontostand" value={euro(balance)} />
            <Card icon={<Gift />} color="from-green-900/80 to-green-800/40" label="Freibier" value={`${freePool}`} />
            <Card icon={<Beer />} color="from-purple-900/80 to-purple-800/40" label="Buchungen" value={`${bookings.length}`} />
            <Card icon={<Wallet />} color="from-blue-900/80 to-blue-800/40" label="Letzte Buchung" value={bookings[0] ? shortDate(bookings[0].created_at) : '—'} />
          </div>

          {/* Getränkeauswahl */}
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
              <div className="flex justify-between mb-3">
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
              onClick={() => {
                if (freePool > 0) {
                  setFreeChoiceDrink(selectedDrink)
                  setPendingQty(quantity)
                } else {
                  setPopup(true)
                }
              }}
              className="w-full h-12 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              Jetzt verbuchen {selectedDrink ? `• ${euro(totalPrice)}` : ''}
            </button>
          </section>

          <div className="mt-4">
            <button onClick={() => setFreePopup(true)} className="w-full h-12 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition">
              🍻 Freigetränke bereitstellen
            </button>
          </div>

          <section className="mt-6">
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

        {/* Popups */}
        <AnimatePresence>
          {popup && selectedDrink && (
            <Popup
              title="🍺 Buchung bestätigen"
              message={`Du buchst ${quantity}× ${selectedDrink.name} = ${euro(selectedDrink.price_cents * quantity)}.\nJetzt wirklich verbuchen?`}
              onCancel={() => setPopup(false)}
              onConfirm={() => handlePaidBooking(selectedDrink, quantity)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {freeChoiceDrink && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl border border-neutral-700 max-w-sm w-full">
                <h3 className="text-xl font-semibold mb-2">🎉 Freibier oder bezahlen?</h3>
                <p className="text-sm text-neutral-300 mb-6">
                  Es sind {freePool} Flaschen im globalen Freibier-Pool.<br />
                  Du möchtest {pendingQty}× {freeChoiceDrink.name} verbuchen.
                </p>
                <div className="flex justify-center gap-4">
                  <button onClick={() => handleFreeBooking(freeChoiceDrink, pendingQty)} className="px-4 py-2 bg-green-700 rounded hover:bg-green-800">🎉 Freibier nutzen</button>
                  <button onClick={() => handlePaidBooking(freeChoiceDrink, pendingQty)} className="px-4 py-2 bg-blue-700 rounded hover:bg-blue-800">💰 Bezahlen</button>
                </div>
                <button onClick={() => setFreeChoiceDrink(null)} className="mt-4 text-sm text-neutral-400 underline">Abbrechen</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {partialPopup && (
            <Popup
              title="⚖️ Teilweise Freibier"
              message={`Nur ${partialPopup.free} Freibier verfügbar.\n${partialPopup.pay} werden berechnet.`}
              onCancel={() => setPartialPopup(null)}
              onConfirm={confirmPartialFreeBooking}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {freePopup && (
            <Popup
              title="🍻 Freigetränke bereitstellen"
              message={`Du stellst ${BOTTLES_PER_CRATE} Freigetränke bereit.\nDafür wird ${euro(bierPrice)} abgebucht.`}
              onCancel={() => setFreePopup(false)}
              onConfirm={handleProvideFreeDrinks}
            />
          )}
        </AnimatePresence>

        <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className={`px-4 py-2 rounded-lg text-sm shadow-lg ${t.type === 'error' ? 'bg-red-700' : 'bg-green-700'}`}>
                {t.t}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

function Card({ icon, color, label, value }: any) {
  return (
    <div className={`p-4 rounded-2xl bg-gradient-to-br ${color} text-white shadow-md flex flex-col justify-center`}>
      <div className="flex items-center gap-3 mb-1">
        <div className="text-2xl">{icon}</div>
        <div className="text-sm text-neutral-300">{label}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

function Popup({ title, message, onCancel, onConfirm }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl border border-neutral-700 max-w-sm w-full">
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-sm text-neutral-300 mb-6 whitespace-pre-line">{message}</p>
        <div className="flex justify-center gap-4">
          <button onClick={onCancel} className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600">Abbrechen</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-green-700 rounded hover:bg-green-800">Bestätigen</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
