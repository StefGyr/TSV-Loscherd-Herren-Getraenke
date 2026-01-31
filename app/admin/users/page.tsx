'use client'

import { useEffect, useState } from 'react'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { supabase } from '@/lib/supabase-browser'
import { Edit2, Trash2, Search, User, CreditCard } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type Profile = {
    id: string
    name: string | null
    first_name: string | null
    last_name: string | null
    open_balance_cents: number | null
}

type Payment = {
    user_id: string
    amount_cents: number
    verified: boolean
    created_at: string
}

type ConsumptionEntry = {
    id: number
    quantity: number
    unit_price_cents: number | null
    source: string | null
    created_at: string
    drinks: {
        name: string | null
    } | null
}

export default function UsersPage() {
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [payments, setPayments] = useState<Payment[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')

    // 🔹 Detail-Ansicht für einen ausgewählten Nutzer
    const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
    const [userConsumptions, setUserConsumptions] = useState<ConsumptionEntry[]>([])
    const [detailsLoading, setDetailsLoading] = useState(false)

    // 🔹 Popup State
    const [popup, setPopup] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
    const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])

    const addToast = (text: string, type: 'success' | 'error' = 'success') => {
        const id = Date.now() + Math.random()
        setToasts((p) => [...p, { id, text, type }])
        setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
    }

    const fetchData = async () => {
        setLoading(true)

        const [{ data: profData }, { data: payData }] = await Promise.all([
            supabase
                .from('profiles')
                .select('id, name, first_name, last_name, open_balance_cents')
                .order('name', { ascending: true }),
            supabase
                .from('payments')
                .select('user_id, amount_cents, verified, created_at')
                .eq('verified', true)
                .order('created_at', { ascending: false }),
        ])

        setProfiles(profData || [])
        setPayments(payData || [])
        setLoading(false)
    }

    useEffect(() => {
        fetchData()
    }, [])

    // 🔹 Nutzer Filter
    const filteredProfiles = profiles.filter(p => {
        const term = searchTerm.toLowerCase()
        const n = (p.name || '').toLowerCase()
        const f = (p.first_name || '').toLowerCase()
        const l = (p.last_name || '').toLowerCase()
        return n.includes(term) || f.includes(term) || l.includes(term)
    })

    const formatEuro = (cents: number | null | undefined) =>
        ((cents || 0) / 100).toFixed(2) + ' €'

    const getRowColor = (value: number) => {
        if (value < 0) return 'text-green-400'
        if (value === 0) return 'text-gray-400'
        return 'text-red-400'
    }

    const getDisplayName = (p: Profile) =>
        p.name ||
        `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
        'Unbekannt'

    // 🔹 Details eines Nutzers laden
    const loadUserDetails = async (profile: Profile) => {
        setSelectedUser(profile)
        setDetailsLoading(true)
        setUserConsumptions([])

        const { data: consData } = await supabase
            .from('consumptions')
            .select('id, quantity, unit_price_cents, source, created_at, drinks(name)')
            .eq('user_id', profile.id)
            .order('created_at', { ascending: false })
            .limit(50) // Mehr History anzeigen

        setUserConsumptions((consData as any as ConsumptionEntry[]) || [])
        setDetailsLoading(false)
    }

    // ---------------- ACTIONS ----------------

    // 1. Saldo manuell anpassen
    const handleEditBalance = (profile: Profile) => {
        const currentEuro = ((profile.open_balance_cents || 0) / 100).toFixed(2)
        const input = prompt(`Neuer Kontostand für ${getDisplayName(profile)} (in €):`, currentEuro)
        if (input === null) return

        const newVal = parseFloat(input.replace(',', '.'))
        if (isNaN(newVal)) return addToast('Ungültiger Betrag', 'error')

        const newCents = Math.round(newVal * 100)

        setPopup({
            title: 'Kontostand ändern',
            message: `Soll der Kontostand von ${getDisplayName(profile)} wirklich auf ${formatEuro(newCents)} gesetzt werden?`,
            onConfirm: async () => {
                const { error } = await supabase.from('profiles').update({ open_balance_cents: newCents }).eq('id', profile.id)
                if (error) {
                    addToast('Fehler beim Speichern', 'error')
                } else {
                    addToast('Kontostand aktualisiert ✅')
                    // Update local state
                    setProfiles(prev => prev.map(p => p.id === profile.id ? { ...p, open_balance_cents: newCents } : p))
                    if (selectedUser?.id === profile.id) {
                        setSelectedUser({ ...selectedUser, open_balance_cents: newCents })
                    }
                }
                setPopup(null)
            }
        })
    }

    // 2. Buchung löschen (und erstatten)
    const handleDeleteConsumption = (c: ConsumptionEntry) => {
        if (!selectedUser) return

        const isCrateProvision = c.source === 'crate' && (c.quantity || 0) === 0

        let amount = (c.unit_price_cents || 0) * (c.quantity || 0)
        if (isCrateProvision) {
            amount = c.unit_price_cents || 0
        }

        const isFree = amount === 0

        let message = `Soll die Buchung vom ${new Date(c.created_at).toLocaleString()} wirklich gelöscht werden?`

        if (isCrateProvision) {
            message += `\n\n⚠️ ACHTUNG: Dies ist eine Kisten-Bereitstellung!\n- ${formatEuro(amount)} werden dem Nutzer gutgeschrieben (abgezogen).\n- 20 Flaschen werden aus dem Freibier-Pool ENTFERNT.`
        } else if (c.source === 'crate') {
            message += `\n\n(Kistenkauf via Terminal)\nDer Betrag von ${formatEuro(amount)} wird dem Nutzer gutgeschrieben.`
        } else if (!isFree) {
            message += `\n\nDer Betrag von ${formatEuro(amount)} wird dem Nutzer gutgeschrieben.`
        } else {
            message += '\n\nDies war eine kostenlose Buchung.'
        }

        setPopup({
            title: 'Buchung löschen',
            message,
            onConfirm: async () => {
                // 1. Delete Consumption
                const { error: delErr } = await supabase.from('consumptions').delete().eq('id', c.id)
                if (delErr) return addToast('Fehler beim Löschen der Buchung', 'error')

                // 2. Refund Balance (if paid or crate provision)
                if (!isFree) {
                    const { error: balErr } = await supabase.rpc('increment_balance', {
                        user_id_input: selectedUser.id,
                        amount_input: -amount // Refund debt
                    })
                    if (balErr) console.error('Refund error', balErr)
                }

                // 3. Revert Free Pool (Only for Crate PROVISION)
                if (isCrateProvision) {
                    const { error: poolErr } = await supabase.rpc('terminal_decrement_free_pool', {
                        _id: 1, // Global Pool ID
                        _used: 20
                    })
                    if (poolErr) {
                        console.error('Pool Revert Error', poolErr)
                        addToast('⚠️ Freibier-Pool konnte nicht korrigiert werden', 'error')
                    } else {
                        addToast('Freibier-Pool korrigiert (-20 Fl.)')
                    }
                }

                addToast('Buchung gelöscht & erstattet ✅')

                // UI Updates
                setUserConsumptions(prev => prev.filter(x => x.id !== c.id))
                if (!isFree) {
                    const newBal = (selectedUser.open_balance_cents || 0) - amount
                    setSelectedUser({ ...selectedUser, open_balance_cents: newBal })
                    setProfiles(prev => prev.map(p => p.id === selectedUser.id ? { ...p, open_balance_cents: newBal } : p))
                }
                setPopup(null)
            }
        })
    }


    return (
        <>
            <TopNav />
            <AdminNav />
            <div className="pt-20 max-w-7xl mx-auto p-4 text-white space-y-8 pb-32">

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold">Nutzer & Guthaben</h1>
                        <p className="text-sm text-gray-400">
                            Verwaltung aller Nutzerkonten, Salden und Buchungen.
                        </p>
                    </div>

                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-gray-500" size={18} />
                        <input
                            type="text"
                            placeholder="Suchen..."
                            className="bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-2 focus:border-green-500 outline-none w-full md:w-64"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-8">

                    {/* 🔹 LINKS: Nutzerliste */}
                    <section className="bg-gray-900/40 border border-gray-800 rounded-2xl overflow-hidden h-fit">
                        <div className="p-4 bg-gray-900/60 border-b border-gray-800 flex justify-between items-center">
                            <h2 className="font-semibold flex items-center gap-2"><User size={18} /> Alle Nutzer</h2>
                            <span className="text-xs text-gray-500">{filteredProfiles.length} Nutzer</span>
                        </div>

                        <div className="overflow-auto max-h-[600px]">
                            <table className="w-full text-sm text-left">
                                <thead className="text-gray-400 bg-gray-950/50 sticky top-0 uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3">Name</th>
                                        <th className="px-4 py-3 text-right">Saldo</th>
                                        <th className="px-4 py-3 text-right">Aktion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {filteredProfiles.map(p => (
                                        <tr key={p.id} className={`hover:bg-gray-800/50 transition ${selectedUser?.id === p.id ? 'bg-blue-900/20' : ''}`}>
                                            <td className="px-4 py-3 font-medium">
                                                <div className="text-white">{getDisplayName(p)}</div>
                                                {/* Optional: Add email or info if available */}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-mono font-bold ${getRowColor(p.open_balance_cents || 0)}`}>
                                                {formatEuro(p.open_balance_cents)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        onClick={() => handleEditBalance(p)}
                                                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                                        title="Saldo manuell ändern"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button
                                                        onClick={() => loadUserDetails(p)}
                                                        className={`px-3 py-1.5 rounded text-xs font-medium transition ${selectedUser?.id === p.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                                                    >
                                                        Details
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredProfiles.length === 0 && (
                                        <tr><td colSpan={3} className="p-8 text-center text-gray-500">Keine Nutzer gefunden</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* 🔹 RECHTS: Details */}
                    <section className="space-y-4">
                        {selectedUser ? (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="bg-gray-900/60 border border-gray-800 rounded-2xl overflow-hidden"
                            >
                                <div className="p-6 border-b border-gray-800 bg-gradient-to-br from-gray-900 to-gray-950">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h2 className="text-2xl font-bold">{getDisplayName(selectedUser)}</h2>
                                            <p className="text-sm text-gray-400 font-mono text-xs mt-1">ID: {selectedUser.id}</p>
                                        </div>
                                        <div className={`text-3xl font-bold ${getRowColor(selectedUser.open_balance_cents || 0)}`}>
                                            {formatEuro(selectedUser.open_balance_cents)}
                                        </div>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => handleEditBalance(selectedUser)}
                                            className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg text-sm font-medium border border-gray-700 flex justify-center gap-2 items-center"
                                        >
                                            <Edit2 size={14} /> Saldo korrigieren
                                        </button>
                                        {/* Future: Add Payment Button? */}
                                    </div>
                                </div>

                                <div className="p-4">
                                    <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                                        Buchungshistorie (letzte 50)
                                    </h3>

                                    {detailsLoading ? (
                                        <div className="text-center p-8 text-gray-500">Lade Buchungen...</div>
                                    ) : userConsumptions.length === 0 ? (
                                        <div className="text-center p-8 text-gray-500 bg-gray-950/30 rounded-xl border border-gray-800 border-dashed">Keine Buchungen vorhanden</div>
                                    ) : (
                                        <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2">
                                            {userConsumptions.map(c => {
                                                const isCrateProvision = c.source === 'crate' && (c.quantity || 0) === 0

                                                let total = (c.unit_price_cents || 0) * (c.quantity || 0)
                                                let label = `${c.quantity}× ${c.drinks?.name || 'Unbekannt'}`

                                                if (isCrateProvision) {
                                                    total = c.unit_price_cents || 0
                                                    label = 'Kiste bereitgestellt'
                                                } else if (c.source === 'crate') {
                                                    // Terminal Kistenkauf
                                                    label = `Kiste gekauft (${c.quantity} Fl.)`
                                                }

                                                const isFree = total === 0 && !isCrateProvision

                                                return (
                                                    <div key={c.id} className="flex items-center justify-between p-3 bg-gray-950/40 border border-gray-800/50 rounded-xl hover:border-gray-700 transition group">
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${isFree ? 'bg-green-900/20 text-green-400' : 'bg-blue-900/20 text-blue-400'}`}>
                                                                {c.source === 'crate' ? '📦' : '🍺'}
                                                            </div>
                                                            <div>
                                                                <div className="font-medium text-sm text-gray-200">
                                                                    {label}
                                                                </div>
                                                                <div className="text-xs text-gray-500">
                                                                    {new Date(c.created_at).toLocaleString('de-DE')}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-4">
                                                            <div className="text-right">
                                                                <div className={`font-mono font-medium ${isFree ? 'text-green-500' : 'text-gray-200'}`}>
                                                                    {formatEuro(total)}
                                                                </div>
                                                                <div className="text-[10px] text-gray-500">
                                                                    {isFree ? 'Kostenlos' : (c.source === 'crate' ? (!isCrateProvision ? 'Kauf' : 'Gutschrift') : 'Berechnet')}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleDeleteConsumption(c)}
                                                                className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition opacity-0 group-hover:opacity-100"
                                                                title="Buchung löschen & erstatten"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-2xl p-12">
                                <User size={48} className="mb-4 opacity-50" />
                                <p>Wähle einen Nutzer aus der Liste,</p>
                                <p>um Details und Buchungen zu sehen.</p>
                            </div>
                        )}
                    </section>
                </div>

                {/* --- POPUP --- */}
                <AnimatePresence>
                    {popup && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm"
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="bg-gray-900 p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center border border-gray-700"
                            >
                                <h3 className="text-lg font-semibold mb-2">{popup.title}</h3>
                                <p className="text-sm text-gray-300 mb-6 whitespace-pre-line leading-relaxed">{popup.message}</p>
                                <div className="flex justify-center gap-3">
                                    <button
                                        onClick={() => setPopup(null)}
                                        className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-xl hover:bg-gray-700 transition"
                                    >
                                        Abbrechen
                                    </button>
                                    <button
                                        onClick={() => popup.onConfirm()}
                                        className="flex-1 px-4 py-2 bg-red-600 rounded-xl hover:bg-red-700 text-white font-medium transition shadow-lg shadow-red-900/30"
                                    >
                                        Bestätigen
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

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
