'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'
import {
  PiggyBank,
  CreditCard,
  History,
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Beer,
  Gift
} from 'lucide-react'
import { ComposedChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

type PopupData =
  | null
  | {
    title: string
    method: 'bar' | 'paypal'
  }

type ExtraPopup =
  | null
  | {
    owes: number
    diff: number
    amount: number
    method: 'bar' | 'paypal'
  }

type Toast = { id: number; text: string; type?: 'success' | 'error' }
type Filter = '7days' | 'month' | 'all'

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [popup, setPopup] = useState<PopupData>(null)
  const [extraPopup, setExtraPopup] = useState<ExtraPopup>(null)
  const [amountInput, setAmountInput] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [filter, setFilter] = useState<Filter>('month')
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinMessage, setPinMessage] = useState('')

  // Stats & Chart Data
  const [stats, setStats] = useState({
    totalDrinks: 0,
    totalFree: 0,
    lastPayment: null as null | { amount: number; created_at: string },
    favoriteDrink: '—',
    since: new Date(),
    averagePerWeek: '0'
  })
  const [chartData, setChartData] = useState<any[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500)
  }

  const formatDateTime = (ts: string) => {
    const d = new Date(ts)
    return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })} • ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
  }

  const euro = (val: number) => `${(val).toFixed(2)} €`

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user)
      if (data.user) await fetchData(data.user.id)
    })
  }, [])

  const fetchData = async (uid: string) => {
    const [{ data: cons }, { data: pay }, { data: prof }] = await Promise.all([
      supabase
        .from('consumptions')
        .select('quantity, unit_price_cents, source, via_terminal, created_at, drinks(name)')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('payments')
        .select('amount_cents, verified, method, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').eq('id', uid).single(),
    ])

    setBookings(cons || [])
    setPayments(pay || [])
    setProfile(prof)
    setPin(prof?.pin || '')

    // 🔹 YTD Filter (Seit 1. Januar)
    const currentYear = new Date().getFullYear()
    const startOfYear = new Date(currentYear, 0, 1)

    // Filter für YTD-Berechnungen
    const consYTD = (cons || []).filter(c => new Date(c.created_at) >= startOfYear)

    const totalDrinks = consYTD.reduce((sum, c) => sum + (c.quantity || 0), 0)

    const totalFree = consYTD
      .filter((c) => (c.unit_price_cents || 0) === 0)
      .reduce((sum, c) => sum + (c.quantity || 0), 0)

    const lastPayment = pay && pay.length > 0 ? { amount: pay[0].amount_cents / 100, created_at: pay[0].created_at } : null

    // 🔹 Erweiterte Stats (YTD Basis)
    let favoriteDrink = '—'
    let since = startOfYear // Fallback
    let averagePerWeek = '0'

    if (consYTD.length > 0) {
      // Favorit (YTD)
      const map: Record<string, number> = {}
      consYTD.forEach((c: any) => {
        const name = c.drinks?.name || 'Unbekannt'
        map[name] = (map[name] || 0) + (c.quantity || 0)
      })
      const top = Object.entries(map).sort((a, b) => b[1] - a[1])[0]
      if (top) favoriteDrink = `${top[0]} (${top[1]})`

      // Durchschnitt (YTD)
      // Wir nehmen die aktuelle Kalenderwoche des Jahres als Teiler
      const now = new Date()
      const oneJan = new Date(now.getFullYear(), 0, 1)
      const numberOfDays = Math.floor((now.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000))
      const currentWeek = Math.max(1, Math.ceil((now.getDay() + 1 + numberOfDays) / 7))

      averagePerWeek = (totalDrinks / currentWeek).toFixed(1)
    }

    setStats({ totalDrinks, totalFree, lastPayment, favoriteDrink, since, averagePerWeek })

    // --- Chart Data Calculation (Last 6 Months) ---
    const now = new Date()
    const months: { month: string; iso: string; amount: number; count: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({
        month: d.toLocaleString('de-DE', { month: 'short' }),
        iso: d.toISOString().slice(0, 7), // YYYY-MM
        amount: 0,
        count: 0
      })
    }

    (cons || []).forEach(c => {
      const monthStr = c.created_at.slice(0, 7) // YYYY-MM
      const amount = ((c.quantity || 0) * (c.unit_price_cents || 0)) / 100
      const slot = months.find(m => m.iso === monthStr)
      if (slot) {
        slot.amount += amount
        slot.count += (c.quantity || 0)
      }
    })
    setChartData(months)
  }

  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('profile-realtime')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => fetchData(user.id))
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [user])

  const now = new Date()
  const filterData = (arr: any[]) => {
    if (filter === '7days') {
      const w = new Date(now)
      w.setDate(now.getDate() - 7)
      return arr.filter((a) => new Date(a.created_at) >= w)
    }
    if (filter === 'month') {
      return arr.filter((a) => {
        const d = new Date(a.created_at)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
    }
    return arr
  }

  const filteredBookings = useMemo(() => filterData(bookings), [bookings, filter])

  const overview = useMemo(() => {
    const rows: Record<string, { qty: number; sumCents: number }> = {}

    // Extra Accumulators
    let provisionQty = 0
    let provisionTotal = 0
    let freeQty = 0

    for (const b of filteredBookings) {
      const price = b.unit_price_cents || 0
      const qty = b.quantity || 0

      // Case 1: Crate Provision (Quantity 0, Price > 0)
      if (b.source === 'crate' && qty === 0) {
        provisionQty += 1
        provisionTotal += price
        continue
      }

      // Case 2: Free Drink (Price 0, Quantity > 0)
      if (price === 0 && qty > 0) {
        if (b.source === 'single') freeQty += qty
        continue
      }

      // Case 3: Paid Drink
      if (price > 0 && qty > 0) {
        const name = b.drinks?.name || 'Unbekannt'
        if (!rows[name]) rows[name] = { qty: 0, sumCents: 0 }
        rows[name].qty += qty
        rows[name].sumCents += price * qty
      }
    }

    if (provisionQty > 0) rows['📦 Bereitgestellte Kisten'] = { qty: provisionQty, sumCents: provisionTotal }
    if (freeQty > 0) rows['🎁 Verbrauchte Freigetränke'] = { qty: freeQty, sumCents: 0 }

    return rows
  }, [filteredBookings])

  const balanceCents = profile?.open_balance_cents ?? 0
  const isDebt = balanceCents > 0
  const isCredit = balanceCents < 0

  // --- Payments ---
  const openPaymentPopup = (method: 'bar' | 'paypal') => {
    const balance = profile?.open_balance_cents ?? 0
    const owes = balance > 0 ? (balance / 100).toFixed(2) : ''
    setAmountInput(owes)
    setPopup({ title: method === 'paypal' ? 'PayPal-Zahlung' : 'Barzahlung', method })
  }

  const handleConfirmPayment = () => {
    const num = parseFloat(amountInput.replace(',', '.') || '')
    if (isNaN(num) || num <= 0) return addToast('Bitte gültigen Betrag eingeben.', 'error')
    if (!popup?.method || !user || !profile) return

    const balance = profile.open_balance_cents ?? 0
    const owes = balance > 0 ? balance / 100 : 0

    if (owes > 0 && num > owes) {
      const diff = parseFloat((num - owes).toFixed(2))
      setPopup(null)
      setExtraPopup({ owes, diff, amount: num, method: popup.method })
    } else {
      recordPayment(num, popup.method)
    }
  }

  const recordPayment = async (amount: number, method: 'bar' | 'paypal') => {
    if (!profile) return addToast('Profilfehler', 'error')

    let paypalWindow: Window | null = null
    if (method === 'paypal') paypalWindow = window.open('', '_blank')

    const { error } = await supabase.from('payments').insert([
      {
        user_id: profile.id,
        amount_cents: Math.round(amount * 100),
        method,
        verified: false,
      },
    ])

    if (error) {
      if (paypalWindow) paypalWindow.close()
      return addToast('Fehler beim Speichern', 'error')
    }

    addToast('Zahlung gemeldet. Warte auf Bestätigung.', 'success')
    setPopup(null)
    setExtraPopup(null)
    fetchData(user.id)

    if (method === 'paypal') {
      const redirect = `https://paypal.me/benjamindenert/${amount.toFixed(2)}`
      if (paypalWindow) paypalWindow.location.href = redirect
      else window.location.href = redirect
    }
  }

  const handleExtraChoice = (choice: 'credit' | 'tip') => {
    if (!extraPopup) return
    const { owes, diff, amount, method } = extraPopup
    if (choice === 'tip') {
      addToast(`${diff.toFixed(2)} € als Trinkgeld.`, 'success')
      recordPayment(owes, method)
    } else {
      addToast(`${diff.toFixed(2)} € als Guthaben.`, 'success')
      recordPayment(amount, method)
    }
  }

  const updatePin = async () => {
    setPinMessage('')
    if (newPin.length !== 6 || isNaN(Number(newPin))) {
      return setPinMessage('PIN muss 6 Ziffern haben.')
    }
    const { data: existing } = await supabase.from('profiles').select('id').eq('pin', newPin)
    if (existing && existing.length > 0) return setPinMessage('PIN ist schon vergeben.')
    const { error } = await supabase.from('profiles').update({ pin: newPin }).eq('id', user.id)
    if (error) return setPinMessage('Fehler beim Speichern.')
    setPin(newPin)
    setNewPin('')
    setPinMessage('PIN erfolgreich geändert ✅')
  }

  return (
    <>
      <TopNav />
      <div className="pt-24 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white pb-24 px-4">
        <div className="max-w-4xl mx-auto space-y-8">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 border-b border-neutral-800 pb-6">
            <div>
              <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-neutral-400">
                Dein Profil
              </h1>
              <p className="text-neutral-400 mt-1">
                {profile?.first_name} {profile?.last_name}
              </p>
            </div>
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left Column: Balance & Actions */}
            <div className="lg:col-span-1 space-y-6">

              {/* Balance Card */}
              <div className="relative overflow-hidden rounded-3xl bg-neutral-900 border border-neutral-800 p-6 shadow-2xl">
                <div className={`absolute inset-0 opacity-20 bg-gradient-to-br ${isDebt ? 'from-rose-600 to-rose-900' : 'from-emerald-600 to-emerald-900'}`} />
                <div className="relative z-10 text-center py-4">
                  <div className="text-neutral-400 text-sm uppercase tracking-wider font-medium mb-1">Aktueller Kontostand</div>
                  <div className={`text-4xl font-bold tracking-tight ${isDebt ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {(Math.abs(balanceCents) / 100).toFixed(2)} €
                  </div>
                  <div className="text-neutral-500 text-sm mt-1">
                    {isDebt ? 'Offener Betrag' : 'Guthaben'}
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="relative z-10 grid grid-cols-2 gap-3 mt-6">
                  <button onClick={() => openPaymentPopup('paypal')} className="flex flex-col items-center justify-center p-3 rounded-xl bg-blue-900/30 hover:bg-blue-900/50 border border-blue-800/50 transition-colors group">
                    <CreditCard className="w-6 h-6 text-blue-400 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold text-blue-200">PayPal</span>
                  </button>
                  <button onClick={() => openPaymentPopup('bar')} className="flex flex-col items-center justify-center p-3 rounded-xl bg-amber-900/30 hover:bg-amber-900/50 border border-amber-800/50 transition-colors group">
                    <Wallet className="w-6 h-6 text-amber-400 mb-1 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold text-amber-200">Bar</span>
                  </button>
                </div>
              </div>

              {/* Stats - Last Payment */}
              <div className="rounded-3xl bg-neutral-900/50 border border-neutral-800 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-full bg-neutral-800 text-neutral-400"><History className="w-5 h-5" /></div>
                  <div>
                    <div className="text-xs text-neutral-500">Letzte Zahlung</div>
                    <div className="font-medium text-white">{stats.lastPayment ? `${stats.lastPayment.amount.toFixed(2)} €` : '—'}</div>
                  </div>
                </div>
                <div className="text-xs text-neutral-600">{stats.lastPayment ? new Date(stats.lastPayment.created_at).toLocaleDateString() : ''}</div>
              </div>

              {/* Stats - Total Drinks Expanded */}
              <div className="rounded-3xl bg-neutral-900 overflow-hidden border border-neutral-800">
                <div className="p-5 flex items-center justify-between border-b border-neutral-800/50">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-full bg-neutral-800 text-emerald-400"><Beer className="w-5 h-5" /></div>
                    <div>
                      <div className="text-xs text-neutral-500">Getränke (dieses Jahr)</div>
                      <div className="font-bold text-xl text-white">{stats.totalDrinks}</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-3 bg-neutral-900/50">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-neutral-500">Lieblings-Drink</span>
                    <span className="text-neutral-200 font-medium">{stats.favoriteDrink}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-neutral-500">Ø pro Woche</span>
                    <span className="text-neutral-200 font-medium">{stats.averagePerWeek}</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column: Chart & Lists */}
            <div className="lg:col-span-2 space-y-6">

              {/* Chart */}
              <div className="rounded-3xl bg-neutral-900 border border-neutral-800 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-neutral-400" />
                    <h3 className="font-semibold text-neutral-200">Ausgaben & Konsum</h3>
                  </div>

                  {/* Legend */}
                  <div className="flex gap-4 text-xs font-medium">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-sm bg-blue-500/60 block"></span>
                      <span className="text-neutral-400">Ausgaben (€)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-8 h-1 bg-amber-400 rounded-full block relative top-[1px]"></span>
                      <span className="text-neutral-400">Anzahl</span>
                    </div>
                  </div>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <XAxis dataKey="month" stroke="#525252" fontSize={12} tickLine={false} axisLine={false} dy={10} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.3)' }}
                        itemStyle={{ color: '#e5e5e5', fontSize: '12px' }}
                        cursor={{ fill: '#262626' }}
                        formatter={(value: any, name: string) => [
                          name === 'amount' ? `${value.toFixed(2)} €` : `${value}x`,
                          name === 'amount' ? 'Ausgaben' : 'Anzahl'
                        ]}
                        labelStyle={{ color: '#a3a3a3', marginBottom: '4px' }}
                      />
                      <Bar dataKey="amount" radius={[4, 4, 0, 0]} barSize={32} name="amount">
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.amount > 20 ? '#10b981' : '#3b82f6'} fillOpacity={0.6} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="count" stroke="#fbbf24" strokeWidth={3} dot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }} activeDot={{ r: 6 }} name="count" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recent Transactions List */}
              <div className="rounded-3xl bg-neutral-900 border border-neutral-800 overflow-hidden">
                <div className="p-6 border-b border-neutral-800 flex justify-between items-center">
                  <h3 className="font-semibold text-neutral-200">Aktivitäten</h3>
                  <div className="flex gap-1">
                    {['7days', 'month', 'all'].map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f as Filter)}
                        className={`text-[10px] uppercase font-bold px-3 py-1 rounded-full transition-colors ${filter === f ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-500 hover:text-neutral-300'
                          }`}
                      >
                        {f === '7days' ? '7 Tage' : f === 'month' ? 'Monat' : 'Alle'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-[400px] overflow-y-auto p-2 space-y-1">
                  {/* Summary Row */}
                  {Object.keys(overview).length > 0 && (
                    <div className="mb-4 mx-2 p-3 rounded-xl bg-neutral-800/50 border border-neutral-700/50">
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(overview).map(([name, d]: any) => (
                            <tr key={name} className="border-b border-neutral-700/50 last:border-0">
                              <td className="py-1 text-neutral-300">{name}</td>
                              <td className="py-1 text-right text-neutral-400">{d.qty}x</td>
                              <td className="py-1 text-right font-medium text-neutral-200">{(d.sumCents / 100).toFixed(2)} €</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {filteredBookings.length === 0 ? (
                    <div className="text-center py-8 text-neutral-500 text-sm">Keine Einträge im Zeitraum</div>
                  ) : (
                    filteredBookings.map((b, i) => {
                      const isCredit = b.source === 'crate' && (b.quantity || 0) === 0
                      return (
                        <div key={i} className="flex items-center justify-between p-3 hover:bg-neutral-800/50 rounded-xl transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${isCredit ? 'bg-purple-900/50 text-purple-300' :
                              (b.unit_price_cents === 0) ? 'bg-emerald-900/50 text-emerald-300' :
                                'bg-neutral-800 text-neutral-400'
                              }`}>
                              {isCredit ? <Gift size={14} /> : b.unit_price_cents === 0 ? <Gift size={14} /> : <Beer size={14} />}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-neutral-200">
                                {isCredit ? 'Kiste bereitgestellt' :
                                  b.unit_price_cents === 0 ? `Freibier: ${b.drinks?.name || 'Getränk'}` :
                                    `${b.quantity}x ${b.drinks?.name || 'Unbekannt'}`}
                              </div>
                              <div className="text-[11px] text-neutral-500">{formatDateTime(b.created_at)}</div>
                            </div>
                          </div>
                          <div className={`text-sm font-mono ${isCredit ? 'text-emerald-400' : 'text-neutral-300'}`}>
                            {isCredit ? '+' : ''}{euro((b.quantity * b.unit_price_cents) / 100)}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* PIN */}
              <div className="rounded-3xl bg-neutral-900 border border-neutral-800 p-6">
                <h3 className="font-semibold text-neutral-200 mb-4">PIN Verwaltung</h3>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input type="text" maxLength={6} placeholder="Neuer PIN (6 Ziffern)" value={newPin} onChange={(e) => setNewPin(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2 text-white text-center tracking-widest focus:outline-none focus:border-neutral-600"
                    />
                  </div>
                  <button onClick={updatePin} className="px-6 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl font-medium transition-colors">
                    Ändern
                  </button>
                </div>
                {pinMessage && <p className="text-xs text-amber-500 mt-2 text-center">{pinMessage}</p>}
              </div>

            </div>
          </div>

          <Toasts toasts={toasts} />
        </div>
      </div>

      {/* Popups */}
      <AnimatePresence>
        {(popup || extraPopup) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-neutral-900 rounded-3xl border border-neutral-800 shadow-2xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4 text-white">
                  {popup?.method === 'paypal' ? <CreditCard /> : <Wallet />}
                </div>

                <h3 className="text-xl font-bold text-white mb-2">{extraPopup ? 'Überzahlung' : popup?.title}</h3>

                {!extraPopup ? (
                  <>
                    <p className="text-neutral-400 text-sm mb-6">
                      {popup?.method === 'bar'
                        ? 'Bitte gib den Betrag an, den du bar in die Kasse gelegt hast.'
                        : 'Du wirst zu PayPal weitergeleitet.'}
                    </p>

                    <div className="space-y-4">
                      <input
                        type="number"
                        placeholder="0.00 €"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                        className="w-full bg-neutral-950 text-white text-center text-3xl font-bold py-4 rounded-2xl border border-neutral-800 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-neutral-700"
                      />

                      {/* Quick Amounts */}
                      <div className="grid grid-cols-3 gap-2">
                        {[10, 20, 50].map(amt => (
                          <button key={amt} onClick={() => setAmountInput(amt.toString())} className="py-2 bg-neutral-800 hover:bg-neutral-700 rounded-xl text-sm font-medium transition-colors">
                            {amt} €
                          </button>
                        ))}
                      </div>

                      <div className="flex gap-3 mt-4">
                        <button onClick={() => setPopup(null)} className="flex-1 py-3 bg-neutral-800 hover:bg-neutral-700 rounded-xl font-medium transition-colors">Abbrechen</button>
                        <button onClick={handleConfirmPayment} className="flex-1 py-3 bg-white text-black hover:bg-gray-200 rounded-xl font-bold transition-colors">Weiter</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-neutral-400 text-sm mb-6">
                      Differenz: <strong>{extraPopup.diff.toFixed(2)} €</strong>
                    </p>
                    <div className="flex gap-3">
                      <button onClick={() => handleExtraChoice('credit')} className="flex-1 py-3 bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded-xl font-medium">Als Guthaben</button>
                      <button onClick={() => handleExtraChoice('tip')} className="flex-1 py-3 bg-amber-900/50 text-amber-400 border border-amber-800 rounded-xl font-medium">Als Trinkgeld</button>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}


function Toasts({ toasts }: any) {
  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
      <AnimatePresence>
        {toasts.map((t: any) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`px-4 py-2 rounded-xl text-sm shadow-lg font-medium ${t.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-black'
              }`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
