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
  const [popup, setPopup] = useState<any>(null)
  const [time, setTime] = useState('')
  const [timer, setTimer] = useState(60)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)

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

  // Drinks laden
  useEffect(() => {
    const loadDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // Login
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
    await Promise.all([loadMyWeekStats(u.id), loadFavoriteDrink(u.id), loadLastPayment(u.id), loadFreeCrates()])
    setLoadingInfo(false)
  }

  const handleLogout = () => {
    setUser(null)
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
    setTimer(60)
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  }

  // Auto-Logout nach 60s
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

  // Daten laden
  const loadMyWeekStats = async (uid: string) => {
    const from = startOfWeekMonday()
    const { data } = await supabase.from('consumptions').select('quantity').eq('user_id', uid).gte('created_at', from.toISOString())
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }

  const loadFavoriteDrink = async (uid: string) => {
    const { data } = await supabase.from('consumptions').select('quantity, drinks(name)').eq('user_id', uid)
    if (!data?.length) return setFavoriteDrink('—')
    const count: Record<string, number> = {}
    for (const r of data) {
      const name = (Array.isArray(r.drinks) ? r.drinks[0]?.name : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
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
    if (data) setLastPayment({ date: new Date(data.created_at).toLocaleDateString('de-DE'), amount: data.amount_cents / 100 })
  }

  const loadFreeCrates = async () => {
    const { count } = await supabase.from('crates').select('*', { count: 'exact', head: true }).eq('is_free', true).gt('quantity_remaining', 0)
    setFreeCrates(count || 0)
  }

  // Getränke buchen
  const openBookingPopup = async () => {
    if (!user) return setToast('⚠️ Kein Nutzer eingeloggt!')
    if (drinks.every((d) => d.qty === 0)) return setToast('❌ Bitte Getränk wählen!')
    setToast('📤 Buchung erfolgreich!')
  }

  const handleCrateWithdraw = async (id: number) => {
    const drink = drinks.find((d) => d.id === id)
    if (!drink) return setToast('❌ Getränk nicht gefunden')
    setToast(`🥶 Kiste ${drink.name} gebucht`)
  }

  // UI
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>
          TSV Lonnerstadt • Herren-Terminal
          {user && <span className="ml-3 text-green-500 font-semibold">👤 {user.first_name} ({timer}s)</span>}
        </span>
      </header>

      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-3.5rem)]">
        {/* Links: Infos */}
        {step === 'overview' && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoCard icon="💰" label="Kontostand" value={euro(user?.open_balance_cents ?? 0)} />
              <InfoCard icon="🍺" label="Gesamtverbrauch" value={`${myWeekTotal}`} />
              <InfoCard icon="💶" label="Letzte Zahlung" value={lastPayment ? `${lastPayment.amount.toFixed(2)} € am ${lastPayment.date}` : '—'} />
              <InfoCard icon="⭐" label="Lieblingsgetränk" value={favoriteDrink || '—'} />
              <InfoCard icon="🎁" label="Freibierkisten" value={`${freeCrates}`} />
            </div>
          </div>
        )}

        {/* Rechts: Getränke */}
        {step === 'overview' && (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">🍻 Getränke verbuchen</h2>
              <button onClick={handleLogout} className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700">🔒 Logout</button>
            </div>

            <div className="space-y-2">
              {drinks.map((d) => (
                <div key={d.id} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex justify-between items-center">
                  <div>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-neutral-500">{euro(d.price_cents)} / Stk</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setDrinks((prev) => prev.map((x) => (x.id === d.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x)))} className="w-9 h-9 bg-neutral-800 rounded-lg text-xl">–</button>
                    <span className="w-6 text-center">{d.qty}</span>
                    <button onClick={() => setDrinks((prev) => prev.map((x) => (x.id === d.id ? { ...x, qty: x.qty + 1 } : x)))} className="w-9 h-9 bg-neutral-800 rounded-lg text-xl">+</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 mt-6">
              <button onClick={openBookingPopup} className="w-full h-14 rounded-2xl bg-green-600 hover:bg-green-700 text-lg font-medium">📤 Jetzt verbuchen</button>

              <div className="flex gap-2">
                <select id="crateDrink" className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white" onChange={(e) => setSelectedCrateDrink(Number(e.target.value))} value={selectedCrateDrink}>
                  <option value={0}>Kiste wählen...</option>
                  {drinks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({euro(d.crate_price_cents)})
                    </option>
                  ))}
                </select>
                <button onClick={() => selectedCrateDrink && handleCrateWithdraw(selectedCrateDrink)} disabled={!selectedCrateDrink} className="px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-lg font-medium">🥶 Kiste</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InfoCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center shadow-sm">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </motion.div>
  )
}
