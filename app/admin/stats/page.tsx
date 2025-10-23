'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  ResponsiveContainer,
} from 'recharts'
import * as XLSX from 'xlsx'

type Consumption = {
  created_at: string
  unit_price_cents: number
  quantity: number
  drinks: { name: string }[]
}

type Purchase = {
  created_at: string
  crate_price_cents: number
  quantity: number
  drinks: { name: string }[]
}

type Profile = {
  open_balance_cents: number
}

type Drink = {
  name: string
  ek_crate_price_cents?: number
}

export default function StatsPage() {
  const [consumptions, setConsumptions] = useState<Consumption[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<'all' | 'year' | 'lastYear' | 'quarter' | 'month'>('year')

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      const [{ data: cons }, { data: purch }, { data: prof }, { data: dr }] = await Promise.all([
        supabase.from('consumptions').select('created_at, unit_price_cents, quantity, drinks(name)'),
        supabase.from('purchases').select('created_at, crate_price_cents, quantity, drinks(name)'),
        supabase.from('profiles').select('open_balance_cents'),
        supabase.from('drinks').select('name, crate_price_cents').order('name'),
      ])
      setConsumptions(cons || [])
      setPurchases(purch || [])
      setProfiles(prof || [])
      setDrinks(dr || [])
      setLoading(false)
    }
    loadData()
  }, [])

  // 📅 Filterfunktion
  const filterByRange = (dateStr: string) => {
    if (range === 'all') return true
    const date = new Date(dateStr)
    const now = new Date()
    const year = now.getFullYear()
    if (range === 'year') return date.getFullYear() === year
    if (range === 'lastYear') return date.getFullYear() === year - 1
    if (range === 'quarter') {
      const diffMonths = (now.getMonth() - date.getMonth()) + 12 * (now.getFullYear() - date.getFullYear())
      return diffMonths < 3
    }
    if (range === 'month') {
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
    }
    return true
  }

  // 📊 Einnahmen/Kosten aggregieren pro Monat
  const monthlyData = useMemo(() => {
    const formatMonth = (date: string) =>
      new Date(date).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' })

    const revenueMap: Record<string, number> = {}
    const costMap: Record<string, number> = {}

    consumptions.filter(c => filterByRange(c.created_at)).forEach((c) => {
      const key = formatMonth(c.created_at)
      revenueMap[key] = (revenueMap[key] || 0) + (c.unit_price_cents || 0) * (c.quantity || 0)
    })

    purchases.filter(p => filterByRange(p.created_at)).forEach((p) => {
      const key = formatMonth(p.created_at)
      costMap[key] = (costMap[key] || 0) + (p.crate_price_cents || 0) * (p.quantity || 0)
    })

    const allMonths = Array.from(new Set([...Object.keys(revenueMap), ...Object.keys(costMap)])).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime()
    )

    return allMonths.map((m) => ({
      month: m,
      einnahmen: (revenueMap[m] || 0) / 100,
      kosten: (costMap[m] || 0) / 100,
      gewinn: ((revenueMap[m] || 0) - (costMap[m] || 0)) / 100,
    }))
  }, [consumptions, purchases, range])

  // 🥤 Verbrauch pro Getränk
  const drinkStats = useMemo(() => {
    const drinkMap: Record<string, number> = {}
    consumptions.filter(c => filterByRange(c.created_at)).forEach((c) => {
      const name = c.drinks?.[0]?.name || 'Unbekannt'
      drinkMap[name] = (drinkMap[name] || 0) + c.quantity
    })
    return Object.entries(drinkMap).map(([name, menge]) => ({ name, menge }))
  }, [consumptions, range])

  // 💹 Top-Produkte nach Marge
  const topDrinks = useMemo(() => {
    const stats: Record<string, { einnahmen: number; menge: number }> = {}

    consumptions.filter(c => filterByRange(c.created_at)).forEach((c) => {
      const name = c.drinks?.[0]?.name || 'Unbekannt'
      if (!stats[name]) stats[name] = { einnahmen: 0, menge: 0 }
      stats[name].einnahmen += (c.unit_price_cents || 0) * (c.quantity || 0)
      stats[name].menge += c.quantity
    })

    const ekLookup: Record<string, number> = {}
    drinks.forEach((d) => {
      ekLookup[d.name] = d.ek_crate_price_cents || 0
    })

    const result = Object.entries(stats).map(([name, s]) => {
      const kosten = ((s.menge / 20) * (ekLookup[name] || 0)) / 100
      const einnahmen = s.einnahmen / 100
      return { name, einnahmen, kosten, gewinn: einnahmen - kosten }
    })

    return result.sort((a, b) => b.gewinn - a.gewinn).slice(0, 10)
  }, [consumptions, drinks, range])

  // 💰 Offene Posten Gesamt
  const totalOpen = profiles.reduce((sum, p) => sum + (p.open_balance_cents || 0), 0) / 100

  // 📤 CSV Export
  const exportCSV = () => {
    const header = 'Monat;Einnahmen (€);Kosten (€);Gewinn (€)\n'
    const rows = monthlyData
      .map((d) => `${d.month};${d.einnahmen.toFixed(2)};${d.kosten.toFixed(2)};${d.gewinn.toFixed(2)}`)
      .join('\n')
    const csv = header + rows
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Statistik_${range}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 📊 Excel Export
  const exportExcel = () => {
    const wsData = [
      ['Monat', 'Einnahmen (€)', 'Kosten (€)', 'Gewinn (€)'],
      ...monthlyData.map((d) => [d.month, d.einnahmen, d.kosten, d.gewinn]),
    ]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Statistik')
    XLSX.writeFile(wb, `Statistik_${range}_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading) return <div className="p-6 text-center text-white">⏳ Lade Statistik...</div>

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <TopNav />
      <AdminNav />

      <div className="max-w-6xl mx-auto p-6 space-y-10 pt-10">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <h1 className="text-2xl font-bold">📊 Statistik & Entwicklung</h1>

          <div className="flex gap-3 flex-wrap items-center">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as any)}
              className="bg-gray-800 border border-gray-700 rounded p-2 text-sm"
            >
              <option value="all">Gesamt</option>
              <option value="year">Aktuelles Jahr</option>
              <option value="lastYear">Letztes Jahr</option>
              <option value="quarter">Letzte 3 Monate</option>
              <option value="month">Letzter Monat</option>
            </select>

            <button
              onClick={exportCSV}
              className="bg-gray-700 hover:bg-gray-800 px-3 py-2 rounded text-sm font-medium"
            >
              📤 CSV exportieren
            </button>
            <button
              onClick={exportExcel}
              className="bg-green-700 hover:bg-green-800 px-3 py-2 rounded text-sm font-medium"
            >
              📈 Excel exportieren
            </button>
          </div>
        </div>

        {/* Kennzahlen */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Einnahmen" value={`${monthlyData.reduce((a, b) => a + b.einnahmen, 0).toFixed(2)} €`} />
          <StatCard title="Kosten" value={`${monthlyData.reduce((a, b) => a + b.kosten, 0).toFixed(2)} €`} />
          <StatCard title="Gewinn" value={`${monthlyData.reduce((a, b) => a + b.gewinn, 0).toFixed(2)} €`} />
          <StatCard title="Offene Posten" value={`${totalOpen.toFixed(2)} €`} />
        </div>

        {/* Einnahmen / Kosten / Gewinn */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow">
          <h2 className="text-lg font-semibold mb-3">Einnahmen / Kosten / Gewinn ({range})</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="month" stroke="#aaa" />
                <YAxis stroke="#aaa" />
                <Tooltip />
                <Line type="monotone" dataKey="einnahmen" stroke="#22c55e" />
                <Line type="monotone" dataKey="kosten" stroke="#f59e0b" />
                <Line type="monotone" dataKey="gewinn" stroke="#3b82f6" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Verbrauch */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow">
          <h2 className="text-lg font-semibold mb-3">Verbrauch nach Getränk ({range})</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={drinkStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis dataKey="name" stroke="#aaa" />
                <YAxis stroke="#aaa" />
                <Tooltip />
                <Bar dataKey="menge" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Top-Produkte */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow">
          <h2 className="text-lg font-semibold mb-3">Top-Produkte nach Marge ({range})</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDrinks} layout="vertical" margin={{ top: 10, right: 30, left: 60, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                <XAxis type="number" stroke="#aaa" />
                <YAxis type="category" dataKey="name" stroke="#aaa" width={120} />
                <Tooltip />
                <Bar dataKey="gewinn" fill="#22c55e" name="Gewinn (€)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-center shadow">
      <div className="text-gray-400 text-sm">{title}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  )
}
