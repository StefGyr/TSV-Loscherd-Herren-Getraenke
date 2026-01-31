'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'


type PopupData = { title: string; message: string; onConfirm: () => void }
type Toast = { id: number; text: string; type?: 'success' | 'error' }
type Drink = { id: number; name: string; price_cents: number; crate_price_cents: number }
type Booking = { created_at: string; text: string }

export default function HomePage() {
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [freeCrates, setFreeCrates] = useState<any[]>([])
  const [freeChoiceDrink, setFreeChoiceDrink] = useState<Drink | null>(null)
  const [pendingQty, setPendingQty] = useState<number>(0)
  const [popup, setPopup] = useState<PopupData | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const euro = (cents: number) => `${(cents / 100).toFixed(2)} €`
  const shortDate = (iso: string) => {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
  }

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  // Getränke laden
  useEffect(() => {
    const fetchDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks(data || [])
    }
    fetchDrinks()
  }, [])

  // Freibier-Kisten laden
  const fetchFreeCrates = async () => {
    const { data } = await supabase
      .from('crates')
      .select('id, drink_id, quantity_remaining, is_free, created_at, drinks(name)')
      .eq('is_free', true)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: false })
    setFreeCrates(data || [])
  }

  useEffect(() => {
    fetchFreeCrates()
    const channel = supabase
      .channel('crates-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crates' }, fetchFreeCrates)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [])

  // Kontostand + letzte Buchungen laden
  const loadStats = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('profiles')
      .select('open_balance_cents')
      .eq('id', user.id)
      .single()
    setBalance(profile?.open_balance_cents ?? 0)

    const { data: cons } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, created_at, drinks(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)

    const drinkBookings: Booking[] = (cons || []).map((r: any) => ({
      created_at: r.created_at,
      text:
        r.unit_price_cents === 0
          ? `🎉 ${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Freibier)`
          : `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (${euro(r.unit_price_cents * r.quantity)})`,
    }))

    const { data: crates } = await supabase
      .from('crates')
      .select('created_at, price_cents, drinks(name)')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .limit(3)

    const crateBookings: Booking[] = (crates || []).map((c: any) => ({
      created_at: c.created_at,
      text:
        c.price_cents === 0
          ? `🧊 Eigene Kiste ${c.drinks?.name ?? 'Unbekannt'} (0 €)`
          : `📦 Kiste ${c.drinks?.name ?? 'Unbekannt'} (${euro(c.price_cents)})`,
    }))

    const combined = [...drinkBookings, ...crateBookings].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    setBookings(combined.slice(0, 6))
  }

  useEffect(() => { loadStats() }, [])

  // Getränk verbuchen
  const openConfirmDrinkPopup = () => {
    if (!selectedDrink) return addToast('Bitte Getränk wählen', 'error')
    const total = selectedDrink.price_cents * quantity
    setPopup({
      title: 'Buchung bestätigen',
      message: `Du buchst ${quantity} × ${selectedDrink.name} = ${euro(total)}.\n\nJetzt wirklich verbuchen?`,
      onConfirm: handleBookDrink,
    })
  }

  const handleBookDrink = async () => {
    if (!selectedDrink) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const totalCents = selectedDrink.price_cents * quantity

    const { data: free } = await supabase
      .from('crates')
      .select('id, quantity_remaining')
      .eq('drink_id', selectedDrink.id)
      .eq('is_free', true)
      .gt('quantity_remaining', 0)
      .limit(1)

    if (free && free.length > 0) {
      setFreeChoiceDrink(selectedDrink)
      setPendingQty(quantity)
      return
    }

    await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: selectedDrink.id,
      quantity,
      unit_price_cents: selectedDrink.price_cents,
      source: 'single',
      created_at: new Date().toISOString(),
    })

    await supabase.rpc('increment_balance', { user_id: user.id, amount: totalCents })

    addToast(`💰 ${quantity}× ${selectedDrink.name} verbucht`)
    setQuantity(1)
    setSelectedDrink(null)
    await loadStats()
    await fetchFreeCrates()
  }

