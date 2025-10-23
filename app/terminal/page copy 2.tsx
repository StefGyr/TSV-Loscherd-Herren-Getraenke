'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [step, setStep] = useState<'pin' | 'overview' | 'logout'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [allWeek, setAllWeek] = useState<WeekRow[]>([])
  const [allPlatzData, setAllPlatzData] = useState<any[]>([])
const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})

// Platzbelegung der aktuellen Woche laden
const loadPlatzbelegung = async () => {
  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay() + 1)
  startOfWeek.setHours(0, 0, 0, 0)

  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)

  const { data, error } = await supabase
    .from('platzbelegung')
    .select('*')
    .gte('date', startOfWeek.toISOString())
    .lt('date', endOfWeek.toISOString())
    .order('date', { ascending: true })

  if (error) {
    console.error('Fehler beim Laden:', error)
    return
  }

  setAllPlatzData(data || [])

  // Gruppierung nach Tag
  const grouped: Record<string, any[]> = {}
  for (const e of data || []) {
    const label = `${e.day || new Date(e.date).toLocaleDateString('de-DE', {
      weekday: 'short',
    })} ${new Date(e.date).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
    })}`
    if (!grouped[label]) grouped[label] = []
    grouped[label].push(e)
  }

  setGroupedByDay(grouped)
}

