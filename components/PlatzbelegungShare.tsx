'use client'

import React from 'react'
import { MapPin, Calendar, Clock, Trophy, ChevronRight } from 'lucide-react'

type Entry = {
    id: string
    date: string
    time: string
    team_home: string
    team_guest: string
    competition: string
    section: string
    field: string
    location: string
}

export default function PlatzbelegungShare({ entries }: { entries: Entry[] }) {
    // Group by date
    const grouped = entries.reduce((acc, e) => {
        const label = new Date(e.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' })
        if (!acc[label]) acc[label] = []
        acc[label].push(e)
        return acc
    }, {} as Record<string, Entry[]>)

    return (
        <div className="bg-neutral-950 text-white p-6 rounded-3xl border border-neutral-800 shadow-2xl overflow-hidden max-w-md mx-auto" id="share-card">
            <div className="text-center mb-8">
                <div className="inline-block px-3 py-1 bg-green-600/20 text-green-400 rounded-full text-[10px] font-bold uppercase tracking-widest mb-2 border border-green-600/30">
                    TSV Lonnerstadt
                </div>
                <h2 className="text-3xl font-black tracking-tight text-white uppercase italic">
                    Platzbelegung
                </h2>
                <div className="h-1 w-12 bg-green-500 mx-auto mt-2 rounded-full"></div>
            </div>

            <div className="space-y-8">
                {Object.entries(grouped).map(([day, dayEntries]) => (
                    <div key={day} className="relative">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="h-px flex-1 bg-neutral-800"></div>
                            <h3 className="text-sm font-bold text-neutral-400 uppercase tracking-widest bg-neutral-950 px-2">{day}</h3>
                            <div className="h-px flex-1 bg-neutral-800"></div>
                        </div>

                        <div className="space-y-4">
                            {dayEntries.map((e) => (
                                <div key={e.id} className="relative group">
                                    {/* Field Badge */}
                                    <div className={`absolute -left-2 -top-2 z-10 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow-lg ${e.field === '1' ? 'bg-emerald-600 text-white' :
                                            e.field === '2' ? 'bg-blue-600 text-white' : 'bg-neutral-700 text-white'
                                        }`}>
                                        {e.field || '?'}
                                    </div>

                                    <div className="bg-neutral-900/80 backdrop-blur border border-neutral-800 rounded-2xl p-4 pl-8 group-hover:border-neutral-700 transition shadow-lg">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-400 uppercase">
                                                <Clock size={12} className="text-green-500" />
                                                {e.time} Uhr
                                            </div>
                                            <div className="text-[10px] bg-neutral-800 px-2 py-0.5 rounded text-neutral-500 uppercase font-bold">
                                                {e.section}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="flex-1 text-base font-bold text-white leading-tight">
                                                {e.team_home}
                                            </div>
                                            <div className="text-xs font-black text-neutral-600 italic">VS</div>
                                            <div className="flex-1 text-base font-bold text-white text-right leading-tight">
                                                {e.team_guest}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-neutral-800/50">
                                            <div className="flex items-center gap-1 text-[10px] text-neutral-500">
                                                <Trophy size={10} />
                                                <span className="truncate max-w-[120px]">{e.competition}</span>
                                            </div>
                                            <div className="flex items-center gap-1 text-[10px] text-neutral-500">
                                                <MapPin size={10} />
                                                <span className="truncate max-w-[100px]">{e.location.split(',')[0]}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-10 text-center">
                <div className="text-[10px] text-neutral-600 uppercase font-bold tracking-widest mb-1">
                    Stand: {new Date().toLocaleDateString('de-DE')}
                </div>
                <div className="text-[8px] text-neutral-700 italic">
                    Änderungen vorbehalten • bfv.de
                </div>
            </div>
        </div>
    )
}
