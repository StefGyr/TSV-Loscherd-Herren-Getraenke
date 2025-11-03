'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { AnimatePresence, motion } from 'framer-motion'

/* ================= Types ================= */
type Drink = {
  id: number
  name: string
  price_cents: number
  ek_crate_price_cents: number | null
}

type Consumption = {
  id: number
  user_id: string | null
  drink_id: number | null
  quantity: number
  unit_price_cents: number | null
  source: 'single' | 'crate' | string | null
  via_terminal?: boolean | null
  created_at: string
  profiles?: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[]
  drinks?: { name: string } | { name: string }[]
}

type Purchase = {
  id: number
  drink_id: number
  quantity: number // ⚠️ wird für Flaschenzugänge als bottles/20 gespeichert (Dezimal erlaubt)
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

type Profile = { id: string; open_balance_cents: number | null }

const BOTTLES_PER_CRATE = 20
const euro = (cents: number) => (cents / 100).toFixed(2) + ' €'
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
const startOfWeek = () => { const d = startOfToday(); const day = d.getDay() || 7; d.setDate(d.getDate() - (day - 1)); return d }
const startOfMonth = () => { const d = startOfToday(); d.setDate(1); return d }

/* ================= Page ================= */
export default function InventoryRevenuePage() {
  /* ---- State ---- */
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [consumptions, setConsumptions] = useState<Consumption[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])
  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3200)
  }

  /* ---- Filter ---- */
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

  /* ---- Load ---- */
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [
        { data: drinksData },
        { data: consData },
        { data: purchData },
        { data: payData },
        { data: profData },
      ] = await Promise.all([
        supabase.from('drinks').select('id,name,price_cents,ek_crate_price_cents'),
        // ⬇️ Konsumtionen inkl. Join auf profiles & drinks (für Namen/Bereitsteller)
        supabase
          .from('consumptions')
          .select(`
            id,user_id,drink_id,quantity,unit_price_cents,source,via_terminal,created_at,
            profiles!consumptions_user_id_fkey(first_name,last_name),
            drinks!consumptions_drink_id_fkey(name)
          `)
          .order('created_at', { ascending: true }),
        supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at').order('created_at', { ascending: true }),
        supabase
          .from('payments')
          .select('id,user_id,amount_cents,method,verified,created_at,profiles(first_name,last_name)')
          .eq('verified', true)
          .order('created_at', { ascending: true }),
        supabase.from('profiles').select('id,open_balance_cents'),
      ])

      setDrinks(drinksData || [])
      setConsumptions((consData as any[]) || [])
      setPurchases(purchData || [])
      setPayments(payData || [])
      setProfiles(profData || [])
      setLoading(false)
    }
    load()
  }, [])

  /* ---- Helpers ---- */
  const inRange = (iso: string) => {
    const d = new Date(iso)
    const fromD = new Date(from + 'T00:00:00')
    const toD = new Date(to + 'T23:59:59')
    return d >= fromD && d <= toD
  }

  const consInRange = useMemo(() => consumptions.filter((c) => inRange(c.created_at)), [consumptions, from, to])
  const purchInRange = useMemo(() => purchases.filter((p) => inRange(p.created_at)), [purchases, from, to])
  const paymentsInRange = useMemo(() => payments.filter((p) => inRange(p.created_at)), [payments, from, to])

  /* ================= KPIs ================= */
  // Einnahmen = verifizierte Zahlungen
  const totalPaymentsCents = useMemo(
    () => paymentsInRange.reduce((s, p) => s + (p.amount_cents || 0), 0),
    [paymentsInRange]
  )

  // Freibier-Einnahmen (exakt wie im Profil): App-Kisten → source='crate' && !via_terminal; Summe = unit_price_cents
  const freeBeerAppCents = useMemo(
    () =>
      consInRange
        .filter((c) => c.source === 'crate' && !c.via_terminal)
        .reduce((sum, c) => sum + (c.unit_price_cents || 0), 0),
    [consInRange]
  )

  // Einkaufskosten
  const costCents = useMemo(
    () => purchInRange.reduce((s, p) => s + (p.crate_price_cents || 0), 0),
    [purchInRange]
  )

  // Gewinn (vereinfacht): verifizierte Zahlungen – EK
  const profitCents = useMemo(() => totalPaymentsCents - costCents, [totalPaymentsCents, costCents])

  // Offene Posten
  const openPostenCents = useMemo(
    () => profiles.reduce((sum, p) => sum + (p.open_balance_cents || 0), 0),
    [profiles]
  )

  /* ================= Inventory (Flaschen) ================= */
  const inventory = useMemo(() => {
    const boughtBottles = new Map<number, number>()
    purchases.forEach((p) => {
      const bottles = (p.quantity || 0) * BOTTLES_PER_CRATE
      boughtBottles.set(p.drink_id, (boughtBottles.get(p.drink_id) || 0) + bottles)
    })
    const soldBottles = new Map<number, number>()
    consumptions.forEach((c) => {
      if (!c.drink_id) return
      soldBottles.set(c.drink_id, (soldBottles.get(c.drink_id) || 0) + (c.quantity || 0))
    })

    return drinks.map((d) => {
      const bought = boughtBottles.get(d.id) || 0
      const sold = soldBottles.get(d.id) || 0
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

  /* ================= Actions: Zugang & Korrektur & EK ================= */
  const [purchaseForm, setPurchaseForm] = useState<{ drink_id: string; bottles: string; total_price_eur: string }>({
    drink_id: '',
    bottles: '',
    total_price_eur: '',
  })

  const saveBottlePurchase = async () => {
    const drink_id = Number(purchaseForm.drink_id)
    const bottles = Number(purchaseForm.bottles)
    const totalPriceCents = Math.round(Number(purchaseForm.total_price_eur) * 100)
    if (!drink_id || !bottles || !totalPriceCents) {
      addToast('Bitte Getränk, Flaschenanzahl und Gesamt-EK angeben', 'error')
      return
    }
    const crateQty = bottles / BOTTLES_PER_CRATE // Dezimalwerte erlaubt
    const { error } = await supabase.from('purchases').insert({
      drink_id,
      quantity: crateQty,
      crate_price_cents: totalPriceCents,
    })
    if (error) return addToast('Speichern fehlgeschlagen (prüfe Datentyp von purchases.quantity)', 'error')
    addToast('Einkauf (Flaschen) gespeichert')
    setPurchaseForm({ drink_id: '', bottles: '', total_price_eur: '' })
    const { data } = await supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at')
    setPurchases(data || [])
  }

  const [adjustForm, setAdjustForm] = useState<{ drink_id: string; delta_bottles: string; note: string }>({
    drink_id: '',
    delta_bottles: '',
    note: '',
  })

  const applyStockAdjustment = async () => {
    const drink_id = Number(adjustForm.drink_id)
    const delta = Number(adjustForm.delta_bottles)
    if (!drink_id || !delta) return addToast('Bitte Getränk und Delta (± Flaschen) angeben', 'error')
    const crateQty = delta / BOTTLES_PER_CRATE
    const { error } = await supabase.from('purchases').insert({
      drink_id,
      quantity: crateQty,
      crate_price_cents: 0, // Korrektur ohne EK
    })
    if (error) return addToast('Bestandskorrektur fehlgeschlagen', 'error')
    addToast('Bestand angepasst')
    setAdjustForm({ drink_id: '', delta_bottles: '', note: '' })
    const { data } = await supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at')
    setPurchases(data || [])
  }

  const updateEKCrate = async (drinkId: number, eur: number) => {
    if (!eur || eur <= 0) return
    const { error } = await supabase.from('drinks').update({ ek_crate_price_cents: Math.round(eur * 100) }).eq('id', drinkId)
    if (error) addToast('EK/Kiste Speichern fehlgeschlagen', 'error')
    else addToast('EK/Kiste aktualisiert')
  }

  /* ================= UI ================= */
  if (loading) return <div className="p-6 text-center text-white">⏳ Lade Daten…</div>

  return (
    <>
      <TopNav />
      <AdminNav />

      <div className="pt-20 max-w-7xl mx-auto p-4 text-white space-y-8">

        {/* Header + Filter */}
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
          <Stat title="Freibier-Einnahmen (App-Kisten)" value={euro(freeBeerAppCents)} />
          <Stat title="Kosten (EK)" value={euro(costCents)} />
          <Stat title="Gewinn" value={euro(profitCents)} />
          <Stat title="Offene Posten" value={euro(openPostenCents)} />
        </div>

        {/* Bestandstabelle */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-4">
          <h2 className="text-lg font-semibold">Getränkebestand (Flaschen)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Getränk</th>
                  <th className="p-2 text-right">Bestand</th>
                  <th className="p-2 text-right">Verkauft (gesamt)</th>
                  <th className="p-2 text-right">EK/Kiste (€)</th>
                  <th className="p-2 text-right">EK/Flasche (€)</th>
                  <th className="p-2 text-right">VK/Flasche (€)</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((row) => {
                  const drink = drinks.find((d) => d.id === row.id)
                  const ekCrate = drink?.ek_crate_price_cents != null ? (drink.ek_crate_price_cents / 100).toFixed(2) : ''
                  const ekBottle = row.ek_per_bottle != null ? row.ek_per_bottle.toFixed(2) : ''
                  return (
                    <tr key={row.id} className="border-t border-gray-700">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2 text-right">{row.stock_bottles}</td>
                      <td className="p-2 text-right">{row.sold_bottles_total}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={ekCrate}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value || '0')
                            if (v > 0) updateEKCrate(row.id, v)
                          }}
                          className="bg-gray-900 border border-gray-700 rounded text-right w-28 p-1"
                        />
                      </td>
                      <td className="p-2 text-right">{ekBottle}</td>
                      <td className="p-2 text-right">{row.vk_per_bottle.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Zugang buchen (Flaschen) */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Zugang buchen (Flaschen)</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <select
              className="bg-gray-900 border border-gray-700 rounded p-2"
              value={purchaseForm.drink_id}
              onChange={(e) => setPurchaseForm((p) => ({ ...p, drink_id: e.target.value }))}
            >
              <option value="">Getränk wählen…</option>
              {drinks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <input
              type="number"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="Anzahl Flaschen"
              value={purchaseForm.bottles}
              onChange={(e) => setPurchaseForm((p) => ({ ...p, bottles: e.target.value }))}
            />
            <input
              type="number"
              step="0.01"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="EK gesamt (€)"
              value={purchaseForm.total_price_eur}
              onChange={(e) => setPurchaseForm((p) => ({ ...p, total_price_eur: e.target.value }))}
            />
            <div className="self-center text-gray-400 text-sm">
              EK/Flasche:{' '}
              {(() => {
                const b = Number(purchaseForm.bottles)
                const eur = Number(purchaseForm.total_price_eur)
                if (b > 0 && eur > 0) return (eur / b).toFixed(2) + ' €'
                return '-'
              })()}
            </div>
            <button onClick={saveBottlePurchase} className="bg-green-700 hover:bg-green-800 rounded p-2 font-medium">
              Speichern
            </button>
          </div>
          <p className="text-xs text-gray-400">Speichert intern als Kistenmenge = Flaschen/20 (Dezimal erlaubt) mit EK = Gesamtpreis.</p>
        </section>

        {/* Bestand korrigieren */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Bestand korrigieren (± Flaschen)</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select
              className="bg-gray-900 border border-gray-700 rounded p-2"
              value={adjustForm.drink_id}
              onChange={(e) => setAdjustForm((p) => ({ ...p, drink_id: e.target.value }))}
            >
              <option value="">Getränk wählen…</option>
              {drinks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <input
              type="number"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="± Flaschen (z. B. -3)"
              value={adjustForm.delta_bottles}
              onChange={(e) => setAdjustForm((p) => ({ ...p, delta_bottles: e.target.value }))}
            />
            <input
              type="text"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="Notiz (Inventur/Bruch/Verlust)…"
              value={adjustForm.note}
              onChange={(e) => setAdjustForm((p) => ({ ...p, note: e.target.value }))}
            />
            <button onClick={applyStockAdjustment} className="bg-blue-700 hover:bg-blue-800 rounded p-2 font-medium">
              Korrigieren
            </button>
          </div>
          <p className="text-xs text-gray-400">Korrekturen werden als 0-€-„Purchase“ gespeichert (bleibt in den bestehenden Tabellen).</p>
        </section>

        {/* Zahlungen (verifiziert) */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">💳 Verifizierte Zahlungen (Zeitraum)</h2>
          <div className="overflow-x-auto">
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
                  <tr><td className="p-3 text-gray-400" colSpan={4}>Keine verifizierten Zahlungen im Zeitraum.</td></tr>
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
          </div>
        </section>

        {/* App-Kisten (Freibier) mit Bereitsteller */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">🎁 Bereitgestellte Kisten (App-Freibier)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Datum</th>
                  <th className="p-2 text-left">Bereitsteller</th>
                  <th className="p-2 text-left">Getränk</th>
                  <th className="p-2 text-right">Betrag</th>
                </tr>
              </thead>
              <tbody>
                {consInRange.filter((c) => c.source === 'crate' && !c.via_terminal).length === 0 ? (
                  <tr><td className="p-3 text-gray-400" colSpan={4}>Keine bereitgestellten Kisten im Zeitraum.</td></tr>
                ) : (
                  consInRange
                    .filter((c) => c.source === 'crate' && !c.via_terminal)
                    .map((c) => {
                      const prof = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles
                      const d = Array.isArray(c.drinks) ? c.drinks[0] : c.drinks
                      const userName = `${prof?.first_name || ''} ${prof?.last_name || ''}`.trim() || 'Unbekannt'
                      const drinkName = d?.name || 'Unbekannt'
                      return (
                        <tr key={c.id} className="border-t border-gray-700">
                          <td className="p-2">{new Date(c.created_at).toLocaleString('de-DE')}</td>
                          <td className="p-2">{userName}</td>
                          <td className="p-2">{drinkName}</td>
                          <td className="p-2 text-right">{euro(c.unit_price_cents || 0)}</td>
                        </tr>
                      )
                    })
                )}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm pt-2">
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Freibier-Einnahmen (App-Kisten): <b>{euro(freeBeerAppCents)}</b></div>
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Verifizierte Zahlungen: <b>{euro(totalPaymentsCents)}</b></div>
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Kosten (EK): <b>{euro(costCents)}</b></div>
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
              className={`fixed bottom-5 right-5 px-4 py-2 rounded-lg shadow-lg ${t.type === 'error' ? 'bg-red-700' : 'bg-green-700'}`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </>
  )
}

/* ================= Small UI ================= */
function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-center shadow">
      <div className="text-gray-400 text-xs">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  )
}
