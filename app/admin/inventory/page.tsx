'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { AnimatePresence, motion } from 'framer-motion'

const BOTTLES_PER_CRATE = 20
const euro = (c: number) => (c / 100).toFixed(2) + ' €'

export default function InventoryRevenuePage() {
  const [filterMode, setFilterMode] = useState<'7days' | 'month' | 'year' | 'custom'>('year')
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10)
  })

  const [loading, setLoading] = useState(true)
  const [drinks, setDrinks] = useState<any[]>([])
  const [fullConsumptions, setFullConsumptions] = useState<any[]>([])
  const [fullPurchases, setFullPurchases] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])

  // Period Data
  const [periodData, setPeriodData] = useState({
    revenueExpected: 0,
    incomeReal: 0,
    expenses: 0,
    crateProvisions: 0,
    freeBeerConsumedQty: 0,
  })

  // Toasts
  const [toasts, setToasts] = useState<{ id: number; text: string; type: 'success' | 'error' }[]>([])
  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(p => [...p, { id, text, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000)
  }

  // Date Helper
  const getDateRange = () => {
    const now = new Date()
    let from = new Date(now), to = new Date(now)

    if (filterMode === '7days') from.setDate(now.getDate() - 6)
    else if (filterMode === 'month') from.setDate(1) // 1st of month
    else if (filterMode === 'year') from.setMonth(0, 1)
    else { from = new Date(customRange.from); to = new Date(customRange.to) }

    from.setHours(0, 0, 0, 0)
    to.setHours(23, 59, 59, 999)
    return { from, to }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    calculatePeriodStats()
  }, [filterMode, customRange, fullConsumptions, fullPurchases, payments])

  const loadData = async () => {
    setLoading(true)
    const [d, c, pu, pa, pr] = await Promise.all([
      supabase.from('drinks').select('*').order('name'),
      supabase.from('consumptions').select('id, drink_id, quantity, unit_price_cents, source, created_at, via_terminal'),
      supabase.from('purchases').select('*'),
      supabase.from('payments').select('*').eq('verified', true),
      supabase.from('profiles').select('id, first_name, last_name, open_balance_cents').order('last_name')
    ])

    if (d.data) setDrinks(d.data)
    if (c.data) setFullConsumptions(c.data)
    if (pu.data) setFullPurchases(pu.data)
    if (pa.data) setPayments(pa.data)
    if (pr.data) setProfiles(pr.data)
    setLoading(false)
  }

  const calculatePeriodStats = () => {
    const { from, to } = getDateRange()

    // Filter in range
    const pCons = fullConsumptions.filter(x => { const d = new Date(x.created_at); return d >= from && d <= to })
    const pPurch = fullPurchases.filter(x => { const d = new Date(x.created_at); return d >= from && d <= to })
    const pPay = payments.filter(x => { const d = new Date(x.created_at); return d >= from && d <= to })

    // 1. Soll-Umsatz (Bookings)
    let rev = 0
    let provisions = 0
    let freeQty = 0

    pCons.forEach(c => {
      const qty = c.quantity || 0
      const price = c.unit_price_cents || 0

      if (c.source === 'crate' && qty === 0) {
        // Provision (User paid for crate, revenue count)
        rev += price
        provisions += price
      } else if (c.source === 'free' || price === 0) {
        freeQty += qty
      } else {
        // Regular purchase
        rev += (qty * price)
      }
    })

    // 2. Ist-Einnahmen (Verifizierte Zahlungen auf Konto/Bar)
    const income = pPay.reduce((s, p) => s + (p.amount_cents || 0), 0)

    // 3. Ausgaben (Einkauf)
    const exp = pPurch.reduce((s, p) => s + ((p.crate_price_cents || 0) * (p.quantity || 0)), 0)

    setPeriodData({
      revenueExpected: rev,
      incomeReal: income,
      expenses: exp,
      crateProvisions: provisions,
      freeBeerConsumedQty: freeQty
    })
  }

  // Stock Calculation (Period Flow)
  const periodStockMap = useMemo(() => {
    const { from, to } = getDateRange()
    const map = new Map<number, { bought: number; sold: number; name: string }>()
    drinks.forEach(d => map.set(d.id, { bought: 0, sold: 0, name: d.name }))

    fullPurchases.forEach(p => {
      const d = new Date(p.created_at); if (d < from || d > to) return;
      const cur = map.get(p.drink_id)
      if (cur) cur.bought += (p.quantity || 0) * 20
    })

    fullConsumptions.forEach(c => {
      const d = new Date(c.created_at); if (d < from || d > to) return;
      const cur = map.get(c.drink_id)
      if (cur) cur.sold += (c.quantity || 0)
    })
    return map
  }, [fullPurchases, fullConsumptions, drinks, filterMode, customRange])

  // Open Positions
  const openPositions = useMemo(() => {
    const debtors = profiles.filter(p => (p.open_balance_cents || 0) > 0)
    const creditors = profiles.filter(p => (p.open_balance_cents || 0) < 0)
    const totalDebt = debtors.reduce((s, p) => s + (p.open_balance_cents || 0), 0)
    const totalCredit = creditors.reduce((s, p) => s + (p.open_balance_cents || 0), 0)
    return { debtors, creditors, totalDebt, totalCredit }
  }, [profiles])

  return (
    <div className="min-h-screen bg-neutral-950 text-white pb-20 pt-14">
      <TopNav />
      <AdminNav />
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-8">

        {/* Header & Filter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
          <h1 className="text-2xl font-bold">📦 Bestand & Finanzen</h1>
          <div className="flex flex-wrap items-center gap-2 bg-gray-900/50 p-1.5 rounded-xl border border-gray-800">
            {(['7days', 'month', 'year', 'custom'] as const).map(m => (
              <button key={m} onClick={() => setFilterMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filterMode === m ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>
                {m === '7days' ? '7 Tage' : m === 'month' ? 'Dieser Monat' : m === 'year' ? 'Dieses Jahr' : 'Individuell'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              onChange={(e) => {
                if (!e.target.value) return
                const type = e.target.value as 'consumptions' | 'purchases' | 'payments'
                const timestamp = new Date().toISOString().slice(0, 10)

                let data: any[] = []
                if (type === 'consumptions') data = fullConsumptions
                if (type === 'purchases') data = fullPurchases
                if (type === 'payments') data = payments

                if (data.length === 0) return addToast('Keine Daten vorhanden', 'error')

                const headers = Object.keys(data[0])
                const csvContent = [
                  headers.join(','),
                  ...data.map(row => headers.map(fieldName => JSON.stringify(row[fieldName], (_, v) => v ?? '')).join(','))
                ].join('\n')

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                const link = document.createElement('a')
                link.href = URL.createObjectURL(blob)
                link.download = `tsv_${type}_${timestamp}.csv`
                link.click()
                e.target.value = ''
              }}
              className="bg-gray-800 text-xs text-gray-300 border border-gray-700 rounded-lg px-3 py-1.5 outline-none hover:bg-gray-700 transition"
            >
              <option value="">💾 Exportieren...</option>
              <option value="consumptions">Verbrauch (Alle)</option>
              <option value="purchases">Einkäufe (Alle)</option>
              <option value="payments">Zahlungen (Alle)</option>
            </select>
          </div>
        </div>

        {/* Custom Range Inputs */}
        {filterMode === 'custom' && (
          <div className="flex items-center gap-4 bg-gray-900/50 p-4 rounded-xl border border-gray-800 animate-in fade-in slide-in-from-top-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase">Von</label>
              <input type="date" value={customRange.from} onChange={e => setCustomRange(p => ({ ...p, from: e.target.value }))} className="bg-gray-800 border-gray-700 rounded px-2 py-1 text-sm text-white" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase">Bis</label>
              <input type="date" value={customRange.to} onChange={e => setCustomRange(p => ({ ...p, to: e.target.value }))} className="bg-gray-800 border-gray-700 rounded px-2 py-1 text-sm text-white" />
            </div>
          </div>
        )}

        {loading ? <div className="text-center py-20 text-gray-400">Lade Daten...</div> : (
          <>
            {/* 1. Finanz-Check (Period) */}
            <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              <StatCard
                title="Soll-Umsatz (Verbuchungen)"
                value={euro(periodData.revenueExpected)}
                sub={`Darin ${euro(periodData.crateProvisions)} Kistenspenden`}
                color="bg-blue-900/20 border-blue-800"
              />
              <StatCard
                title="Ausgaben (Einkauf)"
                value={euro(periodData.expenses)}
                sub="Nachbestellungen"
                color="bg-rose-900/20 border-rose-800"
              />
              <StatCard
                title="Theoret. Bilanz"
                value={euro(periodData.revenueExpected - periodData.expenses)}
                sub="Verbuchung - Ausgaben"
                color="bg-indigo-900/20 border-indigo-800"
              />
              <StatCard
                title="Ist-Einnahmen (Zahlungen)"
                value={euro(periodData.incomeReal)}
                sub="Bar & PayPal (Verifiziert)"
                color="bg-emerald-900/20 border-emerald-800"
              />
              <StatCard
                title="Echter Cashflow"
                value={euro(periodData.incomeReal - periodData.expenses)}
                sub="Ist-Einnahmen - Ausgaben"
                color="bg-gray-800/50 border-gray-700"
              />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* 3. Inventur / Bestandscheck */}
              <section className="lg:col-span-2 bg-gray-800/70 rounded-2xl border border-gray-700 p-6 shadow-sm overflow-hidden">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                  � Bewegung im Zeitraum <span className="text-sm font-normal text-gray-400">(Zugang vs. Abgang)</span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-900/50 text-gray-400 uppercase text-xs">
                      <tr>
                        <th className="px-4 py-3 rounded-l-lg">Getränk</th>
                        <th className="px-4 py-3 text-right">Zugang (Einkauf)</th>
                        <th className="px-4 py-3 text-right">Abgang (Verbrauch)</th>
                        <th className="px-4 py-3 text-right rounded-r-lg">Bilanz (Delta)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {Array.from(periodStockMap.entries()).map(([id, stats]) => {
                        const delta = stats.bought - stats.sold
                        return (
                          <tr key={id} className="hover:bg-gray-800/30">
                            <td className="px-4 py-3 font-medium">{stats.name}</td>
                            <td className="px-4 py-3 text-right text-gray-400">{stats.bought > 0 ? `+${stats.bought}` : '-'}</td>
                            <td className="px-4 py-3 text-right text-gray-400">{stats.sold > 0 ? `-${stats.sold}` : '-'}</td>
                            <td className={`px-4 py-3 text-right font-bold ${delta < 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {delta > 0 ? `+${delta}` : delta} Fl.
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 text-xs text-gray-500 text-center">
                  Zeigt die Bestandsveränderung im gewählten Zeitraum (Einkäufe minus Verbräuche).
                </div>
              </section>

              {/* 4. Zusatzinfos */}
              <section className="space-y-6">
                {/* Freibier Audit */}
                <div className="bg-purple-900/10 rounded-2xl border border-purple-800/30 p-6">
                  <h3 className="font-semibold text-purple-200 mb-2">🎁 Freibier (Zeitraum)</h3>
                  <div className="space-y-2 text-sm text-purple-300">
                    <div className="flex justify-between">
                      <span>Neu bereitgestellt (Wert):</span>
                      <span className="font-bold">{euro(periodData.crateProvisions)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Getrunken (Menge):</span>
                      <span className="font-bold">{periodData.freeBeerConsumedQty} Fl.</span>
                    </div>
                  </div>
                </div>

                {/* Aktionen */}
                <div className="bg-gray-800/70 p-6 rounded-2xl border border-gray-700">
                  <h3 className="font-semibold mb-3">🛠 Shortcuts</h3>
                  <div className="flex flex-col gap-2">
                    <a href="/admin/stock" className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-center text-sm">Bestandspflege (Einkauf)</a>
                    <a href="/admin/users" className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-center text-sm">Nutzer Guthaben prüfen</a>
                  </div>
                </div>
              </section>
            </div>

            {/* 2. Offene Posten & Guthaben */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Schulden (Zu zahlen) */}
              <div className="bg-gray-800/70 rounded-2xl border border-gray-700 p-6 shadow-sm overflow-hidden">
                <h2 className="text-lg font-bold mb-4 text-red-300 flex justify-between items-center">
                  <span>� Ausstehende Zahlungen</span>
                  <span className="text-sm bg-red-900/40 px-2 py-1 rounded">{euro(openPositions.totalDebt)}</span>
                </h2>
                <div className="overflow-y-auto max-h-64">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-900/50 text-gray-400 uppercase text-xs sticky top-0">
                      <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-right">Betrag</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {openPositions.debtors.length === 0 ? <tr><td colSpan={2} className="p-3 text-gray-500">Keine offenen Schulden</td></tr> :
                        openPositions.debtors.map(p => (
                          <tr key={p.id} className="hover:bg-gray-800/30">
                            <td className="px-3 py-2">{p.first_name} {p.last_name}</td>
                            <td className="px-3 py-2 text-right font-medium text-red-400">{euro(p.open_balance_cents || 0)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Guthaben */}
              <div className="bg-gray-800/70 rounded-2xl border border-gray-700 p-6 shadow-sm overflow-hidden">
                <h2 className="text-lg font-bold mb-4 text-green-300 flex justify-between items-center">
                  <span>💰 Guthaben</span>
                  <span className="text-sm bg-green-900/40 px-2 py-1 rounded">{euro(Math.abs(openPositions.totalCredit))}</span>
                </h2>
                <div className="overflow-y-auto max-h-64">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-900/50 text-gray-400 uppercase text-xs sticky top-0">
                      <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-right">Betrag</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                      {openPositions.creditors.length === 0 ? <tr><td colSpan={2} className="p-3 text-gray-500">Kein Guthaben vorhanden</td></tr> :
                        openPositions.creditors.map(p => (
                          <tr key={p.id} className="hover:bg-gray-800/30">
                            <td className="px-3 py-2">{p.first_name} {p.last_name}</td>
                            <td className="px-3 py-2 text-right font-medium text-green-400">{euro(Math.abs(p.open_balance_cents || 0))}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Toasts */}
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className={`fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-lg text-white z-50 ${t.type === 'error' ? 'bg-red-700' : 'bg-green-700'}`}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function StatCard({ title, value, sub, color }: { title: string, value: string, sub?: string, color: string }) {
  return (
    <div className={`p-5 rounded-2xl border ${color} shadow-sm`}>
      <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">{title}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-2">{sub}</div>}
    </div>
  )
}
