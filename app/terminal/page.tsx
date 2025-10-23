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
  const [step, setStep] = useState<'pin' | 'overview' | 'logout'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [allWeek, setAllWeek] = useState<WeekRow[]>([])
  const [myWeek, setMyWeek] = useState<WeekRow[]>([])
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [popup, setPopup] = useState<{
    title: string
    message: string
    onConfirm?: () => void
    freeConfirm?: () => void
  } | null>(null)
  const [allPlatzData, setAllPlatzData] = useState<any[]>([])
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [time, setTime] = useState('')

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

  // --- Platzbelegung laden ---
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

    if (error) return console.error('Fehler beim Laden:', error)
    setAllPlatzData(data || [])

    const grouped: Record<string, any[]> = {}
    for (const e of data || []) {
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

  useEffect(() => {
    loadPlatzbelegung()
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

  // --- LAYOUT ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>TSV Lonnerstadt • Herren-Terminal</span>
      </header>

      {/* Layout */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 h-[calc(100vh-3.5rem)]">
        {/* Linke Seite – PIN */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 flex flex-col items-center justify-center overflow-hidden">
          {step === 'pin' && (
            <div className="w-full max-w-xs text-center">
              <h1 className="text-3xl font-semibold mb-8 text-white flex items-center justify-center gap-2">
                🔒 PIN-Eingabe
              </h1>
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

        {/* Rechte Seite – Platzbelegung */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
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
                        <span className="font-semibold">
                          {p.field ? `${p.field}-Platz` : '—'}
                        </span>
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
