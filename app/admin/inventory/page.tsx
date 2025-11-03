'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { AnimatePresence, motion } from 'framer-motion'

// ---------- Types ----------
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
  created_at: string
}

type Purchase = {
  id: number
  drink_id: number
  quantity: number // wir verwenden hier bottles/20 => Bruchteile einer Kiste
  crate_price_cents: number // hier speichern wir den EK-Gesamtbetrag für diese Buchung
  created_at: string
}

type Profile = {
  id: string
  open_balance_cents: number | null
}

// ---------- Helpers ----------
const BOTTLES_PER_CRATE = 20

function euro(cents: number) {
  return (cents / 100).toFixed(2) + ' €'
}
function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
function startOfWeek(): Date {
  const d = startOfToday()
  const day = d.getDay() || 7 // Mo=1..So=7
  d.setDate(d.getDate() - (day - 1))
  return d
}
function startOfMonth(): Date {
  const d = startOfToday()
  d.setDate(1)
  return d
}

export default function InventoryRevenuePage() {
  // data
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [consumptions, setConsumptions] = useState<Consumption[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  // toasts
  const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])
  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }

  // date filter
  const [rangePreset, setRangePreset] = useState<'today' | 'week' | 'month' | 'custom'>('month')
  const [from, setFrom] = useState<string>(() => startOfMonth().toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
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
      const [{ data: drinksData }, { data: consData }, { data: purchData }, { data: profData }] = await Promise.all([
        supabase.from('drinks').select('id,name,price_cents,ek_crate_price_cents'),
        supabase.from('consumptions').select('id,drink_id,quantity,unit_price_cents,created_at'),
        supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at'),
        supabase.from('profiles').select('id,open_balance_cents'),
      ])
      setDrinks(drinksData || [])
      setConsumptions(consData || [])
      setPurchases(purchData || [])
      setProfiles(profData || [])
      setLoading(false)
    }
    load()
  }, [])

  // join helpers
  const drinkById = useMemo(() => {
    const map = new Map<number, Drink>()
    drinks.forEach((d) => map.set(d.id, d))
    return map
  }, [drinks])

  // FILTER by date (inclusive)
  const consInRange = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00')
    const toD = new Date(to + 'T23:59:59')
    return consumptions.filter((c) => {
      const d = new Date(c.created_at)
      return d >= fromD && d <= toD
    })
  }, [consumptions, from, to])

  const purchInRange = useMemo(() => {
    const fromD = new Date(from + 'T00:00:00')
    const toD = new Date(to + 'T23:59:59')
    return purchases.filter((p) => {
      const d = new Date(p.created_at)
      return d >= fromD && d <= toD
    })
  }, [purchases, from, to])

  // ---- Categorisierung (bleibt in vorhandenen Tabellen) ----
  // Erkennung über Getränkenamen (konventionell): "Trinkgeld", "Guthaben", "Freibier"
  const isTip = (drinkName?: string) => (drinkName || '').toLowerCase().includes('trinkgeld')
  const isTopUp = (drinkName?: string) =>
    (drinkName || '').toLowerCase().includes('guthaben') ||
    (drinkName || '').toLowerCase().includes('auflad')
  const isFreeBeerRevenue = (drinkName?: string) =>
    (drinkName || '').toLowerCase().includes('freibier') ||
    (drinkName || '').toLowerCase().includes('kiste')

  // Einnahmen = nur bezahlte Getränke (unit_price_cents > 0)
  const paidConsumptions = useMemo(
    () => consInRange.filter((c) => (c.unit_price_cents || 0) > 0),
    [consInRange]
  )

  const salesRevenueCents = useMemo(() => {
    return paidConsumptions
      .filter((c) => {
        const d = c.drink_id ? drinkById.get(c.drink_id) : undefined
        const name = d?.name
        return !isTip(name) && !isTopUp(name) && !isFreeBeerRevenue(name)
      })
      .reduce((sum, c) => sum + (c.unit_price_cents || 0) * (c.quantity || 0), 0)
  }, [paidConsumptions, drinkById])

  const freeBeerRevenueCents = useMemo(() => {
    return paidConsumptions
      .filter((c) => {
        const d = c.drink_id ? drinkById.get(c.drink_id) : undefined
        return isFreeBeerRevenue(d?.name)
      })
      .reduce((sum, c) => sum + (c.unit_price_cents || 0) * (c.quantity || 0), 0)
  }, [paidConsumptions, drinkById])

  const tipsCents = useMemo(() => {
    return paidConsumptions
      .filter((c) => {
        const d = c.drink_id ? drinkById.get(c.drink_id) : undefined
        return isTip(d?.name)
      })
      .reduce((sum, c) => sum + (c.unit_price_cents || 0) * (c.quantity || 0), 0)
  }, [paidConsumptions, drinkById])

  const topUpsCents = useMemo(() => {
    return paidConsumptions
      .filter((c) => {
        const d = c.drink_id ? drinkById.get(c.drink_id) : undefined
        return isTopUp(d?.name)
      })
      .reduce((sum, c) => sum + (c.unit_price_cents || 0) * (c.quantity || 0), 0)
  }, [paidConsumptions, drinkById])

  const totalRevenueCents = useMemo(
    () => salesRevenueCents + freeBeerRevenueCents + tipsCents + topUpsCents,
    [salesRevenueCents, freeBeerRevenueCents, tipsCents, topUpsCents]
  )

  // Kosten im Zeitraum (EK gesamt je Purchase)
  const costCents = useMemo(() => {
    return purchInRange.reduce((sum, p) => sum + (p.crate_price_cents || 0), 0)
  }, [purchInRange])

  const profitCents = useMemo(() => totalRevenueCents - costCents, [totalRevenueCents, costCents])

  const openPostenCents = useMemo(
    () => profiles.reduce((sum, p) => sum + (p.open_balance_cents || 0), 0),
    [profiles]
  )

  // Bestand nach Flaschen
  const inventory = useMemo(() => {
    const boughtByDrink = new Map<number, number>() // bottles
    purchases.forEach((p) => {
      const bottles = (p.quantity || 0) * BOTTLES_PER_CRATE
      boughtByDrink.set(p.drink_id, (boughtByDrink.get(p.drink_id) || 0) + bottles)
    })
    const soldByDrink = new Map<number, number>() // bottles
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
        sold_bottles: sold,
        ek_per_bottle: ekBottle,
        vk_per_bottle: vkBottle,
      }
    })
  }, [drinks, purchases, consumptions])

  // ---- Actions: Bottle purchase, Stock adjust, Update EK/Kiste ----
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

    const crateQty = bottles / BOTTLES_PER_CRATE // darf Bruch sein
    const { error } = await supabase.from('purchases').insert({
      drink_id,
      quantity: crateQty,
      crate_price_cents: totalPriceCents,
    })
    if (error) {
      addToast('Speichern fehlgeschlagen (prüfe Spaltentyp von purchases.quantity)', 'error')
      return
    }
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
    const delta = Number(adjustForm.delta_bottles) // + / -
    if (!drink_id || !delta) {
      addToast('Bitte Getränk und Delta (± Flaschen) angeben', 'error')
      return
    }
    // Korrektur als 0€-Purchase (bleibt in bestehenden Tabellen)
    const crateQty = delta / BOTTLES_PER_CRATE
    const { error } = await supabase.from('purchases').insert({
      drink_id,
      quantity: crateQty,
      crate_price_cents: 0,
    })
    if (error) {
      addToast('Bestandskorrektur fehlgeschlagen', 'error')
      return
    }
    addToast('Bestand angepasst')
    setAdjustForm({ drink_id: '', delta_bottles: '', note: '' })
    const { data } = await supabase.from('purchases').select('id,drink_id,quantity,crate_price_cents,created_at')
    setPurchases(data || [])
  }

  const updateEKCrate = async (drinkId: number, eur: number) => {
    const { error } = await supabase
      .from('drinks')
      .update({ ek_crate_price_cents: Math.round(eur * 100) })
      .eq('id', drinkId)
    if (error) addToast('EK/Kiste Speichern fehlgeschlagen', 'error')
    else addToast('EK/Kiste aktualisiert')
  }

  if (loading) return <div className="p-6 text-center text-white">⏳ Lade Daten…</div>

  return (
    <>
      <TopNav />
      <AdminNav />
      <div className="pt-20 max-w-7xl mx-auto p-4 text-white space-y-8">

        {/* Header + Date Filter */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <h1 className="text-2xl font-bold">📦 Bestand & 💶 Einnahmen (flaschenbasiert)</h1>
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
          <Stat title="Einnahmen (gesamt)" value={euro(totalRevenueCents)} />
          <Stat title="• Normalverkauf" value={euro(salesRevenueCents)} />
          <Stat title="• Freibier (Einnahmen)" value={euro(freeBeerRevenueCents)} />
          <Stat title="• Trinkgeld" value={euro(tipsCents)} />
          <Stat title="• Guthaben" value={euro(topUpsCents)} />
          <Stat title="Kosten (EK)" value={euro(costCents)} />
          <Stat title="Gewinn" value={euro(profitCents)} />
          <Stat title="Offene Posten" value={euro(openPostenCents)} />
        </div>

        {/* Inventory Table */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-4">
          <h2 className="text-lg font-semibold">Getränkebestand (Flaschen)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Getränk</th>
                  <th className="p-2 text-right">Bestand</th>
                  <th className="p-2 text-right">Verkauft (Zeitraum)</th>
                  <th className="p-2 text-right">EK / Kiste (€)</th>
                  <th className="p-2 text-right">EK / Flasche (€)</th>
                  <th className="p-2 text-right">VK / Flasche (€)</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((row) => {
                  const ekBottle = row.ek_per_bottle != null ? row.ek_per_bottle.toFixed(2) : ''
                  return (
                    <tr key={row.id} className="border-t border-gray-700">
                      <td className="p-2">{row.name}</td>
                      <td className="p-2 text-right">{row.stock_bottles}</td>
                      <td className="p-2 text-right">
                        {
                          // verkauft im Zeitraum:
                          consInRange
                            .filter((c) => c.drink_id === row.id)
                            .reduce((s, c) => s + (c.quantity || 0), 0)
                        }
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={drinkById.get(row.id)?.ek_crate_price_cents ? (drinkById.get(row.id)!.ek_crate_price_cents! / 100).toFixed(2) : ''}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value || '0')
                            if (v > 0) updateEKCrate(row.id, v)
                          }}
                          className="bg-gray-900 border border-gray-700 rounded text-right w-28 p-1"
                        />
                      </td>
                      <td className="p-2 text-right">{ekBottle}</td>
                      <td className="p-2 text-right">{(row.vk_per_bottle).toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Bottle Purchase */}
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
          <p className="text-xs text-gray-400">
            Hinweis: Speichert intern als Kistenmenge = Flaschen/20 (mit Dezimalstellen) und EK = Gesamtpreis.
          </p>
        </section>

        {/* Stock Adjustment */}
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
              placeholder="± Flaschen (z.B. -3)"
              value={adjustForm.delta_bottles}
              onChange={(e) => setAdjustForm((p) => ({ ...p, delta_bottles: e.target.value }))}
            />
            <input
              type="text"
              className="bg-gray-900 border border-gray-700 rounded p-2"
              placeholder="Notiz (Inventur/Bruch/Verlust)… (nur intern)"
              value={adjustForm.note}
              onChange={(e) => setAdjustForm((p) => ({ ...p, note: e.target.value }))}
            />
            <button onClick={applyStockAdjustment} className="bg-blue-700 hover:bg-blue-800 rounded p-2 font-medium">
              Korrigieren
            </button>
          </div>
          <p className="text-xs text-gray-400">
            Hinweis: Korrekturen werden als 0-€-„Purchase“ gespeichert (bleibt in den bestehenden Tabellen).
          </p>
        </section>

        {/* Revenue detail table */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 shadow space-y-3">
          <h2 className="text-lg font-semibold">Einnahmen – Details (Zeitraum)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="p-2 text-left">Datum</th>
                  <th className="p-2 text-left">Typ</th>
                  <th className="p-2 text-left">Nutzer</th>
                  <th className="p-2 text-left">Getränk</th>
                  <th className="p-2 text-right">Menge</th>
                  <th className="p-2 text-right">Summe (€)</th>
                </tr>
              </thead>
              <tbody>
                {paidConsumptions.map((c) => {
                  const drink = c.drink_id ? drinkById.get(c.drink_id) : undefined
                  const name = drink?.name || '—'
                  const type =
                    isTip(name) ? 'Trinkgeld'
                    : isTopUp(name) ? 'Guthaben'
                    : isFreeBeerRevenue(name) ? 'Freibier-Einnahme'
                    : 'Verkauf'
                  const sum = (c.unit_price_cents || 0) * (c.quantity || 0)
                  return (
                    <tr key={c.id} className="border-t border-gray-700">
                      <td className="p-2">{new Date(c.created_at).toLocaleString('de-DE')}</td>
                      <td className="p-2">{type}</td>
                      <td className="p-2">—</td>
                      <td className="p-2">{name}</td>
                      <td className="p-2 text-right">{c.quantity}</td>
                      <td className="p-2 text-right">{euro(sum)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 text-sm">
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Verkauf: <b>{euro(salesRevenueCents)}</b></div>
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Freibier-Einnahmen: <b>{euro(freeBeerRevenueCents)}</b></div>
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Trinkgeld: <b>{euro(tipsCents)}</b></div>
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">Guthaben: <b>{euro(topUpsCents)}</b></div>
          </div>
          <p className="text-xs text-gray-400">
            Trennung via Getränkenamen (z. B. „💌 Trinkgeld“, „💶 Guthaben-Aufladung“, „Freibier-Kiste“). Bleibt vollständig in euren bestehenden Tabellen.
          </p>
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

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-4 text-center shadow">
      <div className="text-gray-400 text-xs">{title}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  )
}
