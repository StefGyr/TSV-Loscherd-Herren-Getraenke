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

const euro = (c: number) => (c / 100).toFixed(2) + ' €'

export default function TerminalPage() {
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [selectedCrateDrink, setSelectedCrateDrink] = useState<number>(0)
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string | null>(null)
  const [lastPayment, setLastPayment] = useState<{ date: string; amount: number } | null>(null)
  const [freeCrates, setFreeCrates] = useState<number>(0)
  const [toast, setToast] = useState<string | null>(null)
  const [time, setTime] = useState('')
  const [timer, setTimer] = useState(60)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 🏟 Platzbelegung
  const [groupedByDay, setGroupedByDay] = useState<
    Record<
      string,
      {
        id: number
        date: string
        time: string
        team_home: string
        team_guest: string
        competition: string
        section: string
        field: string
        location: string
      }[]
    >
  >({})

  // Uhrzeit
  useEffect(() => {
    const update = () => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const i = setInterval(update, 60000)
    return () => clearInterval(i)
  }, [])

  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  // 🧾 Drinks laden
  useEffect(() => {
    const loadDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // 🗓 Platzbelegung laden
  useEffect(() => {
    const loadPlatzbelegung = async () => {
      const monday = startOfWeekMonday()
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)

      const { data, error } = await supabase
        .from('platzbelegung')
        .select('*')
        .gte('date', monday.toISOString().split('T')[0])
        .lte('date', sunday.toISOString().split('T')[0])
        .order('date', { ascending: true })
        .order('time', { ascending: true })

      if (error) {
        console.error('❌ Fehler beim Laden der Platzbelegung:', error)
        return
      }

      if (!data || data.length === 0) {
        console.log('ℹ️ Keine Platzbelegung gefunden.')
        setGroupedByDay({})
        return
      }

      const grouped: Record<string, any[]> = {}
      for (const e of data) {
        const day = new Date(e.date).toLocaleDateString('de-DE', {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
        })
        if (!grouped[day]) grouped[day] = []
        grouped[day].push(e)
      }

      setGroupedByDay(grouped)
    }

    loadPlatzbelegung()
  }, [])

  // 🧍 Login
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
    await Promise.all([
      loadMyWeekStats(u.id),
      loadFavoriteDrink(u.id),
      loadLastPayment(u.id),
      loadFreeCrates(),
    ])
  }

  const handleLogout = () => {
    setUser(null)
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
    setTimer(60)
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  }

  // ⏱ Auto-Logout
  useEffect(() => {
    if (step === 'overview') {
      const countdown = setInterval(() => {
        setTimer((t) => {
          if (t <= 1) {
            clearInterval(countdown)
            handleLogout()
            return 0
          }
          return t - 1
        })
      }, 1000)

      const reset = () => setTimer(60)
      window.addEventListener('click', reset)
      window.addEventListener('keydown', reset)
      return () => {
        clearInterval(countdown)
        window.removeEventListener('click', reset)
        window.removeEventListener('keydown', reset)
      }
    }
  }, [step])

  // 📊 Zusatzdaten laden
  const loadMyWeekStats = async (uid: string) => {
    const from = startOfWeekMonday()
    const { data } = await supabase
      .from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }

  const loadFavoriteDrink = async (uid: string) => {
    const { data } = await supabase.from('consumptions').select('quantity, drinks(name)').eq('user_id', uid)
    if (!data?.length) return setFavoriteDrink('—')
    const count: Record<string, number> = {}
    for (const r of data) {
      const name =
        (Array.isArray(r.drinks)
          ? r.drinks[0]?.name
          : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
      count[name] = (count[name] || 0) + (r.quantity || 0)
    }
    const fav = Object.entries(count).sort((a, b) => b[1] - a[1])[0]
    setFavoriteDrink(fav ? fav[0] : '—')
  }

  const loadLastPayment = async (uid: string) => {
    const { data } = await supabase
      .from('payments')
      .select('amount_cents, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data)
      setLastPayment({
        date: new Date(data.created_at).toLocaleDateString('de-DE'),
        amount: data.amount_cents / 100,
      })
  }

  const loadFreeCrates = async () => {
    const { count } = await supabase
      .from('crates')
      .select('*', { count: 'exact', head: true })
      .eq('is_free', true)
      .gt('quantity_remaining', 0)
    setFreeCrates(count || 0)
  }

  // --- UI ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>
          TSV Lonnerstadt • Herren-Terminal
          {user && (
            <span className="ml-3 text-green-500 font-semibold">
              👤 {user.first_name} ({timer}s)
            </span>
          )}
        </span>
      </header>

      {/* Hauptinhalt */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 h-[calc(100vh-3.5rem)]">
        {step === 'pin' && (
          <>
            {/* PIN-Eingabe */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto flex items-center justify-center">
              <div className="w-full max-w-sm mx-auto text-center">
                <h1 className="text-3xl font-semibold mb-8">🔒 PIN-Eingabe</h1>
                <div className="flex justify-center gap-3 mb-8">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-5 h-5 rounded-full border-2 ${
                        i < pin.length ? 'bg-white' : 'border-neutral-600'
                      }`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPin((p) => (p + n).slice(0, 6))}
                      className="h-14 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl"
                    >
                      {n}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => setPin((p) => (p + '0').slice(0, 6))}
                    className="h-14 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl"
                  >
                    0
                  </button>
                  <div />
                </div>
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => setPin((p) => p.slice(0, -1))}
                    className="px-5 py-2 bg-neutral-800 rounded-lg"
                  >
                    Löschen
                  </button>
                  <button
                    onClick={handleLogin}
                    className="px-7 py-2 bg-green-600 hover:bg-green-700 rounded-lg"
                  >
                    Bestätigen
                  </button>
                </div>
              </div>
            </div>

            {/* Platzbelegung */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <h2 className="text-xl font-semibold mb-3 text-center">
                📅 Platzbelegung dieser Woche
              </h2>
              {Object.keys(groupedByDay).length === 0 ? (
                <p className="text-neutral-500 text-center text-sm">
                  Keine Belegung gefunden.
                </p>
              ) : (
                <div className="space-y-5">
                  {Object.entries(groupedByDay).map(([day, entries]) => (
                    <div key={day}>
                      <h3 className="text-lg font-semibold text-green-400 mb-2 border-b border-neutral-800 pb-1">
                        {day}
                      </h3>
                      {(entries as any[]).map((e) => (
                        <div
                          key={e.id}
                          className="border border-neutral-800 bg-neutral-950/50 rounded-lg p-3 mb-2"
                        >
                          <div className="flex justify-between">
                            <span className="text-green-400 font-bold">
                              Platz {e.field}
                            </span>
                            <span className="text-sm text-neutral-400">{e.time} Uhr</span>
                          </div>
                          <div className="text-sm text-neutral-200 font-medium">
                            {e.team_home} vs. {e.team_guest}
                          </div>
                          <div className="text-xs text-neutral-400">
                            {e.competition} • {e.section}
                          </div>
                          {e.location && (
                            <div className="text-xs text-neutral-500 mt-1">
                              📍 {e.location}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Übersicht nach Login bleibt gleich */}
        {step === 'overview' && (
          <>
            {/* Links: InfoCards */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <InfoCard icon="💰" label="Kontostand" value={euro(user?.open_balance_cents ?? 0)} />
                <InfoCard icon="🍺" label="Gesamtverbrauch" value={`${myWeekTotal}`} />
                <InfoCard
                  icon="💶"
                  label="Letzte Zahlung"
                  value={
                    lastPayment
                      ? `${lastPayment.amount.toFixed(2)} € am ${lastPayment.date}`
                      : '—'
                  }
                />
                <InfoCard icon="⭐" label="Lieblingsgetränk" value={favoriteDrink || '—'} />
                <InfoCard icon="🎁" label="Freibierkisten" value={`${freeCrates}`} />
              </div>
            </div>

            {/* Rechts: Getränke */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">🍻 Getränke verbuchen</h2>
                <button
                  onClick={handleLogout}
                  className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700"
                >
                  🔒 Logout
                </button>
              </div>

              <div className="space-y-2">
                {drinks.map((d) => (
                  <div
                    key={d.id}
                    className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex justify-between items-center"
                  >
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-neutral-500">
                        {euro(d.price_cents)} / Stk
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          setDrinks((prev) =>
                            prev.map((x) =>
                              x.id === d.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x
                            )
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
                            prev.map((x) =>
                              x.id === d.id ? { ...x, qty: x.qty + 1 } : x
                            )
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
            </div>
          </>
        )}
      </div>

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

function InfoCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center shadow-sm"
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </motion.div>
  )
}
