'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { supabase } from '@/lib/supabase-browser'
import { ArrowDownLeft, ArrowUpRight, Beer, Edit2, RotateCcw, Save, Trash2 } from 'lucide-react'

const BOTTLES_PER_CRATE = 20
const MAX_RECENT_LOGS = 50

type Drink = { id: number; name: string }
type Purchase = {
    id: number
    drink_id: number
    quantity: number // in crates (e.g. 0.5 for 10 bottles)
    crate_price_cents: number
    created_at: string
    drinks?: { name: string } | { name: string }[]
}

const euro = (c: number) => (c / 100).toFixed(2) + ' €'

export default function AdminStockPage() {
    const [drinks, setDrinks] = useState<Drink[]>([])
    const [purchases, setPurchases] = useState<Purchase[]>([])
    const [freePool, setFreePool] = useState(0)
    const [loading, setLoading] = useState(true)
    const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])

    // Forms
    const [addForm, setAddForm] = useState({ drink_id: '', bottles: '', total_eur: '' })
    const [correctForm, setCorrectForm] = useState({ drink_id: '', delta: '', note: '' })
    const [freeForm, setFreeForm] = useState({ delta: '', note: '' })

    // Edit Mode
    const [editingId, setEditingId] = useState<number | null>(null)
    const [editPrice, setEditPrice] = useState('')

    const addToast = (text: string, type: 'success' | 'error' = 'success') => {
        const id = Date.now()
        setToasts((p) => [...p, { id, text, type }])
        setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
    }

    const [stockMap, setStockMap] = useState<Map<number, number>>(new Map())

    const fetchData = async () => {
        setLoading(true)
        const [d, recentPurchases, f, allPurchases, allConsumptions] = await Promise.all([
            supabase.from('drinks').select('id, name').order('name'),
            supabase
                .from('purchases')
                .select('id, drink_id, quantity, crate_price_cents, created_at, drinks(name)')
                .order('created_at', { ascending: false })
                .limit(MAX_RECENT_LOGS),
            supabase.from('free_pool').select('quantity_remaining').eq('id', 1).maybeSingle(),
            // Fetch for stats (minimal fields)
            supabase.from('purchases').select('drink_id, quantity'),
            supabase.from('consumptions').select('drink_id, quantity')
        ])

        setDrinks(d.data || [])
        setPurchases((recentPurchases.data as any[]) || [])
        setFreePool(f.data?.quantity_remaining || 0)

        // Calculate Stock
        const stocks = new Map<number, number>()
        // Initialize
        d.data?.forEach(drink => stocks.set(drink.id, 0))

        // Add Purchases
        allPurchases.data?.forEach(p => {
            const current = stocks.get(p.drink_id) || 0
            stocks.set(p.drink_id, current + (p.quantity * BOTTLES_PER_CRATE))
        })

        // Subtract Consumptions
        allConsumptions.data?.forEach(c => {
            if (c.drink_id) {
                const current = stocks.get(c.drink_id) || 0
                stocks.set(c.drink_id, current - c.quantity)
            }
        })

        setStockMap(stocks)
        setLoading(false)
    }

    useEffect(() => {
        fetchData()
    }, [])

    // ---------------- ACTIONS ----------------

    // 1. Zugang buchen (Einkauf)
    const handleAddStock = async () => {
        const drinkId = Number(addForm.drink_id)
        const bottles = Number(addForm.bottles)
        const totalEur = parseFloat(addForm.total_eur.replace(',', '.'))

        if (!drinkId || !bottles || isNaN(totalEur)) {
            return addToast('Bitte alle Felder korrekt ausfüllen', 'error')
        }

        const quantityCrates = bottles / BOTTLES_PER_CRATE
        // Logic: Total Price = CratePrice * Quantity
        // So: CratePrice = Total Price / Quantity
        // If quantity is 0 (should not happen), avoid division by zero
        const cratePriceCents = quantityCrates > 0 ? Math.round((totalEur * 100) / quantityCrates) : 0

        const { error } = await supabase.from('purchases').insert({
            drink_id: drinkId,
            quantity: quantityCrates,
            crate_price_cents: cratePriceCents,
        })

        if (error) {
            console.error(error)
            addToast('Fehler beim Speichern', 'error')
        } else {
            addToast(`✅ ${bottles} Fl. für ${euro(totalEur * 100)} eingebucht`)
            setAddForm({ drink_id: '', bottles: '', total_eur: '' })
            fetchData()
        }
    }

    // 2. Bestand korrigieren (Inventur/Bruch)
    const handleCorrectStock = async () => {
        const drinkId = Number(correctForm.drink_id)
        const delta = Number(correctForm.delta)

        if (!drinkId || !delta) {
            return addToast('Bitte Getränk und Anzahl eingeben', 'error')
        }

        // A correction is basically a purchase with price 0
        // Positive delta = found bottles (add)
        // Negative delta = lost bottles (remove)
        const quantityCrates = delta / BOTTLES_PER_CRATE

        const { error } = await supabase.from('purchases').insert({
            drink_id: drinkId,
            quantity: quantityCrates,
            crate_price_cents: 0, // No financial impact recorded here mostly
            // Note: If you want to track lost value, you'd need a separate "Losses" table or logic.
            // Currently using 'purchases' table as a general stock mover as per precedent.
        })

        if (error) {
            addToast('Fehler bei Korrektur', 'error')
        } else {
            addToast(`Bestand korrigiert (${delta} Fl.)`)
            setCorrectForm({ drink_id: '', delta: '', note: '' })
            fetchData()
        }
    }

    // 3. Freibier Pool
    const handleFreePool = async () => {
        const delta = Number(freeForm.delta)
        if (!delta) return addToast('Anzahl eingeben', 'error')

        const { error } = await supabase.rpc('terminal_decrement_free_pool', {
            _id: 1,
            _used: -delta, // Negative usage = Adding to pool
        })

        if (error) {
            addToast('Fehler beim Update', 'error')
        } else {
            addToast('Freibier-Pool aktualisiert')
            setFreeForm({ delta: '', note: '' })
            // Log it
            await supabase.from('free_pool_log').insert({ change: delta, note: freeForm.note })
            fetchData()
        }
    }

    // 4. Edit Purchase Price
    const handleUpdatePrice = async (purchase: Purchase) => {
        const newTotal = parseFloat(editPrice.replace(',', '.'))
        if (isNaN(newTotal)) return addToast('Ungültiger Preis', 'error')

        // Recalculate crate price
        const cratePriceCents = purchase.quantity !== 0
            ? Math.round((newTotal * 100) / purchase.quantity)
            : 0

        const { error } = await supabase
            .from('purchases')
            .update({ crate_price_cents: cratePriceCents })
            .eq('id', purchase.id)

        if (error) {
            addToast('Fehler beim Update', 'error')
        } else {
            addToast('Preis aktualisiert ✅')
            setEditingId(null)
            setEditPrice('')
            fetchData()
        }
    }

    return (
        <>
            <TopNav />
            <AdminNav />

            <div className="pt-20 max-w-6xl mx-auto p-4 text-white space-y-10 pb-32">
                <div className="flex items-center gap-3">
                    <div className="p-3 bg-blue-900/30 text-blue-400 rounded-xl">
                        <RotateCcw size={32} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Bestandspflege</h1>
                        <p className="text-gray-400 text-sm">Einkäufe erfassen, Inventur & Freibier verwalten</p>
                    </div>
                </div>

                {/* --- CURRENT STOCK OVERVIEW --- */}
                <section className="bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden mb-6">
                    <div className="px-4 py-2 bg-gray-900/60 border-b border-gray-800">
                        <h3 className="text-sm font-semibold text-gray-300">📊 Aktueller Bestand</h3>
                    </div>
                    <div className="flex overflow-x-auto p-4 gap-3 no-scrollbar">
                        {drinks.map(d => {
                            const stock = stockMap.get(d.id) || 0
                            const lowStock = stock < 20
                            return (
                                <div key={d.id} className={`min-w-[120px] border rounded-xl p-3 flex flex-col items-center justify-center text-center ${lowStock ? 'bg-red-950/30 border-red-900/50' : 'bg-gray-950/50 border-gray-800'}`}>
                                    <span className="text-xs text-gray-400 mb-1">{d.name}</span>
                                    <span className={`text-xl font-bold ${lowStock ? 'text-red-400' : 'text-white'}`}>{stock}</span>
                                </div>
                            )
                        })}
                        {/* NOTE: To show real stock here we need to duplicate the heavy Inventory logic 
                             from /admin/inventory or move it to a shared hook. 
                             For now, the user asked for an "Overview". 
                             I will update the Component to fetch Inventory data properly.
                         */}
                    </div>
                </section>

                {/* --- GRID --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* Card 1: EINKAUF */}
                    <section className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4">
                        <h2 className="font-semibold flex items-center gap-2 text-green-400">
                            <ArrowDownLeft size={20} />
                            Zugang buchen (Einkauf)
                        </h2>
                        <div className="space-y-3">
                            <select
                                className="w-full bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm focus:border-green-500 outline-none"
                                value={addForm.drink_id}
                                onChange={e => setAddForm({ ...addForm, drink_id: e.target.value })}
                            >
                                <option value="">Getränk wählen...</option>
                                {drinks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>

                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className="w-1/2 bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm"
                                    placeholder="Menge (Fl.)"
                                    value={addForm.bottles}
                                    onChange={e => setAddForm({ ...addForm, bottles: e.target.value })}
                                />
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-1/2 bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm"
                                    placeholder="Gesamtpreis €"
                                    value={addForm.total_eur}
                                    onChange={e => setAddForm({ ...addForm, total_eur: e.target.value })}
                                />
                            </div>

                            <div className="pt-2">
                                <button
                                    onClick={handleAddStock}
                                    className="w-full bg-green-700 hover:bg-green-600 text-white font-medium py-2 rounded-xl transition shadow-lg shadow-green-900/20"
                                >
                                    Buchen
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Card 2: KORREKTUR */}
                    <section className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4">
                        <h2 className="font-semibold flex items-center gap-2 text-blue-400">
                            <Edit2 size={18} />
                            Bestand korrigieren
                        </h2>
                        <div className="space-y-3">
                            <select
                                className="w-full bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm focus:border-blue-500 outline-none"
                                value={correctForm.drink_id}
                                onChange={e => setCorrectForm({ ...correctForm, drink_id: e.target.value })}
                            >
                                <option value="">Getränk wählen...</option>
                                {drinks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>

                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className="w-full bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm"
                                    placeholder="± Flaschen (z.B. -1)"
                                    value={correctForm.delta}
                                    onChange={e => setCorrectForm({ ...correctForm, delta: e.target.value })}
                                />
                            </div>

                            <div className="pt-2">
                                <button
                                    onClick={handleCorrectStock}
                                    className="w-full bg-blue-700 hover:bg-blue-600 text-white font-medium py-2 rounded-xl transition shadow-lg shadow-blue-900/20"
                                >
                                    Korrigieren
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Card 3: FREIBIER */}
                    <section className="bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                            <Beer size={120} />
                        </div>
                        <div className="flex justify-between items-start">
                            <h2 className="font-semibold flex items-center gap-2 text-pink-400">
                                <Beer size={18} />
                                Freibier-Pool
                            </h2>
                            <div className="bg-pink-900/30 text-pink-200 px-3 py-1 rounded-full text-xs font-bold border border-pink-800">
                                {freePool} Fl. übrig
                            </div>
                        </div>

                        <div className="space-y-3 relative z-10">
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className="w-full bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm"
                                    placeholder="± Flaschen"
                                    value={freeForm.delta}
                                    onChange={e => setFreeForm({ ...freeForm, delta: e.target.value })}
                                />
                            </div>
                            <input
                                type="text"
                                className="w-full bg-black/40 border border-gray-700 rounded-lg p-2.5 text-sm"
                                placeholder="Grund (optional)"
                                value={freeForm.note}
                                onChange={e => setFreeForm({ ...freeForm, note: e.target.value })}
                            />

                            <div className="pt-2">
                                <button
                                    onClick={handleFreePool}
                                    className="w-full bg-pink-700 hover:bg-pink-600 text-white font-medium py-2 rounded-xl transition shadow-lg shadow-pink-900/20"
                                >
                                    Pool anpassen
                                </button>
                            </div>
                        </div>
                    </section>

                </div>

                {/* --- LISTE --- */}
                <section className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
                        <h3 className="font-semibold">📜 Letzte Einbuchungen & Korrekturen</h3>
                        <span className="text-xs text-gray-500">Zeigt letzte {MAX_RECENT_LOGS} Einträge</span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-gray-400 bg-gray-950/50 uppercase text-xs">
                                <tr>
                                    <th className="px-4 py-3">Datum</th>
                                    <th className="px-4 py-3">Getränk</th>
                                    <th className="px-4 py-3 text-right">Menge</th>
                                    <th className="px-4 py-3 text-right">Gesamtpreis</th>
                                    <th className="px-4 py-3 text-right">Aktion</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {purchases.map(p => {
                                    const date = new Date(p.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                                    // Robust getting name
                                    let dName = '-'
                                    if (p.drinks) {
                                        if (Array.isArray(p.drinks)) dName = p.drinks[0]?.name || '-'
                                        else dName = (p.drinks as any).name || '-'
                                    }

                                    const bottles = Math.round(p.quantity * BOTTLES_PER_CRATE)
                                    const totalCents = Math.round(p.quantity * p.crate_price_cents)
                                    const isCorrection = p.crate_price_cents === 0

                                    return (
                                        <tr key={p.id} className="hover:bg-gray-800/50 transition">
                                            <td className="px-4 py-3 text-gray-400 font-mono text-xs">{date}</td>
                                            <td className="px-4 py-3 font-medium text-gray-200">{dName}</td>
                                            <td className={`px-4 py-3 text-right ${bottles < 0 ? 'text-red-400' : 'text-green-400'}`}>
                                                {bottles > 0 ? '+' : ''}{bottles} Fl.
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono">
                                                {editingId === p.id ? (
                                                    <input
                                                        autoFocus
                                                        className="w-20 bg-black border border-blue-500 rounded px-1 py-0.5 text-right text-white"
                                                        value={editPrice}
                                                        onChange={e => setEditPrice(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleUpdatePrice(p)}
                                                    />
                                                ) : (
                                                    <span className={isCorrection ? 'text-gray-600' : 'text-white'}>
                                                        {euro(totalCents)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {editingId === p.id ? (
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white">Abbr.</button>
                                                        <button onClick={() => handleUpdatePrice(p)} className="text-green-400 hover:text-green-300"><Save size={16} /></button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => { setEditingId(p.id); setEditPrice((totalCents / 100).toFixed(2)) }}
                                                        className="text-gray-600 hover:text-blue-400 transition p-1 rounded"
                                                        title="Preis korrigieren"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        {purchases.length === 0 && <div className="p-8 text-center text-gray-500">Keine Daten vorhanden</div>}
                    </div>
                </section>

                {/* --- TOASTS --- */}
                <AnimatePresence>
                    {toasts.map(t => (
                        <motion.div
                            key={t.id}
                            initial={{ opacity: 0, y: 50 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 z-50 ${t.type === 'error' ? 'bg-red-900/90 text-red-100' : 'bg-green-900/90 text-green-100'
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
