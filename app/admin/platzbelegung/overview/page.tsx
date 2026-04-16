'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import PlatzbelegungShare from '@/components/PlatzbelegungShare'
import { Download, Share2, ArrowLeft, RefreshCw } from 'lucide-react'

export default function PlatzbelegungOverviewPage() {
    const [entries, setEntries] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const shareRef = useRef<HTMLDivElement>(null)

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
        // Modern browsers share API
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
            <TopNav />
            <div className="max-w-4xl mx-auto pt-24 px-6 text-center">
                <div className="flex items-center justify-between mb-8">
                    <a href="/admin/platzbelegung" className="p-2 hover:bg-neutral-900 rounded-full text-neutral-400 transition">
                        <ArrowLeft size={24} />
                    </a>
                    <h1 className="text-2xl font-bold">Wochenübersicht</h1>
                    <button onClick={loadData} className="p-2 hover:bg-neutral-900 rounded-full text-neutral-400 transition">
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
                        <p className="text-neutral-400 mb-6">Keine Einträge für diese Woche gefunden.</p>
                        <a href="/admin/platzbelegung" className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-xl font-bold transition">
                            Daten hochladen
                        </a>
                    </div>
                ) : (
                    <div className="flex flex-col items-center">
                        <div ref={shareRef} className="mb-10 w-full max-w-sm">
                            <PlatzbelegungShare entries={entries} />
                        </div>

                        <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
                            <button
                                onClick={() => window.print()}
                                className="flex items-center justify-center gap-2 px-6 py-4 bg-neutral-800 hover:bg-neutral-700 rounded-2xl font-bold border border-neutral-700 transition"
                            >
                                <Download size={20} /> Drucken
                            </button>
                            <button
                                onClick={handleShare}
                                className="flex items-center justify-center gap-2 px-6 py-4 bg-green-600 hover:bg-green-700 rounded-2xl font-bold shadow-lg shadow-green-900/20 transition"
                            >
                                <Share2 size={20} /> Teilen
                            </button>
                        </div>

                        <p className="mt-8 text-neutral-500 text-sm italic max-w-xs mx-auto">
                            Tipp: Erstelle einen Screenshot von der Ansicht oben, um ihn direkt in WhatsApp zu verschicken.
                        </p>
                    </div>
                )}
            </div>

            <style jsx global>{`
        @media print {
            body * {
                visibility: hidden;
            }
            #share-card, #share-card * {
                visibility: visible;
            }
            #share-card {
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
                border: none;
                box-shadow: none;
            }
        }
      `}</style>
        </div>
    )
}