// beim Laden ausführen
useEffect(() => {
  loadPlatzbelegung()
}, [])

  const [myWeek, setMyWeek] = useState<WeekRow[]>([])
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [popup, setPopup] = useState<{
    title: string
    message: string
    onConfirm?: () => void
    freeConfirm?: () => void
  } | null>(null)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Uhrzeit ---
  const [time, setTime] = useState('')
  useEffect(() => {
    const update = () => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const i = setInterval(update, 60000)
    return () => clearInterval(i)
  }, [])

  // --- Auto-Logout ---
  const resetTimer = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => handleLogout(), 60000)
  }
  useEffect(() => {
    if (step === 'overview') resetTimer()
    const a = () => resetTimer()
    window.addEventListener('click', a)
    window.addEventListener('keydown', a)
    return () => {
      window.removeEventListener('click', a)
      window.removeEventListener('keydown', a)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [step])

  // --- Daten laden ---
  useEffect(() => {
    loadDrinks()
    loadAllWeekStats()
  }, [])

  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  const loadDrinks = async () => {
    const { data } = await supabase.from('drinks').select('*').order('name')
    setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
  }

  const loadAllWeekStats = async () => {
    const from = startOfWeekMonday()
    const { data } = await supabase
      .from('consumptions')
      .select('quantity, drinks(name)')
      .gte('created_at', from.toISOString())

    const map: Record<string, number> = {}
    for (const r of data ?? []) {
      const drinkName =
        (Array.isArray(r.drinks)
          ? r.drinks[0]?.name
          : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
      map[drinkName] = (map[drinkName] || 0) + (r.quantity || 0)
    }
    setAllWeek(Object.entries(map).map(([name, qty]) => ({ name, qty })))
  }

  const loadMyWeekStats = async (uid: string) => {
    const from = startOfWeekMonday()
    const { data } = await supabase
      .from('consumptions')
      .select('quantity, drinks(name)')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())

    const map: Record<string, number> = {}
    let total = 0
    for (const r of data ?? []) {
      const drinkName =
        (Array.isArray(r.drinks)
          ? r.drinks[0]?.name
          : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
      const qty = r.quantity || 0
      map[drinkName] = (map[drinkName] || 0) + qty
      total += qty
    }
    setMyWeek(Object.entries(map).map(([name, qty]) => ({ name, qty })))
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
    setUser({
      id: match.id,
      first_name: match.first_name,
      last_name: match.last_name,
      pin: match.pin,
      open_balance_cents: match.open_balance_cents ?? 0,
    })
    setPin('')
    await loadMyWeekStats(match.id)
    setStep('overview')
  }

  const handleLogout = () => {
    setStep('logout')
    setTimeout(() => {
      setUser(null)
      setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
      setStep('pin')
    }, 800)
  }

  // --- Freibier oder Bezahlen ---
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

      // ✅ Terminal-Buchung einfügen
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
    await loadAllWeekStats()
    setToast(free ? '🎉 Freibier (soweit verfügbar) verbucht!' : '💰 Getränke bezahlt!')
    setTimeout(() => handleLogout(), 2000)
  }

  const openBookingPopup = async () => {
  if (!user) return setToast('⚠️ Kein Nutzer eingeloggt!')
  if (drinks.every((d) => d.qty === 0)) return setToast('❌ Bitte Getränk wählen!')

  const total = drinks.reduce((sum, d) => sum + d.qty * d.price_cents, 0)
  const selectedDrinks = drinks.filter((x) => x.qty > 0)

  // 🔹 Prüfen, ob für eines der gewählten Getränke Freibier verfügbar ist
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
    freeConfirm: freeAvailable ? () => confirmSinglesBooking(true) : undefined, // ✅ Nur wenn verfügbar
  })
}


  const confirmCrateBooking = (drink: Drink) => {
    const price = euro(drink.crate_price_cents)
    setPopup({
      title: 'Kiste bestätigen',
      message: `⚠️ Diese Kiste wird NICHT als Freibier gezählt und mit ${price} auf dein Konto verbucht.\n\nJetzt wirklich verbuchen?`,
      onConfirm: async () => {
        if (!user) return
        const unit = Math.floor(drink.crate_price_cents / BOTTLES_PER_CRATE)
        await supabase.from('consumptions').insert({
          user_id: user.id,
          drink_id: drink.id,
          quantity: BOTTLES_PER_CRATE,
          source: 'crate',
          unit_price_cents: unit,
          via_terminal: true, // ✅ Kennzeichnung Terminal-Buchung
          created_at: new Date().toISOString(),
        })
        const delta = drink.crate_price_cents
        const { data: upd } = await supabase
          .from('profiles')
          .update({ open_balance_cents: user.open_balance_cents + delta })
          .eq('id', user.id)
          .select('open_balance_cents')
          .single()
        if (upd) setUser({ ...user, open_balance_cents: upd.open_balance_cents })
        setToast(`🍺 Kiste ${drink.name} verbucht!`)
        await loadMyWeekStats(user.id)
        await loadAllWeekStats()
        setTimeout(() => handleLogout(), 2000)
      },
    })
  }

  const maxAll = allWeek.length ? Math.max(...allWeek.map((w) => w.qty)) : 1
  const maxMy = myWeek.length ? Math.max(...myWeek.map((w) => w.qty)) : 1

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <div className="flex items-center gap-4">
          <span>TSV Lonnerstadt • Herren-Terminal</span>
          {step === 'overview' && (
            <button
              onClick={handleLogout}
              className="ml-4 px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-white border border-neutral-600"
            >
              Logout
            </button>
          )}
        </div>
      </header>

      {/* Layout etc. bleibt gleich */}
      {/* ... dein restlicher Code unverändert ... */}


      {/* Layout */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Linke Seite */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 flex flex-col items-center justify-center">
          {/* PIN oder Übersicht */}
          {step === 'pin' && (
            <div className="w-full max-w-sm text-center">
              <h1 className="text-4xl font-semibold mb-10 text-white">🔒 PIN-Eingabe</h1>
              <div className="flex justify-center gap-4 mb-10">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-6 h-6 rounded-full border-2 ${
                      i < pin.length ? 'bg-white border-white' : 'border-neutral-600'
                    }`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-5 mb-8">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPin((p) => (p + n).slice(0, 6))}
                    className="h-20 text-3xl font-semibold bg-neutral-800 hover:bg-neutral-700 rounded-2xl shadow-md transition"
                  >
                    {n}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => setPin((p) => (p + '0').slice(0, 6))}
                  className="h-20 text-3xl font-semibold bg-neutral-800 hover:bg-neutral-700 rounded-2xl shadow-md transition"
                >
                  0
                </button>
                <div />
              </div>
              <div className="flex justify-center gap-5">
                <button
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="px-6 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-lg transition"
                >
                  Löschen
                </button>
                <button
                  onClick={handleLogin}
                  className="px-8 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white text-lg font-medium shadow-md transition"
                >
                  Bestätigen
                </button>
              </div>
            </div>
          )}

          {step === 'overview' && user && (
            <>
              <div className="text-center mb-6">
                <h2 className="text-2xl">Hallo {user.first_name}! 👋</h2>
                <p className="text-sm text-neutral-400 mt-1">
                  💰 Kontostand:{' '}
                  <span className={user.open_balance_cents > 0 ? 'text-red-400' : 'text-green-400'}>
                    {euro(user.open_balance_cents)}
                  </span>{' '}
                  • 📅 Diese Woche: {myWeekTotal} Getränke
                </p>
              </div>

              {drinks.map((d) => (
                <div
                  key={d.id}
                  className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-4 flex justify-between items-center"
                >
                  <div>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-neutral-500">
                      {euro(d.price_cents)} / Stk • Kiste {euro(d.crate_price_cents)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() =>
                        setDrinks((p) =>
                          p.map((x) =>
                            x.id === d.id ? { ...x, qty: Math.max((x.qty || 0) - 1, 0) } : x
                          )
                        )
                      }
                      className="w-12 h-12 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-3xl"
                    >
                      –
                    </button>
                    <span className="w-8 text-center text-xl">{d.qty}</span>
                    <button
                      onClick={() =>
                        setDrinks((p) =>
                          p.map((x) =>
                            x.id === d.id ? { ...x, qty: (x.qty || 0) + 1 } : x
                          )
                        )
                      }
                      className="w-12 h-12 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-3xl"
                    >
                      +
                    </button>
                    <button
                      onClick={() => confirmCrateBooking(d)}
                      className="ml-2 px-3 h-12 rounded-lg bg-white text-black hover:bg-gray-200 text-sm"
                    >
                      Kiste auf meinen Nacken
                    </button>
                  </div>
                </div>
              ))}

              <button
                onClick={openBookingPopup}
                className="w-full h-14 rounded-2xl bg-white text-black hover:bg-gray-200 text-lg font-medium mt-6"
              >
                Jetzt verbuchen ({euro(drinks.reduce((s, d) => s + d.qty * d.price_cents, 0))})
              </button>

              <p className="text-xs text-neutral-500 text-center mt-2">
                ℹ️ Kisten gelten nicht als Freibier.
              </p>
            </>
          )}
        </div>

        {/* Rechte Seite */}
        {/* Rechte Seite – Platzbelegung */}
<div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
  <h3 className="text-xl mb-4">⚽ Wochenübersicht Platzbelegung</h3>

  <div className="space-y-6">
    {allPlatzData.length === 0 && (
      <p className="text-neutral-500 text-sm">Keine Daten vorhanden.</p>
    )}

    {Object.entries(groupedByDay).map(([day, entries]) => (
      <div key={day} className="border-l-4 border-green-600 pl-4">
        <h4 className="text-lg font-medium text-white mb-2">{day}</h4>

        <div className="space-y-2">
          {entries.map((p, i) => (
            <div
              key={i}
              className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 text-sm flex flex-col"
            >
              <div className="flex justify-between text-neutral-300">
                <span className="font-semibold">{p.field || '—'}</span>
                <span>{p.time || '—'}</span>
              </div>
              <div className="text-neutral-400 mt-1">
                {p.team_home || '—'}
                {p.team_guest && (
                  <>
                    {' '}
                    <span className="text-neutral-500">vs.</span>{' '}
                    {p.team_guest}
                  </>
                )}
              </div>
              {p.section && (
                <div className="text-xs text-neutral-500 mt-1">
                  {p.section} {p.competition ? `• ${p.competition}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
</div>

      </div>

      {/* --- POPUP --- */}
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

      {/* --- TOAST --- */}
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