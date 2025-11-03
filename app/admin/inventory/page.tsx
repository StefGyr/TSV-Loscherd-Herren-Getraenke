'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { AnimatePresence, motion } from 'framer-motion'

type Drink = {
  id: number
  name: string
  price_cents: number
  ek_crate_price_cents: number | null
}

type Consumption = {
  id: number
  drink_id: number | null
  quantity: number
  unit_price_cents: number | null
  source: 'single' | 'crate' | string | null
  via_terminal?: boolean | null
  created_at: string
}

type Purchase = {
  id: number
  drink_id: number
  quantity: number
  crate_price_cents: number
  created_at: string
}

type Payment = {
  id: number
  user_id: string
  amount_cents: number
  method: 'bar' | 'paypal' | string
  verified: boolean
  created_at: string
  profiles?: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[]
}

type Profile = { id: string; open_balance_cents: number | null; first_name?: string | null; last_name?: string | null }

const BOTTLES_PER_CRATE = 20
const euro = (cents: number) => (cents / 100).toFixed(2) + ' €'
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const startOfWeek = () => { const d = startOfToday(); const day = d.getDay() || 7; d.setDate(d.getDate() - (day - 1)); return d }
const startOfMonth = () => { const d = startOfToday(); d.setDate(1); return d }

export default function InventoryRevenuePage() {
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [consumptions, setConsumptions] = useState<Consumption[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])
  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }

  const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'custom'>('month')
  const [from, setFrom] = useState<string>(() => startOfMonth().toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (rangePreset === 'custom') return
    if (rangePreset === 'today') {
      setFrom(startOfToday().toISOString().slice(0, 10))
      setTo(new Date().toISOString().slice(0, 10))
    } else if (rangePreset === 'week') {
      setFrom(startOfWeek().toISOString().slice(0, 10))
      setTo(new Date().toISOString().slice(0, 10))
    } else if (rangePreset === 'month') {
      setFrom(startOfMonth().toISOString().slice(0, 10))
      setTo(new Date().toISOString().slice(0, 10))
    }
  }, [rangePreset])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: drinksData }, { data: consData }, { data: purchData }, { data: payData }, { data: profData }] =
        await Promise.all([
          supabase.from('drinks').select('id,name,price_cents,ek_crate_price_cents'),
          supabase.from('consumptions').select('id,drink_id,quantity,unit_price_cents,source,via_terminal,created_at'),
          supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at'),
          supabase
            .from('payments')
            .select('id,user_id,amount_cents,method,verified,created_at,profiles(first_name,last_name)')
            .eq('verified', true),
          supabase.from('profiles').select('id,open_balance_cents,first_name,last_name'),
        ])

      setDrinks(drinksData || [])
      setConsumptions(consData || [])
      setPurchases(purchData || [])
      setPayments(payData || [])
      setProfiles(profData || [])
      setLoading(false)
    }
    load()
  }, [])

  const inRange = (iso: string) => {
    const d = new Date(iso)
    const fromD = new Date(from + 'T00:00:00')
    const toD = new Date(to + 'T23:59:59')
    return d >= fromD && d <= toD
  }

  const consInRange = useMemo(() => consumptions.filter((c) => inRange(c.created_at)), [consumptions, from, to])
  const purchInRange = useMemo(() => purchases.filter((p) => inRange(p.created_at)), [purchases, from, to])
  const paymentsInRange = useMemo(() => payments.filter((p) => inRange(p.created_at)), [payments, from, to])

  /** Einnahmen / Kosten / Gewinn */
  const totalPaymentsCents = useMemo(
    () => paymentsInRange.reduce((s, p) => s + (p.amount_cents || 0), 0),
    [paymentsInRange]
  )

  // 🔹 Freibier-Einnahmen exakt wie im Profil (App-Kisten)
  const freeBeerRevenueCents = useMemo(
    () =>
      consInRange
        .filter((c) => c.source === 'crate' && !c.via_terminal)
        .reduce((sum, c) => sum + (c.unit_price_cents || 0), 0),
    [consInRange]
  )

  const costCents = useMemo(
    () => purchInRange.reduce((s, p) => s + (p.crate_price_cents || 0), 0),
    [purchInRange]
  )

  const profitCents = useMemo(() => totalPaymentsCents - costCents, [totalPaymentsCents, costCents])

  const openPostenCents = useMemo(
    () => profiles.reduce((sum, p) => sum + (p.open_balance_cents || 0), 0),
    [profiles]
  )

  const inventory = useMemo(() => {
    const boughtByDrink = new Map<number, number>()
    purchases.forEach((p) => {
      const bottles = (p.quantity || 0) * BOTTLES_PER_CRATE
      boughtByDrink.set(p.drink_id, (boughtByDrink.get(p.drink_id) || 0) + bottles)
    })
    const soldByDrink = new Map<number, number>()
    consumptions.forEach((c) => {
      if (!c.drink_id) return
      soldByDrink.set(c.drink_id, (soldByDrink.get(c.drink_id) || 0) + (c.quantity || 0))
    })
    return drinks.map((d) => {
      const bought = boughtByDrink.get(d.id) || 0
      const sold = soldByDrink.get(d.id) || 0
      const current = bought - sold
      const ekBottle = d.ek_crate_price_cents != null ? d.ek_crate_price_cents / 100 / BOTTLES_PER_CRATE : null
      const vkBottle = d.price_cents / 100
      return {
        id: d.id,
        name: d.name,
        stock_bottles: current,
        sold_bottles_total: sold,
        ek_per_bottle: ekBottle,
        vk_per_bottle: vkBottle,
      }
    })
  }, [drinks, purchases, consumptions])

  if (loading) return <div className="p-6 text-center text-white">⏳ Lade Daten…</div>

  return (
    <>
      <TopNav />
      <AdminNav />
      <div className="pt-20 max-w-7xl mx-auto p-4 text-white space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <h1 className="text-2xl font-bold">📦 Bestand & 💶 Einnahmen</h1>
          <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-3 flex items-center gap-2">
            <select
              className="bg-gray-900 border border-gray-700 rounded p-2"
              value={rangePreset}
              onChange={(e) => setRangePreset(e.target.value as any)}
            >
              <option value="today">Heute</option>
              <option value="week">Diese Woche</option>
              <option value="month">Dieser Monat</option>
              <option value="custom">Benutzerdefiniert</option>
            </select>
            <input
              type="date"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              disabled={rangePreset !== 'custom'}
            />
            <span className="text-gray-400 text-sm">bis</span>
            <input
              type="date"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={rangePreset !== 'custom'}
            />
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat title="Gesamteinnahmen (verifiziert)" value={euro(totalPaymentsCents)} />
          <Stat title="Freibier-Einnahmen (App-Kisten)" value={euro(freeBeerRevenueCents)} />
          <Stat title="Kosten (EK)" value={euro(costCents)} />
          <Stat title="Gewinn" value={euro(profitCents)} />
          <Stat title="Offene Posten" value={euro(openPostenCents)} />
        </div>

        {/* Inventory Table */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow">
          <h2 className="text-lg font-semibold mb-2">Getränkebestand (Flaschen)</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-2 text-left">Getränk</th>
                <th className="p-2 text-right">Bestand</th>
                <th className="p-2 text-right">Verkauft</th>
                <th className="p-2 text-right">EK/Kiste</th>
                <th className="p-2 text-right">EK/Flasche</th>
                <th className="p-2 text-right">VK/Flasche</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((d) => (
                <tr key={d.id} className="border-t border-gray-700">
                  <td className="p-2">{d.name}</td>
                  <td className="p-2 text-right">{d.stock_bottles}</td>
                  <td className="p-2 text-right">{d.sold_bottles_total}</td>
                  <td className="p-2 text-right">{(drinks.find((x) => x.id === d.id)?.ek_crate_price_cents || 0) / 100}</td>
                  <td className="p-2 text-right">{d.ek_per_bottle?.toFixed(2)}</td>
                  <td className="p-2 text-right">{d.vk_per_bottle.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Payments */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">💳 Verifizierte Zahlungen</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-2 text-left">Datum</th>
                <th className="p-2 text-left">Nutzer</th>
                <th className="p-2 text-left">Methode</th>
                <th className="p-2 text-right">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {paymentsInRange.length === 0 ? (
                <tr><td colSpan={4} className="p-2 text-gray-400">Keine verifizierten Zahlungen.</td></tr>
              ) : (
                paymentsInRange.map((p) => {
                  const prof = Array.isArray(p.profiles) ? p.profiles[0] : p.profiles
                  const userName = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim() || 'Unbekannt'
                  return (
                    <tr key={p.id} className="border-t border-gray-700">
                      <td className="p-2">{new Date(p.created_at).toLocaleString('de-DE')}</td>
                      <td className="p-2">{userName}</td>
                      <td className="p-2">{p.method === 'paypal' ? 'PayPal' : 'Bar'}</td>
                      <td className="p-2 text-right">{euro(p.amount_cents)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </section>

        {/* Freibier Kisten */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-2">
          <h2 className="text-lg font-semibold">🎁 Bereitgestellte Kisten (App-Freibier)</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="p-2 text-left">Datum</th>
                <th className="p-2 text-left">Getränk</th>
                <th className="p-2 text-right">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {consInRange.filter((c) => c.source === 'crate' && !c.via_terminal).length === 0 ? (
                <tr><td colSpan={3} className="p-2 text-gray-400">Keine bereitgestellten Kisten im Zeitraum.</td></tr>
              ) : (
                consInRange
                  .filter((c) => c.source === 'crate' && !c.via_terminal)
                  .map((c) => {
                    const drink = drinks.find((d) => d.id === c.drink_id)
                    return (
                      <tr key={c.id} className="border-t border-gray-700">
                        <td className="p-2">{new Date(c.created_at).toLocaleString('de-DE')}</td>
                        <td className="p-2">{drink?.name || 'Unbekannt'}</td>
                        <td className="p-2 text-right">{euro(c.unit_price_cents || 0)}</td>
                      </tr>
                    )
                  })
              )}
            </tbody>
          </table>
        </section>

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

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-center shadow">
      <div className="text-gray-400 text-xs">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  )
}
