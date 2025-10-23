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

const BOTTLES_PER_CRATE = 20
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
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})
  const [time, setTime] = useState('')
  const [timer, setTimer] = useState(60)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)

  // 🕒 Uhrzeit
  useEffect(() => {
    const update = () => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const i = setInterval(update, 60000)
    return () => clearInterval(i)
  }, [])

  // 📅 Wochenstart (Montag)
  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  // 🏟 Platzbelegung
  useEffect(() => {
    const loadPlatzbelegung = async () => {
      const start = startOfWeekMonday()
      const end = new Date(start)
      end.setDate(start.getDate() + 7)

      const { data, error } = await supabase
        .from('platzbelegung')
        .select('id, date, time, team_home, team_guest, competition, section, field, location')
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0])
        .order('date', { ascending: true })

      if (error) return console.error('Fehler beim Laden der Platzbelegung:', error)
      const grouped: Record<string, any[]> = {}
      for (const e of data ?? []) {
        const label = new Date(e.date).toLocaleDateString('de-DE', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
        })
        if (!grouped[label]) grouped[label] = []
        grouped[label].push({
          id: e.id,
          date: e.date,
          time: e.time,
          field: e.field,
          location: e.location,
          match: `${e.team_home ?? ''} ${e.team_guest ?? ''}`.trim(),
          competition: e.competition,
          section: e.section,
        })
      }
      setGroupedByDay(grouped)
    }
    loadPlatzbelegung()
  }, [])

  // 🍺 Drinks laden
  useEffect(() => {
    const loadDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // 🔐 Login
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
    await Promise.all([loadMyWeekTotal(u.id), loadFavoriteDrink(u.id), loadLastPayment(u.id), loadFreeCrates()])
    setLoadingInfo(false)
  }

  // 🔓 Logout
  const handleLogout = () => {
    setUser(null)
    setPin('')
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
    setTimer(60)
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  }

  // ⏱ Auto-Logout nach 60s Inaktivität
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

      const resetActivity = () => setTimer(60)
      window.addEventListener('click', resetActivity)
      window.addEventListener('keydown', resetActivity)

      return () => {
        clearInterval(countdown)
        window.removeEventListener('click', resetActivity)
        window.removeEventListener('keydown', resetActivity)
      }
    }
  }, [step])

  // 📊 Statistikfunktionen
  const loadMyWeekTotal = async (uid: string) => {
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

      {/* Inhalt */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-3.5rem)]">
        {/* 🔢 PIN-Eingabe */}
        {step === 'pin' && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto text-center">
            <h1 className="text-3xl font-semibold mb-8">🔒 PIN-Eingabe</h1>
            <div className="flex justify-center gap-3 mb-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? 'bg-white' : 'border-neutral-600'}`} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[1,2,3,4,5,6,7,8,9].map((n) => (
                <button key={n} onClick={() => setPin((p) => (p + n).slice(0, 6))} className="h-16 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">{n}</button>
              ))}
              <div />
              <button onClick={() => setPin((p) => (p + '0').slice(0, 6))} className="h-16 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">0</button>
              <div />
            </div>
            <div className="flex justify-center gap-4">
              <button onClick={() => setPin((p) => p.slice(0, -1))} className="px-5 py-2 bg-neutral-800 rounded-lg">Löschen</button>
              <button onClick={handleLogin} className="px-7 py-2 bg-green-600 hover:bg-green-700 rounded-lg">Bestätigen</button>
            </div>
          </div>
        )}

        {/* 📅 Platzbelegung */}
        {step === 'pin' && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
            <h2 className="text-xl font-semibold mb-3 text-center">📅 Platzbelegung dieser Woche</h2>
            {Object.keys(groupedByDay).length === 0 ? (
              <p className="text-neutral-500 text-center text-sm">Keine Belegung für diese Woche gefunden.</p>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedByDay).map(([day, entries]) => (
                  <div key={day} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3">
                    <div className="text-lg font-semibold mb-2">{day}</div>
                    {entries.map((e: any) => (
                      <div key={e.id} className="border border-neutral-800 bg-neutral-950/50 rounded-lg p-3 mb-2">
                        <div className="flex justify-between">
                          <span className="text-green-400 font-bold">Platz {e.field}</span>
                          <span className="text-sm text-neutral-400">{e.time} Uhr</span>
                        </div>
                        <div className="text-sm text-neutral-200 font-medium">{e.match}</div>
                        <div className="text-xs text-neutral-400">{e.competition} • {e.section}</div>
                        {e.location && <div className="text-xs text-neutral-500 mt-1">📍 {e.location}</div>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
