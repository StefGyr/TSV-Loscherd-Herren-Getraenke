'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase-browser'

type Drink = {
  id: number
  name: string
  price_cents: number
  crate_price_cents: number
}

type Profile = {
  id: string
  first_name: string
  last_name: string
  pin: string
  open_balance_cents: number
}

type WeekRow = { name: string; qty: number }
const BOTTLES_PER_CRATE = 20
const euro = (c: number) => (c / 100).toFixed(2) + ' €'

export default function TerminalPage() {
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [popup, setPopup] = useState<{
    title: string
    message: string
    onConfirm?: () => void
    freeConfirm?: () => void
  } | null>(null)
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})
  const [time, setTime] = useState('')
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Uhrzeit ---
  useEffect(() => {
    const update = () => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const i = setInterval(update, 60000)
    return () => clearInterval(i)
  }, [])

  // --- Wochenstart (Montag 00:00) ---
  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  // --- Platzbelegung laden (für PIN-Screen rechts) ---
  useEffect(() => {
    const loadPlatzbelegung = async () => {
      const start = startOfWeekMonday()
      const end = new Date(start)
      end.setDate(start.getDate() + 7)
      end.setHours(23, 59, 59, 999)

      const { data, error } = await supabase
        .from('platzbelegung')
        .select('*')
        .gte('date', start.toISOString())
        .lte('date', end.toISOString())
        .order('date', { ascending: true })

      if (error) {
        console.error('Fehler beim Laden:', error)
        return
      }

      const grouped: Record<string, any[]> = {}
      for (const e of data ?? []) {
        const label = `${new Date(e.date).toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
        })}`
        if (!grouped[label]) grouped[label] = []
        grouped[label].push(e)
      }
      setGroupedByDay(grouped)
    }
    loadPlatzbelegung()
  }, [])

  // --- Drinks laden ---
  useEffect(() => {
    const loadDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // --- Wochenverbrauch des Users laden ---
  const loadMyWeekStats = async (uid: string) => {
    const from = startOfWeekMonday()
    const { data, error } = await supabase
      .from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())

    if (error) {
      console.error('Fehler Verbrauch:', error)
      return
    }
    const total = (data ?? []).reduce((s, r: any) => s + (r.quantity || 0), 0)
    setMyWeekTotal(total)
  }

  // --- Login ---
  const handleLogin = async () => {
    const input = pin.trim()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, pin, open_balance_cents')

    if (error || !data) return setToast('⚠️ Fehler beim Abruf')

    const match = data.find((p: any) => String(p.pin).trim() === input)
    if (!match) {
      setToast('❌ Falscher PIN')
      setPin('')
      return
    }

    const u: Profile = {
      id: match.id,
      first_name: match.first_name,
      last_name: match.last_name,
      pin: match.pin,
      open_balance_cents: match.open_balance_cents ?? 0,
    }
    setUser(u)
    setPin('')
    setStep('overview')
    await loadMyWeekStats(u.id)
  }

  // --- Logout + Auto-Reset ---
  const handleLogout = () => {
    setUser(null)
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
  }

  // --- Auto-Logout (nur in overview) ---
  const resetTimer = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => handleLogout(), 60000)
  }
  useEffect(() => {
    if (step === 'overview') resetTimer()
    const a = () => step === 'overview' && resetTimer()
    window.addEventListener('click', a)
    window.addEventListener('keydown', a)
    return () => {
      window.removeEventListener('click', a)
      window.removeEventListener('keydown', a)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [step])

  // --- Verbuchung (Singles, mit Freibier-Logik) ---
  const confirmSinglesBooking = async (free: boolean) => {
    if (!user) return
    if (drinks.every((d) => d.qty === 0)) return setToast('❌ Bitte Getränk wählen!')

    for (const d of drinks.filter((x) => x.qty > 0)) {
      let useFree = false
      let price = d.price_cents

      if (free) {
        const { data: crates } = await supabase
          .from('crates')
          .select('id, quantity_remaining')
          .eq('drink_id', d.id)
          .eq('is_free', true)
          .gt('quantity_remaining', 0)
          .limit(1)

        if (crates && crates.length > 0) {
          const crate = crates[0]
          useFree = true
          price = 0

          await supabase
            .from('crates')
            .update({ quantity_remaining: Math.max(0, crate.quantity_remaining - d.qty) })
            .eq('id', crate.id)
        }
      }

      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: d.id,
        quantity: d.qty,
        source: useFree ? 'crate' : 'single',
        unit_price_cents: price,
        via_terminal: true,
        created_at: new Date().toISOString(),
      })

      if (!useFree) {
        const delta = d.qty * price
        const { data: upd } = await supabase
          .from('profiles')
          .update({ open_balance_cents: user.open_balance_cents + delta })
          .eq('id', user.id)
          .select('open_balance_cents')
          .single()
        if (upd) setUser({ ...user, open_balance_cents: upd.open_balance_cents })
      }
    }

    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    await loadMyWeekStats(user.id)
    setToast(free ? '🎉 Freibier (falls verfügbar) verbucht!' : '💰 Getränke bezahlt!')
    setTimeout(() => handleLogout(), 2000)
  }

  // --- Popup öffnen (zeigt, ob Freibier verfügbar) ---
  const openBookingPopup = async () => {
    if (!user) return setToast('⚠️ Kein Nutzer eingeloggt!')
    if (drinks.every((d) => d.qty === 0)) return setToast('❌ Bitte Getränk wählen!')

    const total = drinks.reduce((sum, d) => sum + d.qty * d.price_cents, 0)
    const selectedDrinks = drinks.filter((x) => x.qty > 0)

    // Prüfen, ob irgendwo Freibier verfügbar ist
    let freeAvailable = false
    for (const d of selectedDrinks) {
      const { data: crates } = await supabase
        .from('crates')
        .select('id')
        .eq('drink_id', d.id)
        .eq('is_free', true)
        .gt('quantity_remaining', 0)
        .limit(1)

      if (crates && crates.length > 0) {
        freeAvailable = true
        break
      }
    }

    setPopup({
      title: 'Buchung bestätigen',
      message: `Du hast ${selectedDrinks
        .map((x) => `${x.qty}× ${x.name}`)
        .join(', ')} im Wert von ${euro(total)}.\n\nWie möchtest du verbuchen?`,
      onConfirm: () => confirmSinglesBooking(false),
      freeConfirm: freeAvailable ? () => confirmSinglesBooking(true) : undefined,
    })
  }

  // --- UI ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>TSV Lonnerstadt • Herren-Terminal</span>
      </header>

      {/* Inhalt */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 h-[calc(100vh-3.5rem)]">
        {/* Links – PIN */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 flex flex-col items-center justify-center overflow-hidden">
          {step === 'pin' && (
            <div className="w-full max-w-xs text-center">
              <h1 className="text-3xl font-semibold mb-8 text-white">🔒 PIN-Eingabe</h1>
              <div className="flex justify-center gap-3 mb-8">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-5 h-5 rounded-full border-2 ${
                      i < pin.length ? 'bg-white border-white' : 'border-neutral-600'
                    }`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPin((p) => (p + n).slice(0, 6))}
                    className="h-16 text-2xl font-semibold bg-neutral-800 hover:bg-neutral-700 rounded-xl shadow-md transition"
                  >
                    {n}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => setPin((p) => (p + '0').slice(0, 6))}
                  className="h-16 text-2xl font-semibold bg-neutral-800 hover:bg-neutral-700 rounded-xl shadow-md transition"
                >
                  0
                </button>
                <div />
              </div>
              <div className="flex justify-center gap-4">
                <button
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="px-5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-lg transition"
                >
                  Löschen
                </button>
                <button
                  onClick={handleLogin}
                  className="px-7 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white text-lg font-medium shadow-md transition"
                >
                  Bestätigen
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Rechts – Platzbelegung (vor Login) ODER Übersicht + Getränke (nach Login) */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
          {step === 'pin' && (
            <>
              <h3 className="text-xl mb-4 flex items-center gap-2">⚽ Wochenübersicht Platzbelegung</h3>
              <div className="space-y-6 pr-2">
                {Object.entries(groupedByDay).map(([day, entries]) => (
                  <div key={day} className="border-l-4 border-green-600 pl-4">
                    <h4 className="text-lg font-medium text-white mb-2">{day}</h4>
                    <div className="space-y-2">
                      {entries.map((p, i) => (
                        <div
                          key={i}
                          className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 text-sm flex flex-col hover:bg-neutral-800/70 transition"
                        >
                          <div className="flex justify-between text-neutral-300">
                            <span className="font-semibold">{p.field ? `${p.field}-Platz` : '—'}</span>
                            <span>{p.time || '—'}</span>
                          </div>
                          <div className="text-neutral-400 mt-1">
                            {p.team_home || '—'}
                            {p.team_guest && (
                              <>
                                {' '}
                                <span className="text-neutral-500">vs.</span> {p.team_guest}
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 'overview' && user && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">👋 Willkommen, {user.first_name}</h2>
                <button
                  onClick={handleLogout}
                  className="text-sm px-4 py-2 bg-neutral-800 rounded-lg hover:bg-neutral-700 transition"
                >
                  Logout
                </button>
              </div>

              {/* Persönliche Icons */}
              <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-1">🍺</div>
                  <div className="text-sm text-neutral-400">Verbrauch (Woche)</div>
                  <div className="text-lg font-semibold">{myWeekTotal}</div>
                </div>
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center">
                  <div className="text-2xl mb-1">💰</div>
                  <div className="text-sm text-neutral-400">Offener Betrag</div>
                  <div className="text-lg font-semibold">{euro(user.open_balance_cents)}</div>
                </div>
              </div>

              {/* Getränke mit +/- */}
              <div className="space-y-2">
                {drinks.map((d) => (
                  <div
                    key={d.id}
                    className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex justify-between items-center hover:bg-neutral-800/70 transition"
                  >
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-neutral-500">{euro(d.price_cents)} / Stk</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          setDrinks((prev) =>
                            prev.map((x) => (x.id === d.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x))
                          )
                        }
                        className="w-9 h-9 bg-neutral-800 rounded-lg text-xl"
                      >
                        –
                      </button>
                      <span className="w-6 text-center">{d.qty}</span>
                      <button
                        onClick={() =>
                          setDrinks((prev) =>
                            prev.map((x) => (x.id === d.id ? { ...x, qty: x.qty + 1 } : x))
                          )
                        }
                        className="w-9 h-9 bg-neutral-800 rounded-lg text-xl"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={openBookingPopup}
                className="w-full h-14 rounded-2xl bg-white text-black hover:bg-gray-200 text-lg font-medium mt-6"
              >
                📤 Jetzt verbuchen
              </button>
            </>
          )}
        </div>
      </div>

      {/* Popup */}
      <AnimatePresence>
        {popup && (
          <motion.div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <motion.div className="bg-neutral-900/95 p-6 rounded-2xl border border-neutral-700 max-w-sm w-full text-center shadow-2xl">
              <h3 className="text-lg font-semibold mb-2">{popup.title}</h3>
              <p className="text-sm text-neutral-300 mb-6 whitespace-pre-line">{popup.message}</p>
              <div className="flex justify-center gap-4">
                <button
                  onClick={() => setPopup(null)}
                  className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600"
                >
                  Abbrechen
                </button>
                {popup.freeConfirm && (
                  <button
                    onClick={() => {
                      popup.freeConfirm?.()
                      setPopup(null)
                    }}
                    className="px-4 py-2 bg-yellow-600 rounded hover:bg-yellow-700"
                  >
                    Freibier
                  </button>
                )}
                <button
                  onClick={() => {
                    popup.onConfirm?.()
                    setPopup(null)
                  }}
                  className="px-4 py-2 bg-green-700 rounded hover:bg-green-800"
                >
                  Bezahlen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
