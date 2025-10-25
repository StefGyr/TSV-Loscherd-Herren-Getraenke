'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

type CheckoutLine = {
  drinkId: number
  name: string
  unitCents: number
  qty: number
  freeQty: number
  payQty: number
  linePaidCents: number
}

const BOTTLES_PER_CRATE = 20
const euro = (c: number) => (c / 100).toFixed(2) + ' €'
const FREE_POOL_TABLE = 'free_pool'
const FREE_POOL_ID = 1
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function debounce<F extends (...args: any[]) => void>(fn: F, delay = 300) {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<F>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), delay)
  }
}

export default function TopTerminalPage() {
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [time, setTime] = useState('')

  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const totalQty = useMemo(() => drinks.reduce((acc, d) => acc + (d.qty || 0), 0), [drinks])

  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string | null>(null)
  const [lastPayment, setLastPayment] = useState<{ date: string; amount: number } | null>(null)
  const [freePool, setFreePool] = useState<number>(0)
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})
  const [popup, setPopup] = useState<'checkout' | 'crateInfo' | 'quote' | null>(null)
  const [useFreeBeerChoice, setUseFreeBeerChoice] = useState<null | 'pending' | 'yes' | 'no'>(null)
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null)
  const [checkoutLines, setCheckoutLines] = useState<CheckoutLine[]>([])
  const [checkoutTotals, setCheckoutTotals] = useState({ totalQty: 0, freeUsed: 0, payCents: 0, remainingPool: 0 })
  const [toast, setToast] = useState<string | null>(null)
  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null)
  const [timer, setTimer] = useState(60)
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  const showToast = useMemo(() => debounce((msg: string) => setToast(msg), 50), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const handleLogout = useCallback(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    setQuote(null)
    setPopup(null)
    setUser(null)
    setDrinks(d => d.map(x => ({ ...x, qty: 0 })))
    setStep('pin')
    setTimer(60)
  }, [])

  const dismissQuoteNow = useCallback(() => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    setPopup(null)
    handleLogout()
  }, [handleLogout])

  // -----------------------------
  // Loader
  // -----------------------------
  const loadDrinks = useCallback(async () => {
    const { data } = await supabase.from('drinks').select('*').order('name')
    setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
  }, [])

  const loadFreePool = useCallback(async () => {
    const { data } = await supabase.from(FREE_POOL_TABLE).select('id, quantity_remaining').eq('id', FREE_POOL_ID).maybeSingle()
    if (data) setFreePool(data.quantity_remaining ?? 0)
  }, [])

  const loadPlatzbelegung = useCallback(async () => {
    const monday = startOfWeekMonday()
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const todayYmd = ymd(new Date())
    const { data } = await supabase.from('platzbelegung')
      .select('*')
      .gte('date', ymd(monday))
      .lte('date', ymd(sunday))
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    const grouped: Record<string, any[]> = {}
    for (const e of data ?? []) {
      const dayKey = ymd(new Date(e.date))
      if (dayKey < todayYmd) continue
      const label = new Date(e.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(e)
    }
    setGroupedByDay(grouped)
  }, [])

  const loadLastPayment = useCallback(async (uid: string) => {
    const { data } = await supabase.from('payments')
      .select('amount_cents, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) setLastPayment({ date: new Date(data.created_at).toLocaleDateString('de-DE'), amount: data.amount_cents / 100 })
  }, [])

  const loadMyWeekStats = useCallback(async (uid: string) => {
    const from = startOfWeekMonday()
    const to = new Date(from)
    to.setDate(to.getDate() + 7)
    const { data } = await supabase.from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString())
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }, [])

  const loadFavoriteDrink = useCallback(async (uid: string) => {
    const { data } = await supabase.from('consumptions').select('quantity, drinks(name)').eq('user_id', uid)
    if (!data?.length) return setFavoriteDrink('—')
    const count: Record<string, number> = {}
    for (const r of data) {
      const n = (Array.isArray(r.drinks) ? r.drinks[0]?.name : (r.drinks as any)?.name) || 'Unbekannt'
      count[n] = (count[n] || 0) + (r.quantity || 0)
    }
    const fav = Object.entries(count).sort((a, b) => b[1] - a[1])[0]
    setFavoriteDrink(fav ? fav[0] : '—')
  }, [])

  // -----------------------------
  // Effects
  // -----------------------------
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    loadDrinks()
    loadPlatzbelegung()
  }, [loadDrinks, loadPlatzbelegung])

  useEffect(() => {
    if (step !== 'overview') return
    const countdown = setInterval(() => {
      setTimer(t => {
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
  }, [step, handleLogout])

  // -----------------------------
  // Login
  // -----------------------------
  const handleLogin = useCallback(async (inputPin?: string) => {
    const typed = (inputPin ?? pin).trim()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, pin, open_balance_cents')
      .eq('pin', typed)
      .single()
    if (error || !data) {
      showToast('❌ Falscher PIN')
      setPin('')
      return
    }
    setUser(data)
    setPin('')
    setStep('overview')
    setTimer(60)
    await Promise.all([
      loadMyWeekStats(data.id),
      loadFavoriteDrink(data.id),
      loadLastPayment(data.id),
      loadFreePool()
    ])
  }, [pin, loadMyWeekStats, loadFavoriteDrink, loadLastPayment, loadFreePool, showToast])

  useEffect(() => { if (pin.length === 6) void handleLogin(pin) }, [pin, handleLogin])

  // -----------------------------
  // Drink Auswahl
  // -----------------------------
  const incQty = useCallback((d: Drink) => setDrinks(l => l.map(x => x.id === d.id ? { ...x, qty: (x.qty || 0) + 1 } : x)), [])
  const decQty = useCallback((d: Drink) => setDrinks(l => l.map(x => x.id === d.id ? { ...x, qty: Math.max(0, (x.qty || 0) - 1) } : x)), [])

  // -----------------------------
  // Checkout
  // -----------------------------
  const openCheckout = useCallback(() => {
    const selected = drinks.filter(d => (d.qty ?? 0) > 0)
    let remaining = freePool
    const lines: CheckoutLine[] = []
    let totalQty = 0, freeUsed = 0, payCents = 0

    for (const d of selected) {
      const qty = d.qty ?? 0
      const freeQty = Math.min(qty, Math.max(0, remaining))
      const payQty = Math.max(0, qty - freeQty)
      const linePaidCents = payQty * (d.price_cents ?? 0)
      remaining -= freeQty
      lines.push({ drinkId: d.id, name: d.name, unitCents: d.price_cents, qty, freeQty, payQty, linePaidCents })
      totalQty += qty
      freeUsed += freeQty
      payCents += linePaidCents
    }

    setCheckoutLines(lines)
    setCheckoutTotals({ totalQty, freeUsed, payCents, remainingPool: Math.max(0, remaining) })

    if (freePool > 0) {
      setUseFreeBeerChoice('pending')
    } else {
      setPopup('checkout')
    }
  }, [drinks, freePool])

  const confirmCheckout = useCallback(async () => {
    if (!user) return
    const applyFreeBeer = useFreeBeerChoice !== 'no'

    const inserts: any[] = []
    let freeUsed = 0
    let anySpezi = false

    for (const line of checkoutLines) {
      if (applyFreeBeer && line.freeQty > 0) {
        inserts.push({ user_id: user.id, drink_id: line.drinkId, quantity: line.freeQty, unit_price_cents: 0, source: 'single' })
        freeUsed += line.freeQty
      }
      if (line.payQty > 0 || !applyFreeBeer) {
        const qty = applyFreeBeer ? line.payQty : line.qty
        if (qty > 0) inserts.push({ user_id: user.id, drink_id: line.drinkId, quantity: qty, unit_price_cents: line.unitCents, source: 'single' })
      }
      if (line.name.toLowerCase().includes('spezi')) anySpezi = true
    }

    if (checkoutTotals.payCents > 0) {
      await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: checkoutTotals.payCents })
      setUser(p => p ? { ...p, open_balance_cents: (p.open_balance_cents ?? 0) + checkoutTotals.payCents } : p)
    }

    if (inserts.length > 0) await supabase.rpc('terminal_insert_consumptions', { _rows: inserts as any })
    if (applyFreeBeer && freeUsed > 0) {
      await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: freeUsed })
      setFreePool(p => Math.max(0, p - freeUsed))
    }

    setCheckoutLines([])
    setPopup(null)
    setUseFreeBeerChoice(null)
    setDrinks(list => list.map(d => ({ ...d, qty: 0 })))
    showToast('✅ Bestellung verbucht')

    if (logoutTimer.current) clearTimeout(logoutTimer.current)
    logoutTimer.current = setTimeout(() => void startLogoutWithQuote(anySpezi), 5000)
  }, [user, checkoutLines, checkoutTotals.payCents, showToast, useFreeBeerChoice])

  const openCrateInfo = useCallback((drink: Drink) => { setSelectedDrink(drink); setPopup('crateInfo') }, [])
  const buyCrateNow = useCallback(async () => {
    if (!user || !selectedDrink) return
    const rows = [{ user_id: user.id, drink_id: selectedDrink.id, quantity: BOTTLES_PER_CRATE, unit_price_cents: selectedDrink.crate_price_cents, source: 'crate' }]
    await supabase.rpc('terminal_insert_consumptions', { _rows: rows as any })
    await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: selectedDrink.crate_price_cents })
    showToast(`✅ Kiste ${selectedDrink.name} gebucht`)
    setPopup(null)
    setTimeout(() => void startLogoutWithQuote(selectedDrink.name.toLowerCase().includes('spezi')), 5000)
  }, [user, selectedDrink, showToast])

  const startLogoutWithQuote = useCallback(async (forceGuenter: boolean) => {
    if (forceGuenter) {
      setQuote({ text: 'Auf ein Spezi musst du 3 Bier trinken!', author: 'Günter Kropf' })
    } else {
      const r = await supabase.from('quotes').select('text, author').eq('is_special', false)
      const q = r.data && r.data.length ? r.data[Math.floor(Math.random() * r.data.length)] : { text: 'Der Ball ist rund und das Spiel dauert 90 Minuten.', author: 'Sepp Herberger' }
      setQuote(q)
    }
    setPopup('quote')
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => { setPopup(null); handleLogout() }, 10000)
  }, [handleLogout])

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-300 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>TSV Lonnerstadt • <b>Herren-Terminal</b>{user && <span className="ml-3 text-green-500 font-semibold">👤 {user.first_name} ({timer}s)</span>}</span>
      </header>

      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6 h-[calc(100vh-3.5rem)]">
        {/* PIN-Seite */}
        {step === 'pin' && (
          <>
            {/* Login */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 flex items-center justify-center">
              <div className="w-full max-w-sm mx-auto text-center">
                <h1 className="text-3xl font-semibold mb-8">🔒 PIN-Eingabe</h1>
                <div className="flex justify-center gap-3 mb-8">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={`w-6 h-6 rounded-full border-2 ${i < pin.length ? 'bg-white' : 'border-neutral-600'}`} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[1,2,3,4,5,6,7,8,9].map(n => (
                    <button key={n} onClick={() => setPin(p => (p + n).slice(0,6))} className="h-16 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">{n}</button>
                  ))}
                  <div />
                  <button onClick={() => setPin(p => (p + '0').slice(0,6))} className="h-16 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">0</button>
                  <div />
                </div>
                <button onClick={() => setPin('')} className="px-6 py-2 bg-neutral-800 rounded-lg">Eingabe löschen</button>
              </div>
            </div>

            {/* Platzbelegung */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <h2 className="text-xl font-semibold mb-3 text-center">📅 Platzbelegung (diese Woche)</h2>
              {Object.keys(groupedByDay).length === 0 ? (
                <p className="text-neutral-500 text-center text-sm">Keine Belegung für heute & folgende Tage.</p>
              ) : (
                Object.entries(groupedByDay).map(([day, entries]) => (
                  <div key={day} className="mb-4">
                    <h3 className="text-lg font-semibold text-green-400 mb-2 border-b border-neutral-800 pb-1">{day}</h3>
                    {(entries as any[]).map(e => (
                      <div key={e.id} className="border border-neutral-800 bg-neutral-900/60 rounded-lg p-3 mb-2">
                        <div className="flex justify-between">
                          <span className="text-green-400 font-semibold">Platz {e.field}</span>
                          <span className="text-sm text-neutral-400">{e.time} Uhr</span>
                        </div>
                        <div className="text-sm text-neutral-200 font-medium">{e.team_home} vs. {e.team_guest}</div>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* Übersicht */}
        {step === 'overview' && (
          <>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
              <div className="text-center mb-4">
                <h1 className="text-3xl font-bold mb-1">Hallo {user?.first_name} 👋</h1>
                <p className="text-neutral-400 text-sm">Willkommen am Herren-Terminal</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FancyCard icon="💰" label="Kontostand" value={euro(user?.open_balance_cents ?? 0)} sub="Saldo" color="from-rose-900/80 to-rose-800/40" />
                <FancyCard icon="🍺" label="Verbrauch" value={`${myWeekTotal}`} sub="Flaschen (Woche)" color="from-green-900/80 to-green-800/40" />
                <FancyCard icon="🎁" label="Freibier" value={`${freePool}`} sub="verfügbar" color={freePool>0?'from-emerald-800/80 to-emerald-700/40':'from-gray-700 to-gray-800'} />
                <FancyCard icon="💶" label="Letzte Zahlung" value={lastPayment?`${lastPayment.amount.toFixed(2)} €`:'—'} sub={lastPayment?`am ${lastPayment.date}`:''} color="from-blue-900/80 to-blue-800/40" />
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 flex flex-col">
              <div className="flex justify-between mb-4">
                <h2 className="text-xl font-semibold">🍻 Getränke</h2>
                <button onClick={handleLogout} className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg">🔒 Logout</button>
              </div>

              <div className="space-y-3 overflow-y-auto pr-1">
                {drinks.map(d => (
                  <div key={d.id} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium truncate">{d.name}</div>
                        <div className="text-xs text-neutral-500">Einzel: {euro(d.price_cents)} • Kiste: {euro(d.crate_price_cents)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => decQty(d)} className="w-12 h-12 rounded-xl bg-rose-900 text-white text-2xl">−</button>
                        <div className="w-12 text-center text-xl">{d.qty ?? 0}</div>
                        <button onClick={() => incQty(d)} className="w-12 h-12 rounded-xl bg-emerald-700 text-white text-2xl">＋</button>
                        <button onClick={() => openCrateInfo(d)} className="px-3 py-2 rounded-lg bg-blue-700/80 hover:bg-blue-600 text-sm">🧊 Kiste</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-between items-center">
                <div className="text-neutral-300 text-sm">
                  Gewählt: <b>{totalQty}</b> · Frei: <b>{freePool}</b>
                </div>
                <button disabled={!totalQty} onClick={openCheckout}
                  className={`px-5 py-3 rounded-xl font-semibold ${totalQty>0?'bg-green-600 hover:bg-green-700':'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`}>
                  📤 Jetzt verbuchen
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* --- Freibierauswahl-Popup --- */}
      <AnimatePresence>
        {useFreeBeerChoice === 'pending' && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl border border-neutral-700">
              <h3 className="text-xl font-semibold mb-3">🎉 Freibier verwenden?</h3>
              <p className="text-sm text-neutral-300 mb-6">
                Es sind aktuell <b>{freePool}</b> Freigetränke verfügbar.<br />
                Möchtest du sie beim Verbuchen nutzen?
              </p>
              <div className="flex justify-center gap-4">
                <button onClick={() => { setUseFreeBeerChoice('yes'); setPopup('checkout') }} className="px-4 py-2 bg-green-700 rounded hover:bg-green-800">🎉 Ja</button>
                <button onClick={() => { setUseFreeBeerChoice('no'); setPopup('checkout') }} className="px-4 py-2 bg-blue-700 rounded hover:bg-blue-800">💰 Nein</button>
              </div>
              <button onClick={() => setUseFreeBeerChoice(null)} className="mt-4 text-sm text-neutral-400 underline">Abbrechen</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Checkout Popup --- */}
      <AnimatePresence>
        {popup === 'checkout' && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 text-white w-[min(720px,95vw)] rounded-2xl p-6 shadow-2xl">
              <h3 className="text-xl font-semibold mb-4">Buchungsübersicht</h3>
              <div className="space-y-2 max-h-[50vh] overflow-auto pr-2">
                {checkoutLines.map(ln => (
                  <div key={ln.drinkId} className="flex flex-wrap justify-between border-b border-neutral-800 py-2 text-sm">
                    <div className="font-medium">{ln.name}</div>
                    <div>Menge: <b>{ln.qty}</b></div>
                    <div className="text-emerald-400">Frei: {ln.freeQty}</div>
                    <div className="text-sky-300">Zahlend: {ln.payQty} × {euro(ln.unitCents)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-lg bg-neutral-800 flex flex-wrap gap-6 text-sm">
                <div>Freibier genutzt: <b>{checkoutTotals.freeUsed}</b></div>
                <div>Verbleibend: <b>{checkoutTotals.remainingPool}</b></div>
                <div>Gesamt: <b>{euro(checkoutTotals.payCents)}</b></div>
              </div>
              {checkoutTotals.freeUsed < checkoutTotals.totalQty && checkoutTotals.freeUsed > 0 && (
                <div className="mt-3 text-amber-400 text-sm">
                  ⚠️ Du hast mehr Getränke gewählt als Freibier verfügbar. Der Rest wird normal berechnet.
                </div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => { setPopup(null); setUseFreeBeerChoice(null) }} className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600">Abbrechen</button>
                <button onClick={confirmCheckout} className="px-5 py-2 bg-green-600 rounded hover:bg-green-700 font-semibold">Bestätigen & buchen</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Restliche Popups (Kiste + Spruch + Toast) bleiben unverändert --- */}
      <AnimatePresence>
        {popup === 'crateInfo' && selectedDrink && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl">
              <h3 className="text-xl font-semibold mb-3">🧊 Kiste „{selectedDrink.name}“ kaufen?</h3>
              <p className="text-sm text-neutral-300 mb-6">Diese Kiste ist für die Kabine gedacht und zählt nicht als Freibier.</p>
              <div className="flex justify-center gap-4">
                <button onClick={() => setPopup(null)} className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600">Abbrechen</button>
                <button onClick={buyCrateNow} className="px-4 py-2 bg-blue-700 rounded hover:bg-blue-800 font-semibold">Kaufen für {euro(selectedDrink.crate_price_cents)}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {popup === 'quote' && quote && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
            onClick={dismissQuoteNow}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl">
              <p className="text-xl italic mb-2">„{quote.text}“</p>
              <p className="text-sm text-neutral-400">– {quote.author}</p>
              <p className="text-xs text-neutral-500 mt-3">Tippe, um fortzufahren</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg">{toast}</motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FancyCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub?: string; color: string }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} className={`p-4 rounded-2xl bg-gradient-to-br ${color} text-white flex flex-col`}>
      <div className="flex items-center gap-3 mb-2"><div className="text-3xl">{icon}</div><div className="text-sm text-neutral-300">{label}</div></div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </motion.div>
  )
}
