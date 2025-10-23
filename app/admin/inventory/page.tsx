'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'

type Drink = {
  id: number
  name: string
  price_cents: number
  crate_price_cents: number
  ek_crate_price_cents: number | null
}

type Purchase = {
  id: number
  drink_id: number
  quantity: number
  crate_price_cents: number
}

export default function InventoryPage() {
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [consumptions, setConsumptions] = useState<any[]>([])
  const [profiles, setProfiles] = useState<any[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [newPurchase, setNewPurchase] = useState({
    drink_id: '',
    quantity: 1,
    crate_price_cents: '',
  })
  const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      const [{ data: drinksData }, { data: consData }, { data: profilesData }, { data: purchData }] =
        await Promise.all([
          supabase.from('drinks').select('*'),
          supabase.from('consumptions').select('*'),
          supabase.from('profiles').select('*'),
          supabase.from('purchases').select('*'),
        ])

      setDrinks(drinksData || [])
      setConsumptions(consData || [])
      setProfiles(profilesData || [])
      setPurchases(purchData || [])
      setLoading(false)
    }
    loadData()
  }, [])

  const stats = useMemo(() => {
    const BOTTLES_PER_CRATE = 20
    const revenue = consumptions.reduce((sum, c) => sum + (c.unit_price_cents || 0) * (c.quantity || 0), 0)
    const cost = purchases.reduce((sum, p) => sum + (p.crate_price_cents || 0) * (p.quantity || 0), 0)
    const openBalances = profiles.reduce((sum, p) => sum + (p.open_balance_cents || 0), 0)
    const profit = revenue - cost

    const inventory = drinks.map((drink) => {
      const bought = purchases
        .filter((p) => p.drink_id === drink.id)
        .reduce((sum, p) => sum + p.quantity * BOTTLES_PER_CRATE, 0)
      const sold = consumptions.filter((c) => c.drink_id === drink.id).reduce((sum, c) => sum + c.quantity, 0)
      const currentStock = bought - sold
      return { ...drink, bought, sold, currentStock }
    })

    return { revenue, cost, profit, openBalances, inventory }
  }, [drinks, consumptions, profiles, purchases])

  const addPurchase = async () => {
    if (!newPurchase.drink_id || !newPurchase.crate_price_cents) return
    const { error } = await supabase.from('purchases').insert({
      drink_id: Number(newPurchase.drink_id),
      quantity: Number(newPurchase.quantity),
      crate_price_cents: Number(newPurchase.crate_price_cents) * 100,
    })

    if (error) addToast('Fehler beim Speichern', 'error')
    else {
      addToast('Einkauf gespeichert')
      setNewPurchase({ drink_id: '', quantity: 1, crate_price_cents: '' })
      const { data } = await supabase.from('purchases').select('*')
      setPurchases(data || [])
    }
  }

  const updateEK = async (drinkId: number, value: number) => {
    const { error } = await supabase
      .from('drinks')
      .update({ ek_crate_price_cents: Math.round(value * 100) })
      .eq('id', drinkId)
    if (error) addToast('Fehler beim Speichern', 'error')
    else addToast('Einkaufspreis aktualisiert')
  }

  if (loading) return <div className="p-6 text-center text-white">⏳ Lade Daten...</div>

  return (
    <>
      <TopNav />
      <AdminNav />
      <div className="pt-20 max-w-6xl mx-auto p-4 text-white space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">📦 Bestand & Einnahmen</h1>
          <Link href="/admin/purchases" className="bg-blue-700 hover:bg-blue-800 px-3 py-1 rounded text-sm">
            🧾 Kistenhistorie ansehen
          </Link>
        </div>

        {/* Kennzahlen */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Einnahmen" value={(stats.revenue / 100).toFixed(2) + ' €'} />
          <StatCard title="Kosten" value={(stats.cost / 100).toFixed(2) + ' €'} />
          <StatCard title="Gewinn" value={(stats.profit / 100).toFixed(2) + ' €'} />
          <StatCard title="Offene Posten" value={(stats.openBalances / 100).toFixed(2) + ' €'} />
        </div>

        {/* Tabelle */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-4">
          <h2 className="text-lg font-semibold">Getränkebestand</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-2 text-left">Getränk</th>
                <th className="p-2 text-right">Bestand lt. System</th>
                <th className="p-2 text-right">Verkauft</th>
                <th className="p-2 text-right">EK / Kiste (€)</th>
                <th className="p-2 text-right">VK / Flasche (€)</th>
              </tr>
            </thead>
            <tbody>
              {stats.inventory.map((d) => (
                <tr key={d.id} className="border-t border-gray-700">
                  <td className="p-2">{d.name}</td>
                  <td className="p-2 text-right">{d.currentStock}</td>
                  <td className="p-2 text-right">{d.sold}</td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      defaultValue={d.ek_crate_price_cents ? d.ek_crate_price_cents / 100 : ''}
                      onBlur={(e) => updateEK(d.id, parseFloat(e.target.value))}
                      className="bg-gray-900 border border-gray-700 rounded text-right w-24 p-1"
                    />
                  </td>
                  <td className="p-2 text-right">{(d.price_cents / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Neue Kisten hinzufügen */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Neue Kisten hinzufügen</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              className="bg-gray-900 border border-gray-700 rounded p-2"
              value={newPurchase.drink_id}
              onChange={(e) => setNewPurchase((p) => ({ ...p, drink_id: e.target.value }))}
            >
              <option value="">Getränk wählen...</option>
              {drinks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <input
              type="number"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="Anzahl Kisten"
              value={newPurchase.quantity}
              onChange={(e) => setNewPurchase((p) => ({ ...p, quantity: parseInt(e.target.value) }))}
            />

            <input
              type="number"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="Einkaufspreis pro Kiste (€)"
              value={newPurchase.crate_price_cents}
              onChange={(e) => setNewPurchase((p) => ({ ...p, crate_price_cents: e.target.value }))}
            />

            <button
              onClick={addPurchase}
              className="bg-green-700 hover:bg-green-800 rounded p-2 font-medium"
            >
              Speichern
            </button>
          </div>
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
