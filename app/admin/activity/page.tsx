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
  const [todayCount, setTodayCount] = useState(0)
  const [todayDrinks, setTodayDrinks] = useState<{ name: string; qty: number }[]>([])
  const [weekData, setWeekData] = useState<DailyStat[]>([])
  const [dailyGrouped, setDailyGrouped] = useState<Record<string, any>>({})
  const [ranking, setRanking] = useState<{ user: string; qty: number }[]>([])
  const [rankingMode, setRankingMode] = useState<'7days' | 'all'>('7days')
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

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

      const now = new Date()
      const startOfWeek = new Date()
      startOfWeek.setDate(now.getDate() - 6)

      // 🧩 Hauptabfrage (letzte 7 Tage)
      let query = supabase
        .from('consumptions')
        .select(`
          created_at,
          quantity,
          drinks(name),
          profiles!consumptions_user_id_fkey(first_name,last_name)
        `)
        .gte('created_at', startOfWeek.toISOString())

      if (!admin) query = query.eq('user_id', user.id)
      const { data, error } = await query
      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      /* --- Tagesstatistik --- */
      const todayStr = now.toISOString().slice(0, 10)
      const today = (data || []).filter((c) => c.created_at.startsWith(todayStr))
      const todaySum = today.reduce((s, c) => s + (c.quantity || 0), 0)
      const drinkMap: Record<string, number> = {}
      today.forEach((c) => {
        const n = c.drinks?.[0]?.name || 'Unbekannt'
        drinkMap[n] = (drinkMap[n] || 0) + c.quantity
      })
      const todayDrinksList = Object.entries(drinkMap)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)

      /* --- Wochenstatistik --- */
      const weekMap: Record<string, number> = {}
      for (let i = 0; i < 7; i++) {
        const d = new Date(now)
        d.setDate(now.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        weekMap[key] = 0
      }
      for (const c of data || []) {
        const key = c.created_at.slice(0, 10)
        if (weekMap[key] !== undefined) weekMap[key] += c.quantity || 0
      }
      const weekStats = Object.entries(weekMap)
        .map(([date, count]) => ({
          date: new Date(date).toLocaleDateString('de-DE', { weekday: 'short' }),
          count,
        }))
        .reverse()

      /* --- Gruppierung pro Tag --- */
      const grouped: Record<string, Record<string, Record<string, number>>> = {}
      for (const c of data || []) {
        const date = c.created_at.slice(0, 10)
        const userName = `${c.profiles?.[0]?.first_name || ''} ${c.profiles?.[0]?.last_name || ''}`.trim() || 'Unbekannt'
        const drink = c.drinks?.[0]?.name || 'Unbekannt'
        grouped[date] = grouped[date] || {}
        grouped[date][userName] = grouped[date][userName] || {}
        grouped[date][userName][drink] = (grouped[date][userName][drink] || 0) + (c.quantity || 0)
      }

      /* --- Bestenliste --- */
      const fullQuery = supabase
        .from('consumptions')
        .select(`
          quantity,
          profiles!consumptions_user_id_fkey(first_name,last_name)
        `)

      const { data: allData } = await fullQuery
      const filtered = rankingMode === '7days' ? data || [] : allData || []
      const totals: Record<string, number> = {}
      filtered.forEach((c) => {
        const name = `${c.profiles?.[0]?.first_name || ''} ${c.profiles?.[0]?.last_name || ''}`.trim() || 'Unbekannt'
        totals[name] = (totals[name] || 0) + (c.quantity || 0)
      })
      const rankingList = Object.entries(totals)
        .map(([user, qty]) => ({ user, qty }))
        .sort((a, b) => b.qty - a.qty)

      setTodayCount(todaySum)
      setTodayDrinks(todayDrinksList)
      setWeekData(weekStats)
      setDailyGrouped(grouped)
      setRanking(rankingList)
      setLoading(false)
    }

    load()
  }, [rankingMode])

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <TopNav />
      <AdminNav />
      <div className="max-w-6xl mx-auto p-6 pt-10 space-y-10">
        <h1 className="text-2xl font-bold">
          {isAdmin ? '🍻 Gesamtaktivität (Admin)' : '📅 Deine Aktivität'}
        </h1>

        {loading ? (
          <p className="text-gray-400 text-sm">⏳ Lade Aktivitätsdaten...</p>
        ) : (
          <>
            {/* --- Tagesübersicht --- */}
            <section className="bg-gray-800/70 p-5 rounded border border-gray-700 shadow">
              <h2 className="text-lg font-semibold mb-3">Heute</h2>
              {todayCount > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <ActivityCard title="Verbuchungen heute" value={todayCount.toString()} />
                    <ActivityCard title="Unterschiedliche Getränke" value={todayDrinks.length.toString()} />
                  </div>
                  <ul className="space-y-1 text-sm">
                    {todayDrinks.map((d, i) => (
                      <li key={i} className="flex justify-between border-b border-gray-800 py-1">
                        <span>{d.name}</span>
                        <span className="text-green-400 font-semibold">{d.qty}x</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="text-center text-red-400 font-semibold py-10 text-lg">
                  ❌ Keine Verbuchungen heute!
                </div>
              )}
            </section>

            {/* --- Wochenübersicht --- */}
            <section className="bg-gray-800/70 p-5 rounded border border-gray-700 shadow">
              <h2 className="text-lg font-semibold mb-3">Letzte 7 Tage</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#444" />
                    <XAxis dataKey="date" stroke="#aaa" />
                    <YAxis stroke="#aaa" />
                    <Tooltip />
                    <Bar dataKey="count" fill="#22c55e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* --- Bestenliste --- */}
            <section className="bg-gray-800/70 p-5 rounded border border-gray-700 shadow">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold">🏆 Bestenliste</h2>
                <div className="flex gap-2">
                  {['7days', 'all'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setRankingMode(m as '7days' | 'all')}
                      className={`px-3 py-1 rounded text-sm ${
                        rankingMode === m
                          ? 'bg-green-700 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                      }`}
                    >
                      {m === '7days' ? 'Letzte 7 Tage' : 'Gesamt'}
                    </button>
                  ))}
                </div>
              </div>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2">Platz</th>
                    <th className="text-left py-2">Name</th>
                    <th className="text-right py-2">Getränke</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => (
                    <tr
                      key={r.user}
                      className={`border-t border-gray-800 ${
                        i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : ''
                      }`}
                    >
                      <td className="py-1">
                        {i + 1 === 1 ? '🥇' : i + 1 === 2 ? '🥈' : i + 1 === 3 ? '🥉' : i + 1}
                      </td>
                      <td className="py-1">{r.user}</td>
                      <td className="py-1 text-right font-semibold">{r.qty}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            {/* --- Tagesübersicht (Detail) --- */}
            <section className="bg-gray-800/70 p-5 rounded border border-gray-700 shadow">
              <h2 className="text-lg font-semibold mb-3">📅 Tagesübersicht (wer was getrunken hat)</h2>
              {Object.keys(dailyGrouped).length === 0 ? (
                <p className="text-gray-400 text-sm">Keine Daten gefunden.</p>
              ) : (
                Object.entries(dailyGrouped)
                  .sort(([a], [b]) => b.localeCompare(a))
                  .map(([date, users]) => {
                    const dayTotal = Object.values(users).reduce((sum: number, drinks: any) => {
                      const drinkSum = Object.values(drinks as Record<string, number>).reduce(
                        (s, n) => s + n,
                        0
                      )
                      return sum + drinkSum
                    }, 0)
                    return (
                      <div key={date} className="mb-6">
                        <h3 className="text-green-400 font-semibold mb-2">
                          {new Date(date).toLocaleDateString('de-DE', {
                            weekday: 'long',
                            day: '2-digit',
                            month: '2-digit',
                          })}{' '}
                          • <span className="text-gray-300 text-sm">Gesamt: {dayTotal} Getränke</span>
                        </h3>
                        <table className="w-full text-sm border-collapse mb-2">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-700">
                              <th className="text-left py-2">Nutzer</th>
                              <th className="text-left py-2">Getränk</th>
                              <th className="text-right py-2">Menge</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(users).map(([user, drinks]) =>
                              Object.entries(drinks as Record<string, number>).map(([drink, qty]) => (
                                <tr key={user + drink} className="border-t border-gray-800">
                                  <td className="py-1">{user}</td>
                                  <td className="py-1">{drink}</td>
                                  <td className="py-1 text-right text-green-400 font-semibold">{qty}x</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    )
                  })
              )}
            </section>
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
