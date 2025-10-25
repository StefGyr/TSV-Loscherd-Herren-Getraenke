'use client'

/**
 * Terminal-Seite (TopTerminalPage)
 * - Tablet-optimierte Multi-Verbuchen-UI (+/- je Getränk, zentraler Verbuchen-Button)
 * - Globaler Freibier-Pool (free_pool.quantity_remaining) für ALLE Getränke
 * - Kisten-Kauf pro Getränk (ohne Freibierabzug, Info-Popup)
 * - Buchungsübersicht mit Freibierverteilung (vor Bestätigung)
 * - Logout-Spruch (10s oder Tipp zum Schließen) – bei Spezi immer Günter
 * - Woche Mo–So (lokal, vergangene Tage ausgeblendet)
 * - Performance: useMemo, useCallback, simple Debounce
 * - Vollständig in TypeScript mit Kommentaren
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase-browser'

// -----------------------------
// Typen
// -----------------------------
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

// -----------------------------
// Konstanten & Utilities
// -----------------------------
const BOTTLES_PER_CRATE = 20
const euro = (c: number) => (c / 100).toFixed(2) + ' €'

// zentrale Freibier-Pool-Tabelle + feste ID=1
const FREE_POOL_TABLE = 'free_pool'
const FREE_POOL_ID = 1

// Lokales YYYY-MM-DD (ohne Zeitzonenverschiebung)
const ymd = (d: Date) => {
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// Einfaches Debounce (z. B. für Toast)
function debounce<F extends (...args: any[]) => void>(fn: F, delay = 300) {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<F>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), delay)
  }
}

// -----------------------------
// Komponente
// -----------------------------
export default function TopTerminalPage() {
  // Ansicht / Login
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [time, setTime] = useState('')

  // Drinks & Auswahl
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const totalQty = useMemo(() => drinks.reduce((acc, d) => acc + (d.qty || 0), 0), [drinks])

  // Stats (linke Seite)
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string | null>(null)
  const [lastPayment, setLastPayment] = useState<{ date: string; amount: number } | null>(null)
  const [freePool, setFreePool] = useState<number>(0)

  // Platzbelegung (Mo–So), vergangene Tage ausgeblendet
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})

  // Popups & Sprüche
  type PopupType = null | 'checkout' | 'crateInfo' | 'quote'
  const [popup, setPopup] = useState<PopupType>(null)
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null)
  const [checkoutLines, setCheckoutLines] = useState<CheckoutLine[]>([])
  const [checkoutTotals, setCheckoutTotals] = useState<{ totalQty: number; freeUsed: number; payCents: number; remainingPool: number }>({
    totalQty: 0,
    freeUsed: 0,
    payCents: 0,
    remainingPool: 0,
  })
  const [toast, setToast] = useState<string | null>(null)
  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null)

  // Timer / Auto-Logout
  const [timer, setTimer] = useState(60)
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // -----------------------------
  // Hilfsfunktionen
  // -----------------------------
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
  // Loader (Supabase)
  // -----------------------------
  const loadDrinks = useCallback(async () => {
    const { data, error } = await supabase.from('drinks').select('*').order('name')
    if (error) {
      console.error('Fehler Drinks:', error)
      return
    }
    setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
  }, [])

  const loadFreePool = useCallback(async () => {
    const { data, error } = await supabase
      .from(FREE_POOL_TABLE)
      .select('id, quantity_remaining')
      .eq('id', FREE_POOL_ID)
      .maybeSingle()
    if (error) {
      console.error('Fehler free pool laden:', error)
      return
    }
    if (!data) {
      // falls Zeile (id=1) fehlt, anlegen
      await supabase.from(FREE_POOL_TABLE).insert([{ id: FREE_POOL_ID, quantity_remaining: 0 } as any])
      setFreePool(0)
    } else {
      setFreePool(data.quantity_remaining ?? 0)
    }
  }, [])

  const loadPlatzbelegung = useCallback(async () => {
    const monday = startOfWeekMonday()
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const todayYmd = ymd(new Date())

    const { data, error } = await supabase
      .from('platzbelegung')
      .select('*')
      .gte('date', ymd(monday))
      .lte('date', ymd(sunday))
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (error) {
      console.error('Fehler Platzbelegung:', error)
      return
    }

    const grouped: Record<string, any[]> = {}
    for (const e of data ?? []) {
      const dayKey = ymd(new Date(e.date))
      if (dayKey < todayYmd) continue // vergangene Tage ausblenden
      const label = new Date(e.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })
      if (!grouped[label]) grouped[label] = []
      grouped[label].push(e)
    }
    setGroupedByDay(grouped)
  }, [])

  const loadLastPayment = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('payments')
      .select('amount_cents, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) {
      setLastPayment({ date: new Date(data.created_at).toLocaleDateString('de-DE'), amount: data.amount_cents / 100 })
    }
  }, [])

  const loadMyWeekStats = useCallback(async (uid: string) => {
    const from = startOfWeekMonday()
    const to = new Date(from)
    to.setDate(to.getDate() + 7)

    const { data, error } = await supabase
      .from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())
      .lt('created_at', to.toISOString())

    if (error) {
      console.error('Fehler WeekStats:', error)
      return
    }
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }, [])

  const loadFavoriteDrink = useCallback(async (uid: string) => {
  const { data, error } = await supabase
    .from('consumptions')
    .select('quantity, drinks(name)')
    .eq('user_id', uid)

  if (error) {
    console.error('Fehler Fav:', error)
    return
  }
  if (!data?.length) {
    setFavoriteDrink('—')
    return
  }

  const count: Record<string, number> = {} // ✅ korrekt initialisiert

  for (const r of data) {
    const name =
      (Array.isArray(r.drinks)
        ? r.drinks[0]?.name
        : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
    count[name] = (count[name] || 0) + (r.quantity || 0)
  }

  const fav = Object.entries(count).sort((a, b) => b[1] - a[1])[0]
  setFavoriteDrink(fav ? fav[0] : '—')
}, [])


  // -----------------------------
  // Effekte
  // -----------------------------
  // Uhrzeit
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })), 1000)
    return () => clearInterval(t)
  }, [])

  // Initiales Laden (nur einmal)
  useEffect(() => {
    loadDrinks()
    loadPlatzbelegung()
  }, [loadDrinks, loadPlatzbelegung])

  // Auto-Logout-Countdown in Übersicht
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
    window.addEventListener('click', reset, { passive: true })
    window.addEventListener('keydown', reset, { passive: true })

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
      showToast('❌ Falscher PIN oder Fehler beim Abruf')
      setPin('')
      return
    }
    const match = data
    setUser({ id: match.id, first_name: match.first_name, last_name: match.last_name, pin: match.pin, open_balance_cents: match.open_balance_cents ?? 0 })
    setPin('')
    setStep('overview')
    setTimer(60) // 🔹 Timer sicher zurücksetzen

    await Promise.all([
      loadMyWeekStats(match.id),
      loadFavoriteDrink(match.id),
      loadLastPayment(match.id),
      loadFreePool(),
    ])
  }, [pin, loadMyWeekStats, loadFavoriteDrink, loadLastPayment, loadFreePool, showToast])

  // Auto-Login bei 6-stelliger PIN
  useEffect(() => { if (pin.length === 6) void handleLogin(pin) }, [pin, handleLogin])

  // -----------------------------
  // Auswahl-Handler (Performance: useCallback)
  // -----------------------------
  const incQty = useCallback((d: Drink) => {
    setDrinks(list => list.map(x => (x.id === d.id ? { ...x, qty: (x.qty ?? 0) + 1 } : x)))
  }, [])

  const decQty = useCallback((d: Drink) => {
    setDrinks(list => list.map(x => (x.id === d.id ? { ...x, qty: Math.max(0, (x.qty ?? 0) - 1) } : x)))
  }, [])

  // -----------------------------
  // Checkout-Flow (Multi-Verbuchen)
  // -----------------------------
  const openCheckout = useCallback(() => {
    const selected = drinks.filter(d => (d.qty ?? 0) > 0)
    let remaining = freePool
    const lines: CheckoutLine[] = []
    let totalQty = 0
    let freeUsed = 0
    let payCents = 0

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
    setPopup('checkout')
  }, [drinks, freePool])

  const confirmCheckout = useCallback(async () => {
    if (!user) return

    // Sammle Inserts & Zähler
    const inserts: any[] = []
    let freeUsed = 0
    let anySpezi = false

    for (const line of checkoutLines) {
      if (line.freeQty > 0) {
        inserts.push({
          user_id: user.id,
          drink_id: line.drinkId,
          quantity: line.freeQty,
          unit_price_cents: 0,
          source: 'single',
        })
        freeUsed += line.freeQty
      }
      if (line.payQty > 0) {
        inserts.push({
          user_id: user.id,
          drink_id: line.drinkId,
          quantity: line.payQty,
          unit_price_cents: line.unitCents,
          source: 'single',
        })
      }
      if (line.name.toLowerCase().includes('spezi')) {
        anySpezi = true
      }
    }

    // Kontostand per RPC erhöhen (nur zahlpflichtiger Teil)
    if (checkoutTotals.payCents > 0) {
      const { data, error: balanceError } = await supabase.rpc('increment_balance', {
        user_id_input: user.id,
        amount_input: checkoutTotals.payCents
      })
      console.log('RPC Ergebnis increment_balance:', { data, balanceError })
      if (balanceError) {
        console.error('Fehler beim Aktualisieren des Kontostands:', balanceError)
      } else {
        setUser(prev => prev ? { ...prev, open_balance_cents: (prev.open_balance_cents ?? 0) + checkoutTotals.payCents } : prev)
      }
    }

    // Einfügen aller Buchungen via SECURITY DEFINER RPC
    if (inserts.length > 0) {
      const { error: rpcErr1 } = await supabase.rpc('terminal_insert_consumptions', {
        _rows: inserts as any,
      })
      if (rpcErr1) {
        console.error('RPC terminal_insert_consumptions error:', rpcErr1)
        showToast('❌ Buchung fehlgeschlagen')
        return
      }
    }

    // globalen Freibier-Pool reduzieren (via RPC)
    if (freeUsed > 0) {
      const { error: rpcErr2 } = await supabase.rpc('terminal_decrement_free_pool', {
        _id: FREE_POOL_ID,
        _used: freeUsed,
      })
      if (rpcErr2) {
        console.error('RPC terminal_decrement_free_pool error:', rpcErr2)
      } else {
        setFreePool(p => Math.max(0, p - freeUsed))
      }
    }

    // UI aufräumen
    setCheckoutLines([])
    setPopup(null)
    setDrinks(list => list.map(d => ({ ...d, qty: 0 })))
    showToast('✅ Bestellung verbucht')

    // 5s warten → Spruch anzeigen → 10s oder Klick → Logout
    if (logoutTimer.current) clearTimeout(logoutTimer.current)
    logoutTimer.current = setTimeout(() => {
      void startLogoutWithQuote(anySpezi)
    }, 5000)
  }, [user, checkoutLines, checkoutTotals.payCents, showToast])

  // -----------------------------
  // Kiste kaufen (pro Drink) – kein Freibierabzug
  // -----------------------------
  const openCrateInfo = useCallback((drink: Drink) => {
    setSelectedDrink(drink)
    setPopup('crateInfo')
  }, [])

  const buyCrateNow = useCallback(async () => {
    if (!user || !selectedDrink) return

    const rows = [{
      user_id: user.id,
      drink_id: selectedDrink.id,
      quantity: BOTTLES_PER_CRATE,
      unit_price_cents: selectedDrink.crate_price_cents,
      source: 'crate' as const,
    }]

    // Insert via SECURITY DEFINER RPC
    const { error: rpcErr3 } = await supabase.rpc('terminal_insert_consumptions', {
      _rows: rows as any,
    })
    if (rpcErr3) {
      console.error('RPC terminal_insert_consumptions (crate) error:', rpcErr3)
      showToast('❌ Kiste konnte nicht gebucht werden')
      return
    }

    setPopup(null)
    showToast(`✅ Kiste ${selectedDrink.name} gebucht`)

    // Kontostand erhöhen um Kistenpreis
    const { error: crateBalanceError } = await supabase.rpc('increment_balance', {
      user_id_input: user.id,
      amount_input: selectedDrink.crate_price_cents
    })
    if (crateBalanceError) {
      console.error('Fehler beim Aktualisieren des Kontostands (Kiste):', crateBalanceError)
    } else {
      setUser(prev =>
        prev ? { ...prev, open_balance_cents: (prev.open_balance_cents ?? 0) + selectedDrink.crate_price_cents } : prev
      )
    }

    // 5s → Spruch
    setTimeout(() => {
      const isSpezi = selectedDrink.name.toLowerCase().includes('spezi')
      void startLogoutWithQuote(isSpezi)
    }, 5000)
  }, [user, selectedDrink, showToast])

  // -----------------------------
  // Logout-Spruch
  // -----------------------------
  const startLogoutWithQuote = useCallback(async (forceGuenter: boolean) => {
    if (forceGuenter) {
      setQuote({ text: 'Auf ein Spezi musst du 3 Bier trinken!', author: 'Günter Kropf' })
    } else {
      const r = await supabase.from('quotes').select('text, author').eq('is_special', false)
      if (r.data && r.data.length > 0) {
        const idx = Math.floor(Math.random() * r.data.length)
        setQuote({ text: r.data[idx].text, author: r.data[idx].author })
      } else {
        setQuote({ text: 'Der Ball ist rund und das Spiel dauert 90 Minuten.', author: 'Sepp Herberger' })
      }
    }
    setPopup('quote')
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => {
      setPopup(null)
      handleLogout()
    }, 10000)
  }, [handleLogout])

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-300 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>
          TSV Lonnerstadt • <span className="font-semibold">Herren-Terminal</span>
          {user && <span className="ml-3 text-green-500 font-semibold">👤 {user.first_name} ({timer}s)</span>}
        </span>
      </header>

      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6 h-[calc(100vh-3.5rem)]">
        {/* PIN-Seite */}
        {step === 'pin' && (
          <>
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

            {/* Platzbelegung Mo–So (alte Tage ausgeblendet) */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <h2 className="text-xl font-semibold mb-3 text-center">📅 Platzbelegung (diese Woche)</h2>
              {Object.keys(groupedByDay).length === 0 ? (
                <p className="text-neutral-500 text-center text-sm">Keine Belegung für heute & folgende Tage.</p>
              ) : (
                <div className="space-y-5">
                  {Object.entries(groupedByDay).map(([day, entries]) => (
                    <div key={day}>
                      <h3 className="text-lg font-semibold text-green-400 mb-2 border-b border-neutral-800 pb-1">{day}</h3>
                      {(entries as any[]).map((e) => (
                        <div key={e.id} className="border border-neutral-800 bg-neutral-900/60 rounded-lg p-3 mb-2">
                          <div className="flex justify-between">
                            <span className="text-green-400 font-semibold">Platz {e.field}</span>
                            <span className="text-sm text-neutral-400">{e.time} Uhr</span>
                          </div>
                          <div className="text-sm text-neutral-200 font-medium">{e.team_home} vs. {e.team_guest}</div>
                          <div className="text-xs text-neutral-400">{e.competition} • {e.section}</div>
                          {e.location && <div className="text-xs text-neutral-500 mt-1">📍 {e.location}</div>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Übersicht & Verbuchen */}
        {step === 'overview' && (
          <>
            {/* Links: Kopf + Karten */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
              <div className="text-center mb-4">
                <h1 className="text-3xl font-bold mb-1">Hallo {user?.first_name} {user?.last_name} 👋</h1>
                <p className="text-neutral-400 text-sm">Willkommen am Herren-Terminal</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FancyCard icon="💰" label="Kontostand" value={euro(user?.open_balance_cents ?? 0)} sub="Saldo" color="from-rose-900/80 to-rose-800/40" />
                <FancyCard icon="🍺" label="Gesamtverbrauch" value={`${myWeekTotal}`} sub="Flaschen/Becher (Woche)" color="from-green-900/80 to-green-800/40" />
                <FancyCard icon="🎁" label="Freibier (gesamt)" value={`${freePool}`} sub="verfügbare Flaschen" color={freePool > 0 ? 'from-emerald-800/80 to-emerald-700/40' : 'from-gray-700 to-gray-800'} />
                <FancyCard icon="💶" label="Letzte Zahlung" value={lastPayment ? `${lastPayment.amount.toFixed(2)} €` : '—'} sub={lastPayment ? `am ${lastPayment.date}` : ''} color="from-blue-900/80 to-blue-800/40" />
              </div>
            </div>

            {/* Rechts: Getränke + zentraler Verbuchen-Flow + Kisten-Buttons */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">🍻 Getränke</h2>
                <button onClick={handleLogout} className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700">🔒 Logout</button>
              </div>

              <div className="space-y-3 overflow-y-auto pr-1">
                {drinks.map((d) => (
                  <div key={d.id} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{d.name}</div>
                        <div className="text-xs text-neutral-500">
                          Einzel: {euro(d.price_cents)} • Kiste: {euro(d.crate_price_cents)} ({BOTTLES_PER_CRATE} Fl.)
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => decQty(d)} className="w-12 h-12 rounded-xl bg-rose-900 text-white text-2xl leading-none">−</button>
                        <div className="w-12 text-center text-xl tabular-nums select-none">{d.qty ?? 0}</div>
                        <button onClick={() => incQty(d)} className="w-12 h-12 rounded-xl bg-emerald-700 text-white text-2xl leading-none">＋</button>
                        {/* Optional: Einzel / Freibier-Kontext-Button je Drink */}
                        <button onClick={() => openCrateInfo(d)} className="px-3 py-2 rounded-lg bg-blue-700/80 hover:bg-blue-600 text-sm">🧊 Kiste kaufen</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-neutral-300 text-sm">
                  Gewählt: <strong>{totalQty}</strong> · Frei verfügbar: <strong>{freePool}</strong>
                </div>
                <button
                  disabled={totalQty === 0}
                  onClick={openCheckout}
                  className={`px-5 py-3 rounded-xl font-semibold ${totalQty>0 ? 'bg-green-600 hover:bg-green-700' : 'bg-neutral-800 text-neutral-500 cursor-not-allowed'}`}
                >
                  📤 Jetzt gesamt verbuchen
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---------- Popups ---------- */}

      {/* Checkout-Übersicht (multiline, angew. Freibier) */}
      <AnimatePresence>
        {popup === 'checkout' && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 text-white w-[min(720px,95vw)] rounded-2xl p-6 shadow-2xl">
              <h3 className="text-xl font-semibold mb-4">Buchungsübersicht</h3>
              <div className="space-y-2 max-h-[50vh] overflow-auto pr-2">
                {checkoutLines.map((ln) => (
                  <div key={ln.drinkId} className="flex flex-wrap items-center justify-between border-b border-neutral-800 py-2">
                    <div className="font-medium truncate">{ln.name}</div>
                    <div className="text-sm text-neutral-300">Menge: <b>{ln.qty}</b></div>
                    <div className="text-sm text-emerald-400">Frei: {ln.freeQty}</div>
                    <div className="text-sm text-sky-300">Zahlend: {ln.payQty} × {euro(ln.unitCents)} = <b>{euro(ln.linePaidCents)}</b></div>
                  </div>
                ))}
              </div>
              <div className="mt-4 p-3 rounded-lg bg-neutral-800 flex flex-wrap gap-6 text-sm">
                <div>Freibier genutzt: <b>{checkoutTotals.freeUsed}</b></div>
                <div>Verbleibendes Freibier: <b>{checkoutTotals.remainingPool}</b></div>
                <div>Gesamtsumme: <b>{euro(checkoutTotals.payCents)}</b></div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600" onClick={() => setPopup(null)}>Abbrechen</button>
                <button className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 font-semibold" onClick={confirmCheckout}>Bestätigen & buchen</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kisten-Info + Kaufbestätigung (kein Freibierabzug) */}
      <AnimatePresence>
        {popup === 'crateInfo' && selectedDrink && (
          <motion.div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 text-white w-[min(640px,95vw)] rounded-2xl p-6 shadow-2xl">
              <h3 className="text-xl font-semibold mb-3">🧊 Kiste „{selectedDrink.name}“ kaufen?</h3>
              <p className="text-sm text-neutral-300">
                Diese Kiste ist dafür gedacht, nach dem Spiel oder Training in die <b>Kabine</b> gestellt zu werden,
                damit sich alle bedienen können. <b>Die Flaschen werden nicht vom Freibier-Kontingent abgezogen</b>,
                niemand muss etwas eintragen.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-4 py-2 rounded-lg bg-neutral-700 hover:bg-neutral-600" onClick={() => setPopup(null)}>Abbrechen</button>
                <button
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold"
                  onClick={buyCrateNow}
                >
                  Kaufen für {selectedDrink ? euro(selectedDrink.crate_price_cents) : ''}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spruch beim Logout */}
      <AnimatePresence>
        {popup === 'quote' && quote && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justifycenter"
            onClick={dismissQuoteNow}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="bg-neutral-900 text-white w-[min(600px,95vw)] rounded-2xl p-6 text-center shadow-2xl">
              <p className="text-xl font-semibold italic mb-2">„{quote.text}“</p>
              <p className="text-sm text-neutral-400">– {quote.author}</p>
              <p className="text-xs text-neutral-500 mt-3">Tippe, um fortzufahren (oder schließt sich automatisch).</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }} className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// -----------------------------
// Karten-Komponente (Profilstil)
// -----------------------------
function FancyCard({
  icon, label, value, sub, color,
}: { icon: string; label: string; value: string; sub?: string; color: string }) {
  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className={`p-4 rounded-2xl bg-gradient-to-br ${color} text-white shadow-md flex flex-col justify-center`}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="text-3xl">{icon}</div>
        <div className="text-sm text-neutral-300">{label}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </motion.div>
  )
}
