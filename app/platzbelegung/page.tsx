'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase-browser'
import PlatzbelegungShare from '@/components/PlatzbelegungShare'
import { Share2, RefreshCw } from 'lucide-react'

export default function PublicPlatzbelegungPage() {
    const [entries, setEntries] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    const loadData = useCallback(async () => {
        setLoading(true)
        const today = new Date()
        // Start of current week (Monday)
        const day = today.getDay()
        const diff = today.getDate() - day + (day === 0 ? -6 : 1)
        const startOfWeek = new Date(today.setDate(diff))
        startOfWeek.setHours(0, 0, 0, 0)

        const endOfWeek = new Date(startOfWeek)
        endOfWeek.setDate(startOfWeek.getDate() + 6)
        endOfWeek.setHours(23, 59, 59, 999)

        const { data, error } = await supabase
            .from('platzbelegung')
            .select('*')
            .gte('date', startOfWeek.toISOString().split('T')[0])
            .lte('date', endOfWeek.toISOString().split('T')[0])
            .order('date', { ascending: true })
            .order('time', { ascending: true })

        if (error) {
            console.error('Error fetching data:', error)
        } else {
            setEntries(data || [])
        }
        setLoading(false)
    }, [])

    useEffect(() => {
        loadData()
    }, [loadData])

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'TSV Lonnerstadt Platzbelegung',
                    text: 'Hier ist die aktuelle Platzbelegung für diese Woche.',
                    url: window.location.href,
                })
            } catch (err) {
                console.log('Share failed', err)
            }
        } else {
            alert('Teilen wird von deinem Browser nicht unterstützt. Bitte erstelle einen Screenshot.')
        }
    }

    return (
        <div className="min-h-screen bg-neutral-950 text-white pb-20">
            {/* Simple Public Header */}
            <div className="fixed top-0 left-0 right-0 z-50 bg-neutral-950/80 backdrop-blur-md border-b border-neutral-900 px-6 py-4">
                <div className="max-w-4xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center font-bold text-white text-xs">TSV</div>
                        <span className="font-bold tracking-tight">Platzbelegung</span>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto pt-24 px-6 text-center">
                <div className="flex items-center justify-between mb-8">
                    <div className="w-10"></div> {/* Spacer */}
                    <h1 className="text-xl font-bold text-neutral-400 uppercase tracking-widest">Wochenübersicht</h1>
                    <button onClick={loadData} className="p-2 hover:bg-neutral-900 rounded-full text-neutral-400 transition" title="Aktualisieren">
                        <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <RefreshCw size={40} className="animate-spin text-green-500 mb-4" />
                        <p className="text-neutral-500">Lade Platzbelegung...</p>
                    </div>
                ) : entries.length === 0 ? (
                    <div className="py-20 bg-neutral-900/40 rounded-3xl border border-neutral-800">
                        <p className="text-neutral-400">Aktuell sind keine Spiele für diese Woche eingetragen.</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center">
                        <div className="mb-10 w-full max-w-sm">
                            <PlatzbelegungShare entries={entries} />
                        </div>

                        <button
                            onClick={handleShare}
                            className="flex items-center justify-center gap-2 px-10 py-4 bg-green-600 hover:bg-green-700 rounded-2xl font-bold shadow-lg shadow-green-900/20 transition w-full max-w-sm"
                        >
                            <Share2 size={20} /> Diese Ansicht teilen
                        </button>

                        <p className="mt-8 text-neutral-500 text-sm italic max-w-xs mx-auto">
                            Tipp: Erstelle einen Screenshot von der Ansicht oben, um ihn direkt in WhatsApp zu verschicken.
                        </p>
                    </div>
                )}
            </div>

            {/* Footer / Info */}
            <div className="mt-12 text-center text-neutral-600 text-[10px] space-y-1">
                <p>© TSV Lonnerstadt 1948 e.V.</p>
                <p>Besuche uns auf www.tsv-lonnerstadt.de</p>
            </div>
        </div>
    )
}
