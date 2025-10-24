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

  // 🎉 Globaler Freibier-Pool (für alle Getränke)
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

  // ─────────────────────────────────────────────
  // Loader
  // ─────────────────────────────────────────────
  useEffect(() => {
    const fetchDrinks = async () => {
      const { data, error } = await supabase.from('drinks').select('*').order('name')
      if (!error) setDrinks(data || [])
    }
    fetchDrinks()
  }, [])

  const loadFreePool = async () => {
    const { data, error } = await supabase
      .from(FREE_POOL_TABLE)
      .select('id, quantity_remaining')
      .eq('id', FREE_POOL_ID)
      .maybeSingle()
    if (error) {
      console.error('free_pool load error:', error)
      return
    }
    if (!data) {
      // fallback: Zeile anlegen (optional – wenn RLS es zulässt)
      await supabase.from(FREE_POOL_TABLE).insert([{ id: FREE_POOL_ID, quantity_remaining: 0 } as any])
      setFreePool(0)
    } else {
      setFreePool(data.quantity_remaining ?? 0)
    }
  }

  // Kontostand + letzte Buchungen laden
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

    // Optional: weitere Quellen hier zusammenführen (z. B. Zahlungen)
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

  // ─────────────────────────────────────────────
  // Verbuchen – UI
  // ─────────────────────────────────────────────
  const openConfirmDrinkPopup = () => {
    if (!selectedDrink) return addToast('Bitte Getränk wählen', 'error')

    // Wenn globales Freibier verfügbar ist → Entscheidung einholen
    if (freePool > 0) {
      setFreeChoiceDrink(selectedDrink)
      setPendingQty(quantity)
      return
    }

    // sonst: direkt bezahlen
    setPopup({
      title: 'Buchung bestätigen',
      message: `Du buchst ${quantity} × ${selectedDrink.name} = ${euro(selectedDrink.price_cents * quantity)}.\n\nJetzt wirklich verbuchen?`,
      onConfirm: () => void handlePaidBooking(selectedDrink, quantity),
    })
  }

  // ─────────────────────────────────────────────
  // Bezahlte Buchung (ohne Freibier)
  // ─────────────────────────────────────────────
  const handlePaidBooking = async (drink: Drink, qty: number) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const now = new Date().toISOString()
    const lineTotal = drink.price_cents * qty

    const { error: insErr } = await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: drink.id,
      quantity: qty,
      unit_price_cents: drink.price_cents,
      source: 'single',
      created_at: now,
    })
    if (insErr) {
      console.error('consumption insert error:', insErr)
      addToast('❌ Buchung fehlgeschlagen', 'error')
      return
    }

    // ✅ Kontostand erhöhen – ACHTUNG: korrekte Parameternamen!
    const { error: balErr } = await supabase.rpc('increment_balance', {
      user_id_input: user.id,
      amount_input: lineTotal,
    })
    if (balErr) {
      console.error('increment_balance error:', balErr)
      addToast('⚠️ Betrag konnte nicht abgebucht werden', 'error')
    } else {
      setBalance((b) => (b ?? 0) + lineTotal)
    }

    addToast(`💰 ${qty}× ${drink.name} verbucht`)
    setQuantity(1)
    setSelectedDrink(null)
    await loadStats()
  }

  // ─────────────────────────────────────────────
  // Freibier-Entscheidung (globaler Pool)
  // ─────────────────────────────────────────────
  const finalizeFreeDecision = async (takeFree: boolean) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user || !freeChoiceDrink) return

    const now = new Date().toISOString()
    let freeQty = 0
    let paidQty = 0

    if (takeFree) {
      freeQty = Math.min(pendingQty, Math.max(0, freePool))
      paidQty = Math.max(0, pendingQty - freeQty)

      // 🔽 globalen Freibier-Pool reduzieren (RPC, security definer)
      if (freeQty > 0) {
        const { error: poolErr } = await supabase.rpc('terminal_decrement_free_pool', {
          _id: FREE_POOL_ID,
          _used: freeQty,
        })
        if (poolErr) {
          console.error('terminal_decrement_free_pool error:', poolErr)
          // Fallback: kein Abbruch – wir buchen den freien Teil trotzdem, um Nutzer nicht zu „bestrafen“
        } else {
          setFreePool((p) => Math.max(0, p - freeQty))
        }
      }
    } else {
      paidQty = pendingQty
    }

    // ✅ Freibier-Teil eintragen
    if (freeQty > 0) {
      const { error: freeErr } = await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: freeChoiceDrink.id,
        quantity: freeQty,
        unit_price_cents: 0,
        source: 'single',
        created_at: now,
      })
      if (freeErr) console.error('free insert error:', freeErr)
    }

    // ✅ Bezahlten Teil eintragen + Kontostand erhöhen
    if (paidQty > 0) {
      const lineTotal = freeChoiceDrink.price_cents * paidQty

      const { error: payErr } = await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: freeChoiceDrink.id,
        quantity: paidQty,
        unit_price_cents: freeChoiceDrink.price_cents,
        source: 'single',
        created_at: now,
      })
      if (payErr) {
        console.error('paid insert error:', payErr)
        addToast('❌ Zahlungsteil konnte nicht gebucht werden', 'error')
      } else {
        const { error: balErr } = await supabase.rpc('increment_balance', {
          user_id_input: user.id,
          amount_input: lineTotal,
        })
        if (balErr) {
          console.error('increment_balance error:', balErr)
          addToast('⚠️ Betrag konnte nicht abgebucht werden', 'error')
        } else {
          setBalance((b) => (b ?? 0) + lineTotal)
        }
      }
    }

    // 💬 Zusammenfassung
    if (freeQty > 0 && paidQty > 0) {
      addToast(`🎉 ${freeQty}× frei + 💰 ${paidQty}× bezahlt (${freeChoiceDrink.name})`)
    } else if (freeQty > 0) {
      addToast(`🎉 ${freeQty}× ${freeChoiceDrink.name} als Freibier verbucht`)
    } else if (paidQty > 0) {
      addToast(`💰 ${paidQty}× ${freeChoiceDrink.name} bezahlt verbucht`)
    } else {
      addToast('⚠️ Keine Buchung durchgeführt', 'error')
    }

    // Reset & Refresh
    setFreeChoiceDrink(null)
    setPendingQty(0)
    setQuantity(1)
    setSelectedDrink(null)
    await loadStats()
  }

  // ─────────────────────────────────────────────
  // Kiste bereitstellen (globaler Pool)
  // ─────────────────────────────────────────────
  const openCratePopup = (type: 'paid' | 'own') => {
    if (!selectedDrink) return addToast('Bitte zuerst ein Getränk wählen', 'error')
    const isOwn = type === 'own'
    const cratePrice = isOwn ? 0 : selectedDrink.crate_price_cents
    setPopup({
      title: isOwn ? 'Eigene Kiste bestätigen' : 'Kiste kaufen bestätigen',
      message: isOwn
        ? `⚠️ Nur verbuchen, wenn die Kiste wirklich im Kühlraum steht!\n\nJetzt als Freibier-Kiste eintragen (+${BOTTLES_PER_CRATE} frei, 0 €)?`
        : `Diese Kiste wird als Freibier für ALLE Getränke bereitgestellt (+${BOTTLES_PER_CRATE} frei)\nund mit ${euro(cratePrice)} auf dein Konto verbucht.\n\nJetzt wirklich verbuchen?`,
      onConfirm: () => void handleCrateCreate(cratePrice),
    })
  }

  const handleCrateCreate = async (price_cents: number) => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user || !selectedDrink) return

    // 1) Globalen Freibier-Pool erhöhen
    // Trick: vorhandene RPC "decrement" mit negativem Wert nutzen, um zu erhöhen
    const { error: poolErr } = await supabase.rpc('terminal_decrement_free_pool', {
      _id: FREE_POOL_ID,
      _used: -BOTTLES_PER_CRATE,
    })
    if (poolErr) {
      console.error('free_pool increment error:', poolErr)
      addToast('❌ Konnte Freibier-Pool nicht erhöhen', 'error')
      return
    }
    setFreePool((p) => p + BOTTLES_PER_CRATE)

    // 2) Kontostand belasten (nur bei bezahlter Kiste)
    if (price_cents > 0) {
      const { error: balErr } = await supabase.rpc('increment_balance', {
        user_id_input: user.id,
        amount_input: price_cents,
      })
      if (balErr) {
        console.error('increment_balance (crate) error:', balErr)
        addToast('⚠️ Betrag für Kiste konnte nicht abgebucht werden', 'error')
      } else {
        setBalance((b) => (b ?? 0) + price_cents)
      }
    }

    addToast(
      price_cents > 0
        ? `📦 Kiste (${selectedDrink.name}) gekauft → +${BOTTLES_PER_CRATE} Freibier`
        : `🧊 Eigene Kiste (${selectedDrink.name}) → +${BOTTLES_PER_CRATE} Freibier (0 €)`
    )

    // Optional: als „Buchung“ im Verlauf vermerken (nur UI, da keine eigene Tabelle)
    setBookings((prev) => [
      { created_at: new Date().toISOString(), text: price_cents > 0
        ? `📦 Kiste ${selectedDrink.name} (${euro(price_cents)}) als Freibier bereitgestellt`
        : `🧊 Eigene Kiste ${selectedDrink.name} (0 €) als Freibier bereitgestellt` },
      ...prev
    ])

    setQuantity(1)
    setSelectedDrink(null)
  }

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────
  const totalPrice = useMemo(() => (selectedDrink ? selectedDrink.price_cents * quantity : 0), [selectedDrink, quantity])

  return (
    <>
      <TopNav />
      <div className="pt-20 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white px-4 pb-24">
        <div className="max-w-md mx-auto space-y-6">

          
{/* 🔹 Statistikkarten (mobile 2x2 Grid) */}
<div className="grid grid-cols-2 gap-3 mb-6">
  <div className="rounded-2xl bg-gradient-to-br from-rose-900/80 to-rose-800/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">💰</div>
    <div className="text-xs text-neutral-300">Kontostand</div>
    <div className="text-base font-semibold">{balance >= 0 ? '-' : '+'}{Math.abs(balance / 100).toFixed(2)} €</div>
  </div>
  <div className="rounded-2xl bg-gradient-to-br from-green-900/80 to-green-800/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">🍺</div>
    <div className="text-xs text-neutral-300">Gesamtverbrauch</div>
    <div className="text-base font-semibold">{bookings.length}</div>
  </div>
  <div className="rounded-2xl bg-gradient-to-br from-emerald-800/80 to-emerald-700/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">🎁</div>
    <div className="text-xs text-neutral-300">Freibier</div>
    <div className="text-base font-semibold">{freePool}</div>
  </div>
  <div className="rounded-2xl bg-gradient-to-br from-blue-900/80 to-blue-800/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">💶</div>
    <div className="text-xs text-neutral-300">Letzte Zahlung</div>
    <div className="text-base font-semibold">{bookings[0] ? shortDate(bookings[0].created_at) : '—'}</div>
  </div>
</div>


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

          {/* 🎉 Globaler Freibier-Pool – nur bei Bier */}
{selectedDrink && selectedDrink.name.toLowerCase() === 'bier' && (
  <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 space-y-3">
    <h2 className="text-xl font-semibold">🎉 Freibier-Pool (global)</h2>
    <p className="text-sm text-neutral-300">
      Verfügbar: <span className="font-semibold text-emerald-400">{freePool}</span> Flaschen für alle Getränke
    </p>

    {!selectedDrink && <p className="text-sm text-neutral-500">Wähle ein Getränk, um eine Kiste bereitzustellen.</p>}
    {selectedDrink && (
      <>
        <p className="text-sm text-neutral-400">
          Kistenpreis {selectedDrink.name}: {euro(selectedDrink.crate_price_cents)} • {BOTTLES_PER_CRATE} Flaschen
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button onClick={() => openCratePopup('paid')} className="bg-blue-700 hover:bg-blue-800 py-3 rounded-lg font-medium">
            Kiste kaufen ({euro(selectedDrink.crate_price_cents)})
          </button>
          <button onClick={() => openCratePopup('own')} className="bg-yellow-600 hover:bg-yellow-700 py-3 rounded-lg font-medium">
            Eigene Kiste (0 €)
          </button>
        </div>
      </>
    )}
  </section>
)}
{/* 🧾 Letzte Buchungen */}
          
{/* 🔹 Statistikkarten (mobile 2x2 Grid) */}
<div className="grid grid-cols-2 gap-3 mb-6">
  <div className="rounded-2xl bg-gradient-to-br from-rose-900/80 to-rose-800/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">💰</div>
    <div className="text-xs text-neutral-300">Kontostand</div>
    <div className="text-base font-semibold">{balance >= 0 ? '-' : '+'}{Math.abs(balance / 100).toFixed(2)} €</div>
  </div>
  <div className="rounded-2xl bg-gradient-to-br from-green-900/80 to-green-800/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">🍺</div>
    <div className="text-xs text-neutral-300">Gesamtverbrauch</div>
    <div className="text-base font-semibold">{bookings.length}</div>
  </div>
  <div className="rounded-2xl bg-gradient-to-br from-emerald-800/80 to-emerald-700/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">🎁</div>
    <div className="text-xs text-neutral-300">Freibier</div>
    <div className="text-base font-semibold">{freePool}</div>
  </div>
  <div className="rounded-2xl bg-gradient-to-br from-blue-900/80 to-blue-800/40 p-3 text-center shadow-md">
    <div className="text-2xl mb-1">💶</div>
    <div className="text-xs text-neutral-300">Letzte Zahlung</div>
    <div className="text-base font-semibold">{bookings[0] ? shortDate(bookings[0].created_at) : '—'}</div>
  </div>
</div>

        </div>

        {/* Popups */}
        <AnimatePresence>
          {popup && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-neutral-900/95 p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center border border-neutral-700"
              >
                <h3 className="text-lg font-semibold mb-2">{popup.title}</h3>
                <p className="text-sm text-neutral-300 mb-6 whitespace-pre-line">{popup.message}</p>
                <div className="flex justify-center gap-4">
                  <button onClick={() => setPopup(null)} className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600">Abbrechen</button>
                  <button onClick={() => { popup.onConfirm(); setPopup(null) }} className="px-4 py-2 bg-green-700 rounded hover:bg-green-800">
                    Bestätigen
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 🎉 Freibier-Entscheidung */}
        <AnimatePresence>
          {freeChoiceDrink && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }}
                className="bg-neutral-900/90 border border-neutral-800 p-6 rounded-2xl max-w-sm w-full text-center shadow-2xl"
              >
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
