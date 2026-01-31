'use client'

import React, { useEffect, useState, useMemo } from 'react'
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

  // ⚡️ Optimistic State
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<any[]>([])
  const [freePool, setFreePool] = useState<number>(0)

  const [bierPrice, setBierPrice] = useState<number>(0)

  // Freibier-/Popup-States
  const [freeChoiceDrink, setFreeChoiceDrink] = useState<any | null>(null)
  const [pendingQty, setPendingQty] = useState<number>(0)
  const [popup, setPopup] = useState(false) // Bezahlen-Bestätigung
  const [freePopup, setFreePopup] = useState(false) // Freigetränke bereitstellen
  const [partialPopup, setPartialPopup] = useState<{ free: number; pay: number } | null>(null) // Teil-Freibier
  const [toasts, setToasts] = useState<{ id: number; text: string; type: 'success' | 'error' }[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }

  // ---------------- Loader ----------------
  const refreshBookings = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const { data } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, source, created_at, drinks(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)

    setBookings(
      (data || []).map((r: any) => {
        let text = ''
        let type: 'paid' | 'free' | 'crate' = 'paid'

        const isCrateProvision = r.source === 'crate' && (r.quantity || 0) === 0
        let price = (r.unit_price_cents || 0) * (r.quantity || 0)

        if (isCrateProvision) {
          type = 'crate'
          text = `Kiste / Freibier bereitgestellt`
          price = r.unit_price_cents || 0
        } else if (r.source === 'crate') {
          type = 'crate'
          text = `Kiste gekauft (${r.quantity} Fl.)`
        } else if (r.unit_price_cents === 0) {
          type = 'free'
          text = `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Freibier)`
        } else {
          type = 'paid'
          text = `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'}`
        }

        return {
          created_at: r.created_at,
          text,
          price,
          type,
          drinkName: r.drinks?.name
        }
      }),
    )
  }

  const [monthTotal, setMonthTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string>('—')

  const loadUserStats = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

    // 1. Monats-Verbrauch & Favorit (basierend auf Monat, performance-freundlich)
    const { data, error } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, drink_id, drinks(name)')
      .eq('user_id', user.id)
      .gte('created_at', startOfMonth)
      .lte('created_at', endOfMonth)

    if (!error && data) {
      // Summe in Euro
      const sum = data.reduce((acc, c) => acc + ((c.quantity || 0) * (c.unit_price_cents || 0)), 0)
      setMonthTotal(sum)

      // Favorit ermitteln
      const counts: Record<string, number> = {}
      data.forEach((c: any) => {
        if (c.drinks?.name) {
          counts[c.drinks.name] = (counts[c.drinks.name] || 0) + (c.quantity || 0)
        }
      })
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      setFavoriteDrink(top ? `${top[0]} (${top[1]})` : '—')
    }
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

      await Promise.all([refreshBookings(), loadUserStats()])
    }
    init()

    // 🔁 Auto-Refresh alle 60 Sekunden
    const interval = setInterval(() => {
      init()
    }, 60000)

    // 📅 Wenn ein neuer Tag beginnt → Seite komplett neu laden
    const checkDayChange = setInterval(() => {
      const now = new Date()
      const saved = sessionStorage.getItem('lastDay')
      const today = now.toDateString()
      if (saved && saved !== today) {
        window.location.reload()
      }
      sessionStorage.setItem('lastDay', today)
    }, 30000)

    return () => {
      clearInterval(interval)
      clearInterval(checkDayChange)
    }
  }, [])





  // ---------------- Buchung (Bezahlen) ----------------
  const handlePaidBooking = async (drink: any, qty: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)

    const total = drink.price_cents * qty
    const now = new Date().toISOString()

    // ⚡️ Optimistic Update: Sofort anzeigen
    const prevBalance = balance
    setBalance((b) => b + total)
    setBookings(prev => [{
      created_at: now,
      text: `${qty}× ${drink.name}`,
      price: total,
      type: 'paid',
      drinkName: drink.name
    }, ...prev])

    // UI Resets
    setPopup(false)
    addToast(`💰 ${qty}× ${drink.name} verbucht`)
    setSelectedDrink(null)
    setQuantity(1)
    setFreeChoiceDrink(null)

    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) throw new Error('No User')

      const { error: insErr } = await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: drink.id,
        quantity: qty,
        unit_price_cents: drink.price_cents,
        source: 'single',
        created_at: now,
      })
      if (insErr) throw insErr

      await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: total })

      refreshBookings()
      loadUserStats()
    } catch (err) {
      console.error(err)
      setBalance(prevBalance)
      addToast('❌ Fehler: Buchung rückgängig gemacht', 'error')
      refreshBookings()
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---------------- Freibier (vollständig oder teilweise) ----------------
  const handleFreeBooking = async (drink: any, qty: number) => {
    const freeQty = Math.min(qty, freePool)
    const payQty = qty - freeQty

    // Teil-Freibier → erst Info-Popup, dann aufteilen
    if (payQty > 0 && freeQty > 0) {
      setPartialPopup({ free: freeQty, pay: payQty })
      return
    }

    if (isSubmitting) return
    setIsSubmitting(true)
    const now = new Date().toISOString()

    // ⚡️ Optimistic Update
    const prevPool = freePool
    setFreePool((p) => Math.max(0, p - freeQty))
    setBookings(prev => [{
      created_at: now,
      text: `${freeQty}× ${drink.name} (Freibier)`,
      price: 0,
      type: 'free',
      drinkName: drink.name
    }, ...prev])

    // UI Reset
    addToast(`🎉 ${freeQty}× ${drink.name} als Freibier verbucht`)
    setFreeChoiceDrink(null)
    setSelectedDrink(null)

    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) throw new Error('No User')

      const { error: insErr } = await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: drink.id,
        quantity: freeQty,
        unit_price_cents: 0,
        source: 'single',
        created_at: now,
      })
      if (insErr) throw insErr

      await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: freeQty })

      refreshBookings()
      loadUserStats()
    } catch (err) {
      console.error(err)
      setFreePool(prevPool)
      addToast('❌ Fehler: Freibier-Buchung gescheitert', 'error')
      refreshBookings()
    } finally {
      setIsSubmitting(false)
    }
  }

  const confirmPartialFreeBooking = async () => {
    if (!freeChoiceDrink || !partialPopup) return
    if (isSubmitting) return
    setIsSubmitting(true)

    const { free, pay } = partialPopup
    const now = new Date().toISOString()
    const totalPay = freeChoiceDrink.price_cents * pay

    // ⚡️ Optimistic Update (Mix)
    const prevBalance = balance
    const prevPool = freePool

    setBalance((b) => b + totalPay)
    setFreePool(p => Math.max(0, p - free))

    // Eintrag UI
    const newEntries: any[] = []
    if (pay > 0) newEntries.push({ created_at: now, text: `${pay}× ${freeChoiceDrink.name}`, price: totalPay, type: 'paid', drinkName: freeChoiceDrink.name })
    if (free > 0) newEntries.push({ created_at: now, text: `${free}× ${freeChoiceDrink.name} (Freibier)`, price: 0, type: 'free', drinkName: freeChoiceDrink.name })

    setBookings(prev => [...newEntries, ...prev])

    // UI Reset
    setPartialPopup(null)
    setFreeChoiceDrink(null)
    setSelectedDrink(null)
    addToast(`💰 ${pay}× bezahlt, 🎉 ${free}× frei`)

    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) throw new Error('No User')

      // Freibier-Teil
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

      // Bezahl-Teil
      if (pay > 0) {
        await supabase.from('consumptions').insert({
          user_id: user.id,
          drink_id: freeChoiceDrink.id,
          quantity: pay,
          unit_price_cents: freeChoiceDrink.price_cents,
          source: 'single',
          created_at: now,
        })
        await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: totalPay })
      }

      refreshBookings()
      loadUserStats()
    } catch (err) {
      console.error(err)
      setBalance(prevBalance)
      setFreePool(prevPool)
      addToast('❌ Fehler: Teilzahlung fehlgeschlagen', 'error')
      refreshBookings()
    } finally {
      setIsSubmitting(false)
    }
  }

  // ---------------- Freigetränke bereitstellen ----------------
  const handleProvideFreeDrinks = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)

    const now = new Date().toISOString()
    const prevBalance = balance
    const prevPool = freePool

    // ⚡️ Optimistic
    setFreePool((p) => p + BOTTLES_PER_CRATE)
    setBalance((b) => b + bierPrice)
    setBookings(prev => [{
      created_at: now,
      text: 'Freigetränke bereitgestellt',
      price: bierPrice,
      type: 'crate',
      drinkName: 'Kiste / Runde'
    }, ...prev])

    addToast('🍾 20 Freigetränke bereitgestellt!')
    setFreePopup(false)

    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) throw new Error('No User')

      // 🔹 Freibier-Pool + Kontostand aktualisieren
      await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: -BOTTLES_PER_CRATE })
      await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: bierPrice })

      // 🔹 Konsum-Eintrag für Aktivitätsseite hinzufügen
      const bierDrink = drinks.find((d: any) => d.name.toLowerCase() === 'bier')
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: bierDrink?.id ?? null,
        quantity: 0,
        unit_price_cents: bierPrice,
        source: 'crate',
        created_at: now,
      })

      refreshBookings()
      loadUserStats()
    } catch (err) {
      console.error('Fehler bei handleProvideFreeDrinks:', err)
      setBalance(prevBalance)
      setFreePool(prevPool)
      addToast('❌ Bereitstellung fehlgeschlagen', 'error')
      refreshBookings()
    } finally {
      setIsSubmitting(false)
    }
  }


  const totalPrice = useMemo(() => (selectedDrink ? selectedDrink.price_cents * quantity : 0), [selectedDrink, quantity])

  // ---------------- UI ----------------
  return (
    <>
      <TopNav />
      <div className="pt-20 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white px-4 pb-24">
        <div className="max-w-md mx-auto space-y-6">
          {/* Karten im Profilstil */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Card icon={<PiggyBank />} color="from-rose-900/80 to-rose-800/40" label="Kontostand" value={euro(balance)} />
            <Card icon={<Beer />} color="from-blue-900/80 to-blue-800/40" label="Monat (Ausgaben)" value={euro(monthTotal)} />
            <Card icon={<Gift />} color="from-purple-900/80 to-purple-800/40" label="Freibier-Pool" value={`${freePool} verfügbar`} />
            <Card icon={<Wallet />} color="from-amber-900/80 to-amber-800/40" label="Dein Top-Drink" value={favoriteDrink} />
          </div>

          {/* Letzte Buchungen (Neu & verbessert) */}
          {/* Letzte Buchungen (Neu & verbessert) */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3 px-2">
              <h2 className="text-sm font-medium text-neutral-400 uppercase tracking-wider">Deine letzten Aktivitäten</h2>
            </div>

            <div className="bg-neutral-900/50 rounded-2xl border border-neutral-800/50 overflow-hidden">
              {bookings.length === 0 && <div className="p-4 text-center text-neutral-500 text-sm">Noch keine Buchungen</div>}

              {bookings.slice(0, 3).map((b, i) => (
                <div key={i} className={`flex items-center justify-between p-3 border-b border-neutral-800/50 last:border-0 ${i === 0 ? 'bg-neutral-800/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold 
                            ${b.type === 'free' ? 'bg-emerald-900 text-emerald-200' :
                        b.type === 'crate' ? 'bg-purple-900 text-purple-200' : 'bg-neutral-800 text-neutral-300'}`}>
                      {b.type === 'free' ? '🎁' : b.type === 'crate' ? '📦' : '🍺'}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-neutral-200">{b.text}</span>
                      <span className="text-xs text-neutral-500">{shortDate(b.created_at)}</span>
                    </div>
                  </div>
                  <div className="font-mono text-sm text-neutral-400">
                    {b.type === 'free' ? '0,00 €' : euro(b.price || 0)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Getränke */}
          <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6 relative">
            <h1 className="text-2xl font-semibold mb-4">🍺 Getränk verbuchen</h1>

            {/* Overlay wenn beschäftigt */}
            <AnimatePresence>
              {isSubmitting && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 z-20 backdrop-blur-[2px] rounded-2xl flex items-center justify-center">
                  <div className="px-4 py-2 bg-neutral-900 rounded-full border border-neutral-700 shadow-xl flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span className="text-sm">Verbuche...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {drinks.map((d) => (
                <button
                  key={d.id}
                  disabled={isSubmitting}
                  onClick={() => setSelectedDrink(d)}
                  className={`p-3 rounded-xl border text-sm transition-all duration-200 ${selectedDrink?.id === d.id
                    ? 'bg-white text-black border-white shadow-lg scale-[1.02]'
                    : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                    }`}
                >
                  {d.name}
                </button>
              ))}
            </div>

            {selectedDrink && (
              <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button disabled={isSubmitting} onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-10 h-10 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-2xl disabled:opacity-50">–</button>
                  <span className="w-8 text-center text-xl">{quantity}</span>
                  <button disabled={isSubmitting} onClick={() => setQuantity((q) => q + 1)} className="w-10 h-10 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-2xl disabled:opacity-50">+</button>
                </div>
                <span className="text-sm text-neutral-400 self-center">{euro(selectedDrink.price_cents)} / Stück</span>
              </motion.div>
            )}

            <button
              disabled={!selectedDrink || isSubmitting}
              onClick={() => {
                if (freePool > 0) {
                  setFreeChoiceDrink(selectedDrink)
                  setPendingQty(quantity)
                } else {
                  setPopup(true)
                }
              }}
              className="w-full h-12 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              Jetzt verbuchen {selectedDrink ? `• ${euro(totalPrice)}` : ''}
            </button>
          </section>

          <div className="mt-4">
            <button disabled={isSubmitting} onClick={() => setFreePopup(true)} className="w-full h-12 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition disabled:opacity-50">
              🍻 Freigetränke bereitstellen
            </button>
          </div>
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

// Cards im Profil-Stil
function Card({ icon, color, label, value }: { icon: React.ReactNode; color: string; label: string; value: string }) {
  return (
    <div className={`p-4 rounded-2xl bg-gradient-to-br ${color} text-white shadow-md flex flex-col justify-center`}>
      <div className="flex items-center gap-3 mb-1">
        <div className="text-2xl">{icon}</div>
        <div className="text-sm text-neutral-200">{label}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}

// Generisches Popup
function Popup({
  title, message, onCancel, onConfirm,
}: { title: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center bg-black/70 z-50"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl border border-neutral-700 max-w-sm w-full"
      >
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
