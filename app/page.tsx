'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'
import { PiggyBank, Beer, Gift, Wallet } from 'lucide-react'

const BOTTLES_PER_CRATE = 20
const FREE_POOL_TABLE = 'free_pool'
const FREE_POOL_ID = 1
const euro = (cents: number) => `${(cents / 100).toFixed(2)} €`
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`
}

export default function HomePage() {
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<any[]>([])
  const [freePool, setFreePool] = useState<number>(0)
  const [popup, setPopup] = useState<any | null>(null)
  const [toasts, setToasts] = useState<any[]>([])
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [lastPayment, setLastPayment] = useState<{ amount: number; date: string } | null>(null)
  const [freePopup, setFreePopup] = useState(false)
  const [bierPrice, setBierPrice] = useState<number>(0)

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  useEffect(() => {
    const fetchDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks(data || [])
      const bier = data?.find((d: any) => d.name.toLowerCase() === 'bier')
      if (bier) setBierPrice(bier.crate_price_cents)
    }
    fetchDrinks()
  }, [])

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
    const drinkBookings = (cons || []).map((r: any) => ({
      created_at: r.created_at,
      text:
        r.unit_price_cents === 0
          ? `🎉 ${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Freibier)`
          : `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (${euro(r.unit_price_cents * r.quantity)})`,
    }))
    setBookings(drinkBookings)
  }

  const loadFreePool = async () => {
    const { data } = await supabase
      .from(FREE_POOL_TABLE)
      .select('quantity_remaining')
      .eq('id', FREE_POOL_ID)
      .maybeSingle()
    setFreePool(data?.quantity_remaining ?? 0)
  }

  const loadMyWeekStats = async (uid: string) => {
    const from = new Date()
    const day = from.getDay()
    const diff = from.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(from.setDate(diff))
    monday.setHours(0, 0, 0, 0)
    const to = new Date(monday)
    to.setDate(to.getDate() + 7)
    const { data, error } = await supabase
      .from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', monday.toISOString())
      .lt('created_at', to.toISOString())
    if (!error) setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }

  const loadLastPayment = async (uid: string) => {
    const { data, error } = await supabase
      .from('payments')
      .select('amount_cents, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data)
      setLastPayment({ amount: data.amount_cents / 100, date: new Date(data.created_at).toLocaleDateString('de-DE') })
  }

  useEffect(() => {
    const init = async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id
      if (!uid) return
      await Promise.all([loadStats(), loadFreePool(), loadMyWeekStats(uid), loadLastPayment(uid)])
    }
    init()
  }, [])

  // 🎁 Freigetränke bereitstellen
  const handleProvideFreeDrinks = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return
    const used = -BOTTLES_PER_CRATE
    const { error: poolErr } = await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: used })
    if (poolErr) return addToast('❌ Fehler beim Erhöhen des Freibier-Pools', 'error')
    setFreePool((p) => p + BOTTLES_PER_CRATE)
    const { error: balErr } = await supabase.rpc('increment_balance', {
      user_id_input: user.id,
      amount_input: bierPrice,
    })
    if (balErr) return addToast('⚠️ Fehler beim Abbuchen des Kistenpreises', 'error')
    setBalance((b) => b + bierPrice)
    addToast('🎉 20 Freigetränke bereitgestellt!')
    setFreePopup(false)
  }

  return (
    <>
      <TopNav />
      <div className="pt-20 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white px-4 pb-24">
        <div className="max-w-md mx-auto space-y-6">

          {/* --- Stat Cards --- */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gray-800/60 backdrop-blur-sm p-4 shadow-sm">
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-red-500/20 to-red-300/10" />
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-black/30 border border-white/5 shadow-inner"><PiggyBank className='w-5 h-5' /></div>
                <div>
                  <p className="text-xs text-gray-400">Kontostand</p>
                  <p className="text-xl font-semibold leading-tight">{(Math.abs(balance) / 100).toFixed(2)} €</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{balance > 0 ? 'Schulden' : balance < 0 ? 'Guthaben' : 'Ausgeglichen'}</p>
                </div>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gray-800/60 backdrop-blur-sm p-4 shadow-sm">
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-emerald-500/20 to-emerald-300/10" />
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-black/30 border border-white/5 shadow-inner"><Beer className='w-5 h-5' /></div>
                <div>
                  <p className="text-xs text-gray-400">Gesamtverbrauch</p>
                  <p className="text-xl font-semibold leading-tight">{myWeekTotal}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Flaschen / Woche</p>
                </div>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gray-800/60 backdrop-blur-sm p-4 shadow-sm">
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-pink-500/20 to-pink-300/10" />
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-black/30 border border-white/5 shadow-inner"><Gift className='w-5 h-5' /></div>
                <div>
                  <p className="text-xs text-gray-400">Freibier</p>
                  <p className="text-xl font-semibold leading-tight">{freePool}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Verfügbar</p>
                </div>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gray-800/60 backdrop-blur-sm p-4 shadow-sm">
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-tr from-blue-500/20 to-blue-300/10" />
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-black/30 border border-white/5 shadow-inner"><Wallet className='w-5 h-5' /></div>
                <div>
                  <p className="text-xs text-gray-400">Letzte Zahlung</p>
                  <p className="text-xl font-semibold leading-tight">{lastPayment ? `${lastPayment.amount.toFixed(2)} €` : '—'}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{lastPayment ? `am ${lastPayment.date}` : ''}</p>
                </div>
              </div>
            </div>
          </div>

          {/* --- Getränke --- */}
          <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6">
            <h1 className="text-2xl font-semibold mb-4">🍺 Getränk verbuchen</h1>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {drinks.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDrink(d)}
                  className={`p-3 rounded-xl border text-sm ${selectedDrink?.id === d.id ? 'bg-white text-black border-white' : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'}`}
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
              className="w-full h-12 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              Jetzt verbuchen
            </button>
          </section>

          {/* --- Neuer Button: Freigetränke bereitstellen --- */}
          <div className="mt-4">
            <button
              onClick={() => setFreePopup(true)}
              className="w-full h-12 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition"
            >
              🍻 Freigetränke bereitstellen (20 × Bierpreis)
            </button>
          </div>

          {/* --- Letzte Buchungen --- */}
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

        {/* --- Popup Freigetränke --- */}
        <AnimatePresence>
          {freePopup && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center bg-black/70 z-50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl border border-neutral-700 max-w-sm w-full"
              >
                <h3 className="text-xl font-semibold mb-2">🍻 Freigetränke bereitstellen</h3>
                <p className="text-sm text-neutral-300 mb-6">
                  Du stellst {BOTTLES_PER_CRATE} Freigetränke für alle zur Verfügung.<br />
                  Dafür wird {euro(bierPrice)} (Preis einer Bierkiste) von deinem Konto abgebucht.
                </p>
                <div className="flex justify-center gap-4">
                  <button onClick={() => setFreePopup(false)} className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600">Abbrechen</button>
                  <button onClick={handleProvideFreeDrinks} className="px-4 py-2 bg-green-700 rounded hover:bg-green-800">Bestätigen</button>
                </div>
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