// --- Smarte Freibier-Logik mit kombinierter Toastmeldung ---
const finalizeFreeDecision = async (takeFree: boolean) => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !freeChoiceDrink) return

  const now = new Date().toISOString()
  let freeQty = 0
  let paidQty = 0
  let toastText = ''

  if (takeFree) {
    // Freibier prüfen
    const { data: crate } = await supabase
      .from('crates')
      .select('id, quantity_remaining')
      .eq('drink_id', freeChoiceDrink.id)
      .eq('is_free', true)
      .gt('quantity_remaining', 0)
      .order('created_at', { ascending: false })
      .limit(1)

    if (crate && crate.length > 0) {
      const available = crate[0].quantity_remaining
      freeQty = Math.min(available, pendingQty)
      paidQty = pendingQty - freeQty

      // Freibierbestand reduzieren
      await supabase
        .from('crates')
        .update({ quantity_remaining: Math.max(0, available - freeQty) })
        .eq('id', crate[0].id)
    } else {
      addToast(`⚠️ Kein Freibier mehr für ${freeChoiceDrink.name} verfügbar`, 'error')
      paidQty = pendingQty
    }
  } else {
    paidQty = pendingQty
  }

  // ✅ Freibierteil eintragen
  if (freeQty > 0) {
    await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: freeChoiceDrink.id,
      quantity: freeQty,
      unit_price_cents: 0,
      source: 'crate',
      created_at: now,
    })
  }

  // ✅ Bezahlten Teil eintragen
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
    await supabase.rpc('increment_balance', { user_id: user.id, amount: totalCents })
  }

  // 💬 Dynamische Zusammenfassung
  if (freeQty > 0 && paidQty > 0) {
    toastText = `🎉 ${freeQty}× Freibier + 💰 ${paidQty}× bezahlt (${freeChoiceDrink.name})`
  } else if (freeQty > 0) {
    toastText = `🎉 ${freeQty}× ${freeChoiceDrink.name} als Freibier verbucht`
  } else if (paidQty > 0) {
    toastText = `💰 ${paidQty}× ${freeChoiceDrink.name} bezahlt verbucht`
  } else {
    toastText = `⚠️ Keine Buchung durchgeführt`
  }

  addToast(toastText)

  // 🔁 Reset & Refresh
  setFreeChoiceDrink(null)
  setPendingQty(0)
  setQuantity(1)
  setSelectedDrink(null)
  await loadStats()
  await fetchFreeCrates()
}



  // Kiste bereitstellen
  const openCratePopup = (type: 'paid' | 'own') => {
    if (!selectedDrink) return addToast('Bitte zuerst ein Getränk wählen', 'error')
    const isOwn = type === 'own'
    const cratePrice = isOwn ? 0 : selectedDrink.crate_price_cents
    setPopup({
      title: isOwn ? 'Eigene Kiste bestätigen' : 'Kiste kaufen bestätigen',
      message: isOwn
        ? '⚠️ Nur verbuchen, wenn die Kiste wirklich im Kühlraum steht!\n\nJetzt als Freibier-Kiste eintragen (0 €)?'
        : `Diese Kiste wird als Freibier bereitgestellt und mit ${euro(cratePrice)} auf dein Konto verbucht.\n\nJetzt wirklich verbuchen?`,
      onConfirm: () => handleCrateCreate(cratePrice),
    })
  }

  const handleCrateCreate = async (price_cents: number) => {
    if (!selectedDrink) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('crates').insert({
      drink_id: selectedDrink.id,
      quantity_total: 20,
      quantity_remaining: 20,
      is_free: true,
      created_by: user.id,
      price_cents,
      created_at: new Date().toISOString(),
    })

    if (price_cents > 0)
      await supabase.rpc('increment_balance', { user_id: user.id, amount: price_cents })

    addToast(
      price_cents > 0
        ? `📦 Kiste ${selectedDrink.name} bereitgestellt (${euro(price_cents)})`
        : `🧊 Eigene Kiste ${selectedDrink.name} (0 €)`
    )

    await loadStats()
    await fetchFreeCrates()
  }

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
              Jetzt verbuchen
            </button>
          </section>

          {/* 📦 Kisten */}
          <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 space-y-3">
            <h2 className="text-xl font-semibold">📦 Kiste bereitstellen</h2>
            {!selectedDrink && <p className="text-sm text-neutral-500">Bitte zuerst ein Getränk wählen.</p>}
            {selectedDrink && (
              <>
                <p className="text-sm text-neutral-400">
                  Kistenpreis {selectedDrink.name}: {euro(selectedDrink.crate_price_cents)}
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

          {/* 🎉 Freibier-Kisten */}
          <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6">
            <h2 className="text-xl font-semibold mb-3">🎉 Aktive Freibier-Kisten</h2>
            {freeCrates.length === 0 && <p className="text-neutral-500 text-sm">Keine aktiven Freibier-Kisten.</p>}
            <ul className="space-y-2 text-sm">
              {freeCrates.map((c) => {
                const dn = Array.isArray(c.drinks) ? (c.drinks[0]?.name ?? 'Unbekannt') : c.drinks?.name
                return (
                  <li key={c.id} className="flex justify-between bg-green-900/30 border border-green-600 rounded-lg p-2">
                    <span>{dn} • {c.quantity_remaining} übrig</span>
                    <span className="text-neutral-400">🎉</span>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* 🧾 Letzte Buchungen */}
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
                  Für <span className="font-semibold text-white">{freeChoiceDrink.name}</span> ist Freibier verfügbar.<br />
                  Du möchtest <span className="font-semibold">{pendingQty}</span> Stück verbuchen.
                </p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <button onClick={() => finalizeFreeDecision(true)} className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-white">🎉 Freibier nehmen</button>
                  <button onClick={() => finalizeFreeDecision(false)} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white">💰 Bezahlen</button>
                </div>
                <button onClick={() => setFreeChoiceDrink(null)} className="mt-4 text-sm text-neutral-400 underline">Abbrechen</button>
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
