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

type DailyStat = {
  date: string
  count: number
}

export default function ActivityPage() {
  const [todayCount, setTodayCount] = useState(0)
  const [todayDrinks, setTodayDrinks] = useState<{ name: string; qty: number }[]>([])
  const [weekData, setWeekData] = useState<DailyStat[]>([])
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)

      // 🧑‍💻 Aktuellen Nutzer prüfen
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) return

      // 👑 Admin-Status prüfen
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

      // 🔹 Basisabfrage (letzte 7 Tage)
      let query = supabase
        .from('consumptions')
        .select('created_at, quantity, drinks(name), profiles(first_name,last_name)')
        .gte('created_at', startOfWeek.toISOString())

      // Wenn kein Admin → nur eigene Buchungen anzeigen
      if (!admin) {
        query = query.eq('user_id', user.id)
      }

      const { data, error } = await query

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      // 📅 Heute
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

      // 📆 Wöchentliche Summen
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

      // 🧾 Letzte Verbuchungen (10)
      let lastQuery = supabase
        .from('consumptions')
        .select('created_at, quantity, drinks(name), profiles(first_name,last_name)')
        .order('created_at', { ascending: false })
        .limit(10)

      if (!admin) {
        lastQuery = lastQuery.eq('user_id', user.id)
      }

      const { data: last } = await lastQuery

      setTodayCount(todaySum)
      setTodayDrinks(todayDrinksList)
      setWeekData(weekStats)
      setRecent(last || [])
      setLoading(false)
    }

    load()
  }, [])

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <TopNav />
      <AdminNav />

      <div className="max-w-6xl mx-auto p-6 pt-10 space-y-10">
        <h1 className="text-2xl font-bold">
          {isAdmin ? '📊 Gesamtaktivität (Admin)' : '📅 Deine Aktivität'}
        </h1>

        {loading ? (
          <p className="text-gray-400 text-sm">⏳ Lade Aktivitätsdaten...</p>
        ) : (
          <>
            {/* 🔹 Tagesübersicht */}
            <section className="bg-gray-800/70 p-5 rounded border border-gray-700 shadow">
              <h2 className="text-lg font-semibold mb-3">Heute</h2>
              {todayCount > 0 ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <ActivityCard title="Verbuchungen heute" value={todayCount.toString()} />
                    <ActivityCard
                      title="Unterschiedliche Getränke"
                      value={todayDrinks.length.toString()}
                    />
                  </div>
                  <h3 className="text-sm text-gray-300 mb-2">Meist verbuchte Getränke:</h3>
                  <ul className="space-y-1 text-sm">
                    {todayDrinks.map((d, i) => (
                      <li
                        key={i}
                        className="flex justify-between border-b border-gray-800 py-1"
                      >
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

            {/* 🔹 Wochenübersicht */}
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
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                {weekData.map((d) => (
                  <ActivityCard
                    key={d.date}
                    title={d.date}
                    value={`${d.count} Buchungen`}
                    danger={d.count === 0}
                  />
                ))}
              </div>
            </section>

            {/* 🔹 Letzte Verbuchungen */}
            <section className="bg-gray-800/70 p-5 rounded border border-gray-700 shadow">
              <h2 className="text-lg font-semibold mb-3">
                🧾 Letzte Verbuchungen {isAdmin ? '(alle Nutzer)' : '(deine)'}
              </h2>
              {recent.length === 0 ? (
                <p className="text-gray-400 text-sm">Keine Buchungen gefunden.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-gray-400 border-b border-gray-700">
                      <th className="text-left py-2">Nutzer</th>
                      <th className="text-left py-2">Getränk</th>
                      <th className="text-right py-2">Menge</th>
                      <th className="text-right py-2">Datum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r, i) => (
                      <tr key={i} className="border-t border-gray-700">
                        <td className="py-1">
                          {r.profiles?.first_name} {r.profiles?.last_name}
                        </td>
                        <td className="py-1">{r.drinks?.[0]?.name || '—'}</td>
                        <td className="py-1 text-right text-green-400 font-semibold">
                          {r.quantity}x
                        </td>
                        <td className="py-1 text-right text-gray-400">
                          {new Date(r.created_at).toLocaleString('de-DE', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

/* 🔹 Kleine Helferkarte */
function ActivityCard({
  title,
  value,
  danger,
}: {
  title: string
  value: string
  danger?: boolean
}) {
  return (
    <div
      className={`rounded-xl p-4 text-center border shadow ${
        danger
          ? 'bg-red-900/50 border-red-700 text-red-200'
          : 'bg-gray-800/70 border-gray-700 text-white'
      }`}
    >
      <div className="text-sm text-gray-400">{title}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  )
}
