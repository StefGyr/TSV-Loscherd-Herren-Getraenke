'use client'

import { useEffect, useState } from 'react'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { supabase } from '@/lib/supabase-browser'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

type DailyStat = { date: string; count: number }

export default function ActivityPage() {
  const [filterMode, setFilterMode] = useState<'7days' | 'month' | 'year' | 'custom'>('7days')
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10)
  })

  const [stats, setStats] = useState({ totalQty: 0, distinctDrinks: 0 })
  const [chartData, setChartData] = useState<DailyStat[]>([])
  const [dailyGrouped, setDailyGrouped] = useState<Record<string, any>>({})
  const [ranking, setRanking] = useState<{ user: string; qty: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  // Helper: Zeitfenster berechnen
  const getDateRange = () => {
    const now = new Date()
    let to = new Date(now)
    let from = new Date(now)

    if (filterMode === '7days') {
      from.setDate(now.getDate() - 6) // inkl. heute
    } else if (filterMode === 'month') {
      from.setDate(1) // 1. des Monats
    } else if (filterMode === 'year') {
      from.setMonth(0, 1) // 1. Januar
    } else if (filterMode === 'custom') {
      from = new Date(customRange.from)
      to = new Date(customRange.to)
    }

    // Reset hours for 'from' to start of day
    from.setHours(0, 0, 0, 0)

    // Ensure 'to' is end of day
    to.setHours(23, 59, 59, 999)

    return { from, to }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) return

      const { data: prof } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .maybeSingle()

      const admin = prof?.is_admin === true
      setIsAdmin(admin)

      const { from, to } = getDateRange()

      // 🔹 Abfrage für den Zeitraum
      let query = supabase
        .from('consumptions')
        .select(`
                    created_at,
                    quantity,
                    source,
                    unit_price_cents,
                    drinks!consumptions_drink_id_fkey(name),
                    profiles!consumptions_user_id_fkey(first_name,last_name)
                `)
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())

      if (!admin) query = query.eq('user_id', user.id)
      const { data, error } = await query

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      const rawData = data || []

      /* --- Statisik für Zeitraum --- */
      const totalQty = rawData.reduce((s, c) => s + (c.quantity || 0), 0)
      const uniqueDrinks = new Set(rawData.map(c => {
        const d = Array.isArray(c.drinks) ? c.drinks[0] : c.drinks
        return d?.name
      })).size
      setStats({ totalQty, distinctDrinks: uniqueDrinks })

      /* --- Chart Data (Täglich) --- */
      const chartMap: Record<string, number> = {}

      // Only fill zeros if range is small enough (<= 60 days) to keep chart readable
      const dayDiff = (to.getTime() - from.getTime()) / (1000 * 3600 * 24)
      if (dayDiff <= 60 && dayDiff >= 0) {
        for (let i = 0; i <= dayDiff; i++) {
          const d = new Date(from)
          d.setDate(d.getDate() + i)
          chartMap[d.toISOString().slice(0, 10)] = 0
        }
      }

      rawData.forEach(c => {
        const day = c.created_at.slice(0, 10)
        if (chartMap[day] === undefined) chartMap[day] = 0
        chartMap[day] += c.quantity || 0
      })

      const chartList = Object.entries(chartMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({
          date: new Date(date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
          count
        }))
      setChartData(chartList)


      /* --- Bestenliste (Zeitraum) --- */
      const rankingMap: Record<string, number> = {}
      rawData.forEach(c => {
        const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles
        const name = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim() || 'Unbekannt'
        rankingMap[name] = (rankingMap[name] || 0) + (c.quantity || 0)
      })
      const rankingList = Object.entries(rankingMap)
        .map(([user, qty]) => ({ user, qty }))
        .sort((a, b) => b.qty - a.qty)
      setRanking(rankingList)


      /* --- Feed / Gruppierung --- */
      const grouped: Record<string, any> = {}
      rawData.forEach(c => {
        const date = c.created_at.slice(0, 10)
        const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles
        const userName = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim() || 'Unbekannt'
        const drinkObj = Array.isArray(c.drinks) ? c.drinks[0] : c.drinks
        const drinkName = drinkObj?.name || 'Unbekannt'

        grouped[date] = grouped[date] || { drinks: {}, crates: [] }

        const isFree = c.unit_price_cents === 0 || c.source === 'free'
        const label = isFree ? `${drinkName} (Freibier)` : drinkName

        grouped[date].drinks[userName] = grouped[date].drinks[userName] || {}
        grouped[date].drinks[userName][label] = (grouped[date].drinks[userName][label] || 0) + (c.quantity || 0)

        if (c.source === 'crate' && (c.unit_price_cents ?? 0) > 0) {
          grouped[date].crates.push({ user: userName, drink: drinkName })
        }
      })
      setDailyGrouped(grouped)
      setLoading(false)
    }
    load()
  }, [filterMode, customRange])

  return (
    <div className="min-h-screen bg-neutral-950 text-white pb-20 pt-14">
      <TopNav />
      {isAdmin && <AdminNav />}
      <div className="max-w-6xl mx-auto p-4 sm:p-6 pt-6 space-y-8">

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">
            {isAdmin ? '📊 Gesamtaktivität' : '📅 Deine Aktivität'}
          </h1>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center gap-2 bg-gray-900/50 p-1.5 rounded-xl border border-gray-800">
            {(['7days', 'month', 'year', 'custom'] as const).map(m => (
              <button
                key={m}
                onClick={() => setFilterMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterMode === m ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-gray-200'
                  }`}
              >
                {m === '7days' ? '7 Tage' : m === 'month' ? 'Dieser Monat' : m === 'year' ? 'Dieses Jahr' : 'Individuell'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Range Inputs */}
        {filterMode === 'custom' && (
          <div className="flex items-center gap-4 bg-gray-900/50 p-4 rounded-xl border border-gray-800 animate-in fade-in slide-in-from-top-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase">Von</label>
              <input
                type="date"
                value={customRange.from}
                onChange={e => setCustomRange(p => ({ ...p, from: e.target.value }))}
                className="bg-gray-800 border-gray-700 rounded px-2 py-1 text-sm text-white focus:ring-green-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase">Bis</label>
              <input
                type="date"
                value={customRange.to}
                onChange={e => setCustomRange(p => ({ ...p, to: e.target.value }))}
                className="bg-gray-800 border-gray-700 rounded px-2 py-1 text-sm text-white focus:ring-green-500"
              />
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center">
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400 text-sm">Lade Daten...</p>
          </div>
        ) : (
          <>
            {/* --- Stats --- */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ActivityCard title="Getränke im Zeitraum" value={stats.totalQty.toString()} />
              <ActivityCard title="Versch. Getränke" value={stats.distinctDrinks.toString()} />
            </section>

            {/* --- Chart --- */}
            <section className="bg-gray-800/70 p-5 rounded-2xl border border-gray-700 shadow-sm">
              <h2 className="text-lg font-semibold mb-4">Verlauf</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="date" stroke="#666" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#666" tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#171717', border: '1px solid #333', borderRadius: '8px' }}
                      itemStyle={{ color: '#fff' }}
                      cursor={{ fill: '#ffffff10' }}
                    />
                    <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* --- Bestenliste --- */}
              <section className="lg:col-span-1 bg-gray-800/70 p-6 rounded-2xl border border-gray-700 shadow-sm h-fit">
                <h2 className="text-lg font-semibold mb-4">🏆 Top Trinker <span className="text-sm font-normal text-gray-400"></span></h2>
                <table className="w-full text-sm border-collapse">
                  <tbody>
                    {ranking.slice(0, 10).map((r, i) => (
                      <tr
                        key={r.user}
                        className={`border-b border-gray-800 last:border-0 ${i === 0 ? 'text-yellow-400 font-bold' : i === 1 ? 'text-gray-300 font-semibold' : i === 2 ? 'text-amber-700 font-semibold' : 'text-gray-400'
                          }`}
                      >
                        <td className="py-2.5 w-8">
                          {i + 1}.
                        </td>
                        <td className="py-2.5">{r.user}</td>
                        <td className="py-2.5 text-right">{r.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ranking.length === 0 && <p className="text-gray-500 text-sm">Keine Daten</p>}
              </section>

              {/* --- Tagesübersicht (Detail) --- */}
              <section className="lg:col-span-2 bg-gray-800/70 p-6 rounded-2xl border border-gray-700 shadow-sm">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                  📝 Historie <span className="text-sm font-normal text-gray-400">(Details für Zeitraum)</span>
                </h2>

                {Object.keys(dailyGrouped).length === 0 ? (
                  <p className="text-gray-400 text-sm text-center py-8">Keine Daten im ausgewählten Zeitraum.</p>
                ) : (
                  <div className="space-y-8">
                    {Object.entries(dailyGrouped)
                      .sort(([a], [b]) => b.localeCompare(a))
                      .map(([date, entry]) => {
                        const users = entry.drinks
                        const crates = entry.crates

                        // Calculate Daily Total
                        const dayTotal = Object.values(users).reduce((sum: number, drinks: any) => {
                          return sum + Object.values(drinks as Record<string, number>).reduce((s, n) => s + n, 0)
                        }, 0)

                        // Format Date
                        const dateObj = new Date(date)
                        const isToday = new Date().toDateString() === dateObj.toDateString()
                        const dateLabel = dateObj.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })

                        return (
                          <div key={date} className="relative">
                            {/* Day Header */}
                            <div className={`sticky top-16 z-10 py-2 px-4 rounded-lg border flex justify-between items-center mb-4 backdrop-blur-md
                                ${isToday ? 'bg-green-900/80 border-green-700 text-white' : 'bg-gray-800/90 border-gray-700 text-gray-200'}`}>
                              <span className="font-semibold">{dateLabel}</span>
                              <span className="text-xs bg-black/30 px-2 py-1 rounded">
                                {dayTotal} Getränke • {crates.length} Kiste(n)
                              </span>
                            </div>

                            <div className="space-y-3 pl-2 sm:pl-4">
                              {/* Kistenbereitstellungen first */}
                              {crates.map((c: { user: string; drink: string }, i: number) => (
                                <div key={'crate-' + i} className="flex items-center gap-4 p-3 rounded-xl bg-purple-900/20 border border-purple-800/50">
                                  <div className="w-10 h-10 rounded-full bg-purple-900/50 flex items-center justify-center text-xl">🎁</div>
                                  <div>
                                    <div className="font-semibold text-purple-200">{c.user}</div>
                                    <div className="text-sm text-purple-300">hat eine Kiste <b>{c.drink}</b> spendiert!</div>
                                  </div>
                                </div>
                              ))}

                              {/* User Consumption List */}
                              {Object.entries(users).map(([user, drinks]) => {
                                const drinkList = Object.entries(drinks as Record<string, number>)
                                return (
                                  <div key={user} className="flex items-start gap-4 p-3 rounded-xl bg-gray-900/40 border border-gray-800/50 hover:bg-gray-800/50 transition">
                                    {/* Avatar / Initial */}
                                    <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center font-bold text-gray-400 shrink-0">
                                      {user.charAt(0)}
                                    </div>

                                    <div className="flex-1">
                                      <div className="font-medium text-gray-200 mb-1">{user}</div>
                                      <div className="flex flex-wrap gap-2">
                                        {drinkList.map(([drink, qty]) => (
                                          <span key={drink} className={`text-xs px-2 py-1 rounded border 
                                                            ${drink.includes('Freibier')
                                              ? 'bg-emerald-900/30 border-emerald-800 text-emerald-400'
                                              : 'bg-gray-800 border-gray-700 text-gray-300'}`}>
                                            {qty}x {drink}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })
                    }
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* 🔹 Kleine Helferkarte */
function ActivityCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl p-4 text-center border shadow bg-gray-800/70 border-gray-700 text-white">
      <div className="text-sm text-gray-400">{title}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  )
}
