'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'

// drinks kann Objekt ODER Array sein – beides unterstützen
type DrinkObj = { name?: string } | null
type Purchase = {
  id: number
  created_at: string
  quantity: number
  crate_price_cents: number
  // Supabase kann hier {name} ODER [{name}] liefern
  drinks: DrinkObj | DrinkObj[]
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'month' | 'week'>('all')
  const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  useEffect(() => {
    loadPurchases()
  }, [])

  const loadPurchases = async () => {
    setLoading(true)

    // ⚠️ WICHTIG: Nutze den FK-Join. Falls dein FK anders heißt,
    // ersetze 'purchases_drink_id_fkey' durch den exakten Namen aus Supabase > Relationships.
    const { data, error } = await supabase
      .from('purchases')
      .select(`
        id,
        created_at,
        quantity,
        crate_price_cents,
        drinks!purchases_drink_id_fkey(name)
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      addToast('Fehler beim Laden', 'error')
    } else {
      setPurchases((data || []) as Purchase[])
    }
    setLoading(false)
  }

  // 🔹 Hilfsfunktion: holt den Namen robust aus Objekt ODER Array
  const getDrinkName = (drinks: Purchase['drinks']) => {
    if (!drinks) return '-'
    if (Array.isArray(drinks)) return drinks[0]?.name || '-'
    return drinks?.name || '-'
  }

  // 🔹 Filterlogik
  const filtered = purchases.filter((p) => {
    const date = new Date(p.created_at)
    const now = new Date()
    if (filter === 'week') {
      const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays <= 7
    } else if (filter === 'month') {
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
    }
    return true
  })

  const totalCost = filtered.reduce((sum, p) => sum + p.quantity * p.crate_price_cents, 0)
  const totalCrates = filtered.reduce((sum, p) => sum + p.quantity, 0)

  if (loading) return <div className="p-6 text-center text-white">⏳ Lade Einkäufe...</div>

  return (
    <>
      <TopNav />
      <AdminNav />
      <div className="pt-20 max-w-6xl mx-auto p-4 text-white space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">🧾 Kistenhistorie</h1>
          <Link href="/admin/inventory" className="bg-green-700 hover:bg-green-800 px-3 py-1 rounded text-sm">
            📦 Zur Bestandsübersicht
          </Link>
        </div>

        {/* Filter */}
        <div className="flex gap-3">
          {[
            { key: 'all', label: 'Alle' },
            { key: 'month', label: 'Diesen Monat' },
            { key: 'week', label: 'Diese Woche' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${
                filter === f.key
                  ? 'bg-green-700 border-green-600'
                  : 'bg-gray-800/70 border-gray-700 hover:bg-gray-700'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Statistiken */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Gesamtkosten" value={(totalCost / 100).toFixed(2) + ' €'} />
          <StatCard title="Kisten" value={totalCrates.toString()} />
          <StatCard
            title="Ø Preis/Kiste"
            value={totalCrates ? ((totalCost / 100) / totalCrates).toFixed(2) + ' €' : '-'}
          />
          <StatCard
            title="Zeitraum"
            value={filter === 'all' ? 'Gesamt' : filter === 'month' ? 'Monat' : 'Woche'}
          />
        </div>

        {/* Tabelle */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Einkäufe</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-2 text-left">Datum</th>
                <th className="p-2 text-left">Getränk</th>
                <th className="p-2 text-right">Kisten</th>
                <th className="p-2 text-right">EK / Kiste (€)</th>
                <th className="p-2 text-right">Gesamt (€)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-gray-700">
                  <td className="p-2">{new Date(p.created_at).toLocaleDateString('de-DE')}</td>
                  <td className="p-2">{getDrinkName(p.drinks)}</td>
                  <td className="p-2 text-right">{p.quantity}</td>
                  <td className="p-2 text-right">{(p.crate_price_cents / 100).toFixed(2)}</td>
                  <td className="p-2 text-right">
                    {((p.quantity * p.crate_price_cents) / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-4">
                    Keine Einkäufe im gewählten Zeitraum
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Toasts */}
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-lg ${
                t.type === 'error' ? 'bg-red-700' : 'bg-green-700'
              }`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
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
