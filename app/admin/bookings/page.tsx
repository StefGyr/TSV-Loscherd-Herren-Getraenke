'use client'

import React, { useEffect, useState, useMemo } from 'react'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { supabase } from '@/lib/supabase-browser'
import {
  Smartphone,
  Monitor,
  Search,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Calendar,
  Beer,
  Clock,
  UserCheck,
  UserX,
  Sparkles,
  ArrowUpDown,
  Filter,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type Profile = {
  id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  open_balance_cents: number | null
  last_seen_at?: string | null
  last_seen_source?: 'app' | 'terminal' | null
}

type Drink = {
  id: number
  name: string
  price_cents: number
}

type ConsumptionEntry = {
  id: number
  user_id: string
  drink_id: number
  quantity: number
  unit_price_cents: number | null
  source: string | null
  via_terminal: boolean | null
  created_at: string
  drinks?: {
    name: string | null
  } | null
  profiles?: {
    first_name: string | null
    last_name: string | null
  } | null
}

type TimeframePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const formatEuro = (cents: number | null | undefined) =>
  ((cents || 0) / 100).toFixed(2) + ' €'

const getDisplayName = (p: { first_name?: string | null; last_name?: string | null; name?: string | null }) =>
  `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.name || 'Unbekannt'

export default function BookingsAdminPage() {
  const [timeframe, setTimeframe] = useState<TimeframePreset>('today')
  const [customRange, setCustomRange] = useState({
    from: new Date().toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  })

  // Haupt-Reiter: 'presence' (Wer war da / wer nicht) vs. 'journal' (Buchungen)
  const [activeTab, setActiveTab] = useState<'presence' | 'journal'>('presence')

  // Daten
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [drinks, setDrinks] = useState<Drink[]>([])
  const [consumptions, setConsumptions] = useState<ConsumptionEntry[]>([])
  const [dailyActivities, setDailyActivities] = useState<any[]>([])
  const [allLastBookings, setAllLastBookings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [dbColumnMissing, setDbColumnMissing] = useState(false)

  // Filter für Präsenz
  const [presenceFilter, setPresenceFilter] = useState<'all' | 'offline' | 'online'>('offline')
  const [presenceSearch, setPresenceSearch] = useState('')

  // Filter für Journal
  const [journalSearch, setJournalSearch] = useState('')
  const [journalTypeFilter, setJournalTypeFilter] = useState<'all' | 'paid' | 'free' | 'crate'>('all')
  const [journalChannelFilter, setJournalChannelFilter] = useState<'all' | 'app' | 'terminal'>('all')
  const [journalDrinkFilter, setJournalDrinkFilter] = useState<string>('all')

  // Modals & Toasts
  const [popup, setPopup] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null)
  const [toasts, setToasts] = useState<{ id: number; text: string; type?: 'success' | 'error' }[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500)
  }

  // Zeitraum berechnen
  const getDateRange = () => {
    const now = new Date()
    let from = new Date(now)
    let to = new Date(now)

    if (timeframe === 'today') {
      from.setHours(0, 0, 0, 0)
      to.setHours(23, 59, 59, 999)
    } else if (timeframe === 'yesterday') {
      from.setDate(now.getDate() - 1)
      from.setHours(0, 0, 0, 0)
      to.setDate(now.getDate() - 1)
      to.setHours(23, 59, 59, 999)
    } else if (timeframe === 'week') {
      from.setDate(now.getDate() - 6)
      from.setHours(0, 0, 0, 0)
      to.setHours(23, 59, 59, 999)
    } else if (timeframe === 'month') {
      from.setDate(1)
      from.setHours(0, 0, 0, 0)
      to.setHours(23, 59, 59, 999)
    } else {
      from = new Date(customRange.from)
      from.setHours(0, 0, 0, 0)
      to = new Date(customRange.to)
      to.setHours(23, 59, 59, 999)
    }

    return { from, to }
  }

  // Daten laden
  const fetchData = async () => {
    setLoading(true)
    const { from, to } = getDateRange()

    try {
      // 1. Profile laden
      const { data: profData, error: profError } = await supabase
        .from('profiles')
        .select('id, name, first_name, last_name, open_balance_cents, last_seen_at, last_seen_source')
        .order('last_name', { ascending: true })

      if (profError) {
        // Falls last_seen_at Spalte noch nicht existiert
        if (profError.message?.includes('last_seen_at') || profError.code === '42703') {
          setDbColumnMissing(true)
          const fallback = await supabase
            .from('profiles')
            .select('id, name, first_name, last_name, open_balance_cents')
            .order('last_name', { ascending: true })
          setProfiles(fallback.data || [])
        } else {
          throw profError
        }
      } else {
        setDbColumnMissing(false)
        setProfiles(profData || [])
      }

      // 2. Drinks laden
      const { data: drinkData } = await supabase
        .from('drinks')
        .select('id, name, price_cents')
        .order('name', { ascending: true })
      setDrinks(drinkData || [])

      // 3. Consumptions im Zeitraum laden
      const { data: consData, error: consError } = await supabase
        .from('consumptions')
        .select(`
          id,
          user_id,
          drink_id,
          quantity,
          unit_price_cents,
          source,
          via_terminal,
          created_at,
          drinks (name),
          profiles (first_name, last_name)
        `)
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString())
        .order('created_at', { ascending: false })

      if (consError) throw consError
      setConsumptions((consData as any) || [])

      // 4. Letzte Buchung überhaupt pro Nutzer ermitteln
      const { data: recentCons } = await supabase
        .from('consumptions')
        .select('user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(2000)

      const lastBookingMap: Record<string, string> = {}
      if (recentCons) {
        for (const item of recentCons) {
          if (!lastBookingMap[item.user_id]) {
            lastBookingMap[item.user_id] = item.created_at
          }
        }
      }
      // 5. Täglich erfasste Aktivitäten im Zeitraum laden
      try {
        const fromDateStr = from.toISOString().slice(0, 10)
        const toDateStr = to.toISOString().slice(0, 10)
        const { data: actData } = await supabase
          .from('user_daily_activity')
          .select('user_id, activity_date, last_seen_at, source')
          .gte('activity_date', fromDateStr)
          .lte('activity_date', toDateStr)
          .order('last_seen_at', { ascending: false })
        setDailyActivities(actData || [])
      } catch {
        setDailyActivities([])
      }
      setAllLastBookings(lastBookingMap)
    } catch (err: any) {
      console.error('Fehler beim Laden des Buchungsjournals:', err)
      addToast('Fehler beim Laden der Daten', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [timeframe, customRange])

  // Map: Wie viele Getränke hat jeder User im gewählten Zeitraum gebucht?
  const userBookingsInPeriod = useMemo(() => {
    const map: Record<string, { totalQty: number; drinksSummary: Record<string, number>; items: ConsumptionEntry[] }> = {}
    for (const c of consumptions) {
      if (!map[c.user_id]) {
        map[c.user_id] = { totalQty: 0, drinksSummary: {}, items: [] }
      }
      const drinkName = c.drinks?.name || 'Getränk'
      const qty = c.quantity || 0
      map[c.user_id].totalQty += qty
      map[c.user_id].drinksSummary[drinkName] = (map[c.user_id].drinksSummary[drinkName] || 0) + qty
      map[c.user_id].items.push(c)
    }
    return map
  }, [consumptions])

  // Prüfen, ob ein User im gewählten Zeitraum online war
  const { from: periodFrom, to: periodTo } = useMemo(() => getDateRange(), [timeframe, customRange])

  const dailyActivityMap = useMemo(() => {
    const map: Record<string, { last_seen_at: string; source: 'app' | 'terminal' }> = {}
    for (const a of dailyActivities) {
      if (!map[a.user_id] || new Date(a.last_seen_at) > new Date(map[a.user_id].last_seen_at)) {
        map[a.user_id] = { last_seen_at: a.last_seen_at, source: a.source }
      }
    }
    return map
  }, [dailyActivities])

  const getUserPeriodActivity = (p: Profile) => {
    const bookings = userBookingsInPeriod[p.id]
    const hasBookings = (bookings?.items?.length || 0) > 0
    const dailyRecord = dailyActivityMap[p.id]

    const profileSeen = p.last_seen_at ? new Date(p.last_seen_at) : null
    const isProfileSeenInPeriod = profileSeen ? (profileSeen >= periodFrom && profileSeen <= periodTo) : false

    const wasActive = hasBookings || !!dailyRecord || isProfileSeenInPeriod

    let periodLastSeen: string | null = null
    let periodSource: 'app' | 'terminal' | null = null

    if (dailyRecord) {
      periodLastSeen = dailyRecord.last_seen_at
      periodSource = dailyRecord.source
    }
    if (hasBookings && bookings.items.length > 0) {
      const latestCons = bookings.items[0]
      if (!periodLastSeen || new Date(latestCons.created_at) > new Date(periodLastSeen)) {
        periodLastSeen = latestCons.created_at
        periodSource = latestCons.via_terminal ? 'terminal' : 'app'
      }
    }
    if (isProfileSeenInPeriod && p.last_seen_at) {
      if (!periodLastSeen || new Date(p.last_seen_at) > new Date(periodLastSeen)) {
        periodLastSeen = p.last_seen_at
        periodSource = p.last_seen_source || 'app'
      }
    }

    return {
      wasActive,
      lastSeenAt: periodLastSeen,
      source: periodSource,
    }
  }

  // Präsenz-Liste filtern
  const filteredPresenceProfiles = useMemo(() => {
    return profiles.filter((p) => {
      const activity = getUserPeriodActivity(p)

      // Filter: offline vs online vs all
      if (presenceFilter === 'offline' && activity.wasActive) return false
      if (presenceFilter === 'online' && !activity.wasActive) return false

      // Suche
      if (presenceSearch.trim()) {
        const name = getDisplayName(p).toLowerCase()
        if (!name.includes(presenceSearch.toLowerCase())) return false
      }

      return true
    })
  }, [profiles, presenceFilter, presenceSearch, periodFrom, periodTo, userBookingsInPeriod, dailyActivityMap])

  // Journal filtern
  const filteredJournal = useMemo(() => {
    return consumptions.filter((c) => {
      const userName = getDisplayName(c.profiles || {}).toLowerCase()
      const drinkName = (c.drinks?.name || '').toLowerCase()

      if (journalSearch.trim()) {
        const query = journalSearch.toLowerCase()
        if (!userName.includes(query) && !drinkName.includes(query)) return false
      }

      if (journalDrinkFilter !== 'all' && c.drinks?.name !== journalDrinkFilter) {
        return false
      }

      if (journalChannelFilter === 'terminal' && !c.via_terminal) return false
      if (journalChannelFilter === 'app' && c.via_terminal) return false

      const isCrateProvision = c.source === 'crate' && (c.quantity || 0) === 0
      const isFree = (c.unit_price_cents || 0) === 0 || c.source === 'free'

      if (journalTypeFilter === 'free' && (!isFree || isCrateProvision)) return false
      if (journalTypeFilter === 'crate' && !isCrateProvision && c.source !== 'crate') return false
      if (journalTypeFilter === 'paid' && (isFree || isCrateProvision)) return false

      return true
    })
  }, [consumptions, journalSearch, journalDrinkFilter, journalChannelFilter, journalTypeFilter])

  // KPI-Berechnungen
  const stats = useMemo(() => {
    const totalUsers = profiles.length
    const onlineUsersCount = profiles.filter((p) => getUserPeriodActivity(p).wasActive).length
    const offlineUsersCount = totalUsers - onlineUsersCount

    let totalDrinks = 0
    let freeDrinks = 0
    let terminalBookings = 0
    let appBookings = 0
    let totalCents = 0

    for (const c of consumptions) {
      const qty = c.quantity || 0
      const price = c.unit_price_cents || 0
      const isCrateProvision = c.source === 'crate' && qty === 0

      totalDrinks += qty
      if (c.via_terminal) terminalBookings += qty || 1
      else appBookings += qty || 1

      if (c.source === 'free' || price === 0) {
        freeDrinks += qty
      } else if (isCrateProvision) {
        totalCents += price
      } else {
        totalCents += qty * price
      }
    }

    return {
      totalUsers,
      onlineUsersCount,
      offlineUsersCount,
      totalDrinks,
      freeDrinks,
      terminalBookings,
      appBookings,
      totalCents,
    }
  }, [profiles, consumptions, periodFrom, periodTo])

  // Buchung stornieren / löschen (inkl. Guthaben-Rückerstattung)
  const handleDeleteBooking = (c: ConsumptionEntry) => {
    const isCrateProvision = c.source === 'crate' && (c.quantity || 0) === 0
    let amount = (c.unit_price_cents || 0) * (c.quantity || 0)
    if (isCrateProvision) amount = c.unit_price_cents || 0
    const isFree = amount === 0

    const userName = getDisplayName(c.profiles || {})
    const drinkName = c.drinks?.name || 'Getränk'

    let message = `Soll die Buchung von ${userName} (${c.quantity}x ${drinkName}) vom ${new Date(
      c.created_at
    ).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr gelöscht werden?`

    if (!isFree) {
      message += `\n\nDem Nutzer werden ${formatEuro(amount)} wieder gutgeschrieben.`
    }

    setPopup({
      title: 'Buchung stornieren',
      message,
      onConfirm: async () => {
        const { error: delErr } = await supabase.from('consumptions').delete().eq('id', c.id)
        if (delErr) {
          addToast('Fehler beim Löschen der Buchung', 'error')
          return
        }

        if (!isFree) {
          const { error: balErr } = await supabase.rpc('increment_balance', {
            user_id_input: c.user_id,
            amount_input: -amount,
          })
          if (balErr) console.error('Refund error', balErr)
        }

        addToast('Buchung erfolgreich storniert ✅')
        setPopup(null)
        fetchData()
      },
    })
  }

  // Formatierungs-Helfer für "Zuletzt online"
  const formatLastSeen = (iso: string | null | undefined) => {
    if (!iso) return { label: 'Noch nie', color: 'text-neutral-500', isRecent: false }
    const date = new Date(iso)
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - date.getTime()) / (1000 * 60))
    const diffHours = Math.floor(diffMin / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMin < 10) {
      return { label: 'Jetzt online 🟢', color: 'text-emerald-400 font-semibold', isRecent: true }
    }
    if (diffMin < 60) {
      return { label: `Vor ${diffMin} Min.`, color: 'text-emerald-300', isRecent: true }
    }

    const isToday = now.toDateString() === date.toDateString()
    if (isToday) {
      const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      return { label: `Heute, ${timeStr} Uhr`, color: 'text-emerald-200', isRecent: true }
    }

    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (yesterday.toDateString() === date.toDateString()) {
      const timeStr = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      return { label: `Gestern, ${timeStr} Uhr`, color: 'text-amber-300', isRecent: false }
    }

    if (diffDays < 7) {
      return { label: `Vor ${diffDays} Tagen`, color: 'text-neutral-400', isRecent: false }
    }

    return {
      label: date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
      color: 'text-neutral-500',
      isRecent: false,
    }
  }

  const formatLastBooking = (iso: string | undefined) => {
    if (!iso) return 'Keine'
    const date = new Date(iso)
    const now = new Date()
    if (now.toDateString() === date.toDateString()) {
      return `Heute, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
    }
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white pb-24 pt-14">
      <TopNav />
      <AdminNav />

      {/* 🔹 Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={`px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border backdrop-blur-md pointer-events-auto ${
                t.type === 'error'
                  ? 'bg-red-950/90 border-red-800 text-red-200'
                  : 'bg-green-950/90 border-green-800 text-green-200'
              }`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* 🔹 Hinweis falls SQL Spalte noch nicht angelegt */}
        {dbColumnMissing && (
          <div className="p-4 rounded-xl bg-amber-900/30 border border-amber-600/50 text-amber-200 flex items-start gap-3 text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Hinweis zur Online-Präsenz:</span> Das Feld{' '}
              <code className="bg-black/40 px-1 py-0.5 rounded text-xs font-mono">last_seen_at</code> wurde in der
              Supabase-Tabelle <code className="bg-black/40 px-1 py-0.5 rounded text-xs font-mono">profiles</code> noch
              nicht gefunden. Bitte führe das SQL-Skript im Supabase SQL Editor aus, damit der Online-Status live
              getrackt wird.
            </div>
          </div>
        )}

        {/* 🔹 Header & Zeitfilter */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span>📡 Live-Monitor & Buchungsjournal</span>
            </h1>
            <p className="text-xs text-neutral-400 mt-1">
              Präsenz-Check (Wer war da / wer war NICHT online?) und lückenlose Buchungskontrolle.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Zeitraum Buttons */}
            <div className="flex items-center gap-1 bg-neutral-900 p-1 rounded-xl border border-neutral-800">
              {(
                [
                  { id: 'today', label: 'Heute' },
                  { id: 'yesterday', label: 'Gestern' },
                  { id: 'week', label: '7 Tage' },
                  { id: 'month', label: 'Monat' },
                  { id: 'custom', label: 'Frei' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setTimeframe(preset.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    timeframe === preset.id
                      ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Refresh Button */}
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 rounded-xl bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-neutral-300 hover:text-white transition"
              title="Aktualisieren"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-green-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Freie Datumswahl wenn 'custom' */}
        {timeframe === 'custom' && (
          <div className="flex items-center gap-4 bg-neutral-900/80 p-3 rounded-xl border border-neutral-800 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-neutral-400">Von:</span>
              <input
                type="date"
                value={customRange.from}
                onChange={(e) => setCustomRange((p) => ({ ...p, from: e.target.value }))}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-neutral-400">Bis:</span>
              <input
                type="date"
                value={customRange.to}
                onChange={(e) => setCustomRange((p) => ({ ...p, to: e.target.value }))}
                className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-white text-xs"
              />
            </div>
          </div>
        )}

        {/* 🔹 KPI Kacheln */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {/* Karte 1: Online Quote */}
          <div
            onClick={() => {
              setActiveTab('presence')
              setPresenceFilter('online')
            }}
            className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
              <span>🟢 Online im Zeitraum</span>
              <UserCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400">
              {stats.onlineUsersCount}{' '}
              <span className="text-xs text-neutral-400 font-normal">
                von {stats.totalUsers} ({stats.totalUsers > 0 ? Math.round((stats.onlineUsersCount / stats.totalUsers) * 100) : 0}%)
              </span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-1">In der App oder am Terminal</div>
          </div>

          {/* Karte 2: NICHT Online (Alarm) */}
          <div
            onClick={() => {
              setActiveTab('presence')
              setPresenceFilter('offline')
            }}
            className="p-4 rounded-2xl bg-neutral-900/60 border border-red-900/30 hover:border-red-800/60 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
              <span className="text-red-300 font-medium">🚨 NICHT online</span>
              <UserX className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-2xl font-bold text-red-400">{stats.offlineUsersCount}</div>
            <div className="text-[11px] text-red-400/80 mt-1">Gar nicht erst eingeloggt</div>
          </div>

          {/* Karte 3: Getränke verbucht */}
          <div
            onClick={() => setActiveTab('journal')}
            className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
              <span>🍺 Verbuchte Getränke</span>
              <Beer className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-400">
              {stats.totalDrinks} <span className="text-xs text-neutral-400 font-normal">Stk.</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-1">
              {stats.freeDrinks} Freibier • {formatEuro(stats.totalCents)} Umsatz
            </div>
          </div>

          {/* Karte 4: Kanal Verteilung */}
          <div
            onClick={() => setActiveTab('journal')}
            className="p-4 rounded-2xl bg-neutral-900/60 border border-neutral-800/80 hover:border-neutral-700 transition cursor-pointer"
          >
            <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
              <span>📱/📟 Buchungskanal</span>
              <Smartphone className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-xl font-bold text-blue-400 flex items-center gap-3">
              <span>{stats.appBookings}× 📱</span>
              <span className="text-neutral-600">/</span>
              <span className="text-purple-400">{stats.terminalBookings}× 📟</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-1">Handy vs. Sportheim-Terminal</div>
          </div>
        </div>

        {/* 🔹 Hauptansicht Switcher (Reiter) */}
        <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('presence')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                activeTab === 'presence'
                  ? 'bg-neutral-800 text-white border border-neutral-700 shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
              }`}
            >
              <UserCheck className="w-4 h-4 text-emerald-400" />
              <span>Präsenz & Online-Check</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-700 text-neutral-300">
                {presenceFilter === 'offline'
                  ? `${stats.offlineUsersCount} inaktiv`
                  : presenceFilter === 'online'
                  ? `${stats.onlineUsersCount} online`
                  : profiles.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('journal')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                activeTab === 'journal'
                  ? 'bg-neutral-800 text-white border border-neutral-700 shadow'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900'
              }`}
            >
              <Beer className="w-4 h-4 text-amber-400" />
              <span>Buchungsjournal</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-neutral-700 text-neutral-300">
                {consumptions.length} Buchungen
              </span>
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 🔹 TAB 1: PRÄSENZ & WER WAR NICHT ONLINE?                                */}
        {/* ========================================================================= */}
        {activeTab === 'presence' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Filter-Leiste für Präsenz */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-neutral-900/60 p-3 rounded-2xl border border-neutral-800">
              {/* Pill Filter: Offline vs Online vs Alle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPresenceFilter('offline')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                    presenceFilter === 'offline'
                      ? 'bg-red-950/80 border border-red-800/80 text-red-200 shadow'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                  }`}
                >
                  <UserX className="w-3.5 h-3.5 text-red-400" />
                  <span>🚨 NICHT online ({stats.offlineUsersCount})</span>
                </button>

                <button
                  onClick={() => setPresenceFilter('online')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                    presenceFilter === 'online'
                      ? 'bg-emerald-950/80 border border-emerald-800/80 text-emerald-200 shadow'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>🟢 Online gewesen ({stats.onlineUsersCount})</span>
                </button>

                <button
                  onClick={() => setPresenceFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    presenceFilter === 'all'
                      ? 'bg-neutral-800 text-white border border-neutral-700'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                  }`}
                >
                  Alle ({profiles.length})
                </button>
              </div>

              {/* Suchfeld */}
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Spieler suchen..."
                  value={presenceSearch}
                  onChange={(e) => setPresenceSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 rounded-xl bg-neutral-800/90 border border-neutral-700/80 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-green-500 w-full sm:w-56"
                />
              </div>
            </div>

            {/* Spieler-Tabelle */}
            <div className="bg-neutral-900/60 rounded-2xl border border-neutral-800 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-neutral-900/90 border-b border-neutral-800 text-neutral-400 uppercase text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Spieler</th>
                      <th className="py-3 px-4">Zuletzt online</th>
                      <th className="py-3 px-4">Kanal</th>
                      <th className="py-3 px-4">Buchungen im Zeitraum</th>
                      <th className="py-3 px-4">Letzte Buchung überhaupt</th>
                      <th className="py-3 px-4 text-right">Offener Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60">
                    {filteredPresenceProfiles.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-neutral-500 text-sm">
                          Keine Spieler für diesen Filter gefunden.
                        </td>
                      </tr>
                    ) : (
                      filteredPresenceProfiles.map((p) => {
                        const activity = getUserPeriodActivity(p)
                        const wasOnline = activity.wasActive
                        const seenInfo = wasOnline ? formatLastSeen(activity.lastSeenAt) : formatLastSeen(p.last_seen_at)
                        const activeChannel = wasOnline ? activity.source : p.last_seen_source
                        const bookings = userBookingsInPeriod[p.id]
                        const totalQty = bookings?.totalQty || 0
                        const lastBookingDate = allLastBookings[p.id]

                        return (
                          <tr
                            key={p.id}
                            className={`hover:bg-neutral-800/40 transition ${
                              !wasOnline ? 'bg-red-950/5' : ''
                            }`}
                          >
                            {/* Name & Avatar */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                    wasOnline
                                      ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50'
                                      : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                                  }`}
                                >
                                  {(p.first_name?.[0] || p.name?.[0] || '?').toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-semibold text-neutral-200">{getDisplayName(p)}</div>
                                </div>
                              </div>
                            </td>

                            {/* Zuletzt online Status */}
                            <td className="py-3 px-4">
                              {wasOnline ? (
                                <div className="flex items-center gap-2">
                                  <span className={seenInfo.color}>{seenInfo.label}</span>
                                </div>
                              ) : (
                                <div>
                                  <span className="text-red-400 font-medium">Nicht im Zeitraum</span>
                                  <div className="text-[11px] text-neutral-500">Zul. {seenInfo.label}</div>
                                </div>
                              )}
                            </td>

                            {/* Kanal */}
                            <td className="py-3 px-4">
                              {activeChannel === 'terminal' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-purple-950/60 border border-purple-800/50 text-purple-300">
                                  <Monitor className="w-3 h-3" /> Terminal
                                </span>
                              ) : activeChannel === 'app' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-blue-950/60 border border-blue-800/50 text-blue-300">
                                  <Smartphone className="w-3 h-3" /> Handy
                                </span>
                              ) : (
                                <span className="text-neutral-500">—</span>
                              )}
                            </td>

                            {/* Buchungen im Zeitraum */}
                            <td className="py-3 px-4">
                              {totalQty > 0 ? (
                                <div className="space-y-1">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-950/60 border border-emerald-800/60 text-emerald-300">
                                    <CheckCircle2 className="w-3 h-3" /> {totalQty} Getränk{totalQty > 1 ? 'e' : ''}
                                  </span>
                                  <div className="text-[11px] text-neutral-400">
                                    {Object.entries(bookings.drinksSummary)
                                      .map(([d, q]) => `${q}× ${d}`)
                                      .join(', ')}
                                  </div>
                                </div>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-800/60 text-neutral-400 border border-neutral-700/60">
                                  0 Buchungen
                                </span>
                              )}
                            </td>

                            {/* Letzte Buchung überhaupt */}
                            <td className="py-3 px-4 text-xs text-neutral-400">
                              {formatLastBooking(lastBookingDate)}
                            </td>

                            {/* Offener Saldo */}
                            <td className="py-3 px-4 text-right">
                              <span
                                className={`font-semibold text-xs sm:text-sm ${
                                  (p.open_balance_cents || 0) > 0
                                    ? 'text-red-400'
                                    : (p.open_balance_cents || 0) < 0
                                    ? 'text-emerald-400'
                                    : 'text-neutral-400'
                                }`}
                              >
                                {formatEuro(p.open_balance_cents)}
                              </span>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 🔹 TAB 2: BUCHUNGSJOURNAL (WAS WURDE WIE VERBUCHT?)                       */}
        {/* ========================================================================= */}
        {activeTab === 'journal' && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* Filterleiste für Journal */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-900/60 p-3 rounded-2xl border border-neutral-800">
              <div className="flex flex-wrap items-center gap-2">
                {/* Typ-Filter */}
                <select
                  value={journalTypeFilter}
                  onChange={(e) => setJournalTypeFilter(e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="all">Alle Typen</option>
                  <option value="paid">Nur Kauf (Bezahlt)</option>
                  <option value="free">Nur Freibier</option>
                  <option value="crate">Nur Kistenspende</option>
                </select>

                {/* Kanal-Filter */}
                <select
                  value={journalChannelFilter}
                  onChange={(e) => setJournalChannelFilter(e.target.value as any)}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="all">Alle Kanäle</option>
                  <option value="app">Nur Handy-App 📱</option>
                  <option value="terminal">Nur Terminal 📟</option>
                </select>

                {/* Getränke-Filter */}
                <select
                  value={journalDrinkFilter}
                  onChange={(e) => setJournalDrinkFilter(e.target.value)}
                  className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                >
                  <option value="all">Alle Getränke</option>
                  {drinks.map((d) => (
                    <option key={d.id} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Spieler Suche */}
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Spieler oder Getränk..."
                  value={journalSearch}
                  onChange={(e) => setJournalSearch(e.target.value)}
                  className="pl-9 pr-3 py-1.5 rounded-xl bg-neutral-800/90 border border-neutral-700/80 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-green-500 w-full sm:w-56"
                />
              </div>
            </div>

            {/* Buchungstabelle */}
            <div className="bg-neutral-900/60 rounded-2xl border border-neutral-800 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-neutral-900/90 border-b border-neutral-800 text-neutral-400 uppercase text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Zeitpunkt</th>
                      <th className="py-3 px-4">Spieler</th>
                      <th className="py-3 px-4">Getränk & Menge</th>
                      <th className="py-3 px-4">Typ</th>
                      <th className="py-3 px-4">Kanal</th>
                      <th className="py-3 px-4 text-right">Betrag</th>
                      <th className="py-3 px-4 text-center">Aktion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60">
                    {filteredJournal.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-neutral-500 text-sm">
                          Keine Buchungen im ausgewählten Zeitraum gefunden.
                        </td>
                      </tr>
                    ) : (
                      filteredJournal.map((c) => {
                        const isCrateProvision = c.source === 'crate' && (c.quantity || 0) === 0
                        const isFree = (c.unit_price_cents || 0) === 0 || c.source === 'free'
                        const price = c.unit_price_cents || 0
                        const totalCents = isCrateProvision ? price : price * (c.quantity || 0)

                        const timeObj = new Date(c.created_at)
                        const timeStr = timeObj.toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                        const dateStr = timeObj.toLocaleDateString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                        })

                        return (
                          <tr key={c.id} className="hover:bg-neutral-800/40 transition">
                            {/* Datum & Uhrzeit */}
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="font-semibold text-neutral-200">{timeStr} Uhr</div>
                              <div className="text-[11px] text-neutral-500">{dateStr}</div>
                            </td>

                            {/* Spieler */}
                            <td className="py-3 px-4 font-medium text-neutral-200">
                              {getDisplayName(c.profiles || {})}
                            </td>

                            {/* Getränk & Menge */}
                            <td className="py-3 px-4">
                              <span className="font-semibold text-white">
                                {isCrateProvision ? '1 Kiste' : `${c.quantity}×`}{' '}
                              </span>
                              <span className="text-neutral-300">{c.drinks?.name || 'Unbekannt'}</span>
                            </td>

                            {/* Typ */}
                            <td className="py-3 px-4">
                              {isCrateProvision ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-purple-950/60 border border-purple-800/50 text-purple-300 font-medium">
                                  🎁 Kistenspende
                                </span>
                              ) : isFree ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-emerald-950/60 border border-emerald-800/50 text-emerald-300 font-medium">
                                  ✨ Freibier
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-neutral-800 border border-neutral-700 text-neutral-300 font-medium">
                                  💶 Kauf
                                </span>
                              )}
                            </td>

                            {/* Kanal */}
                            <td className="py-3 px-4">
                              {c.via_terminal ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-purple-950/40 text-purple-300 border border-purple-800/40">
                                  <Monitor className="w-3 h-3" /> Terminal
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-blue-950/40 text-blue-300 border border-blue-800/40">
                                  <Smartphone className="w-3 h-3" /> Handy
                                </span>
                              )}
                            </td>

                            {/* Betrag */}
                            <td className="py-3 px-4 text-right font-semibold">
                              {isFree ? (
                                <span className="text-emerald-400">0,00 €</span>
                              ) : (
                                <span className="text-white">{formatEuro(totalCents)}</span>
                              )}
                            </td>

                            {/* Storno / Löschen */}
                            <td className="py-3 px-4 text-center">
                              <button
                                onClick={() => handleDeleteBooking(c)}
                                className="p-1.5 rounded-lg hover:bg-red-950/80 text-neutral-500 hover:text-red-400 transition"
                                title="Buchung stornieren / löschen"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 🔹 Bestätigungs-Popup */}
      {popup && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <h3 className="text-lg font-bold text-white">{popup.title}</h3>
            <p className="text-sm text-neutral-300 whitespace-pre-line leading-relaxed">{popup.message}</p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setPopup(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition"
              >
                Abbrechen
              </button>
              <button
                onClick={popup.onConfirm}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-red-600 hover:bg-red-500 text-white shadow-lg transition"
              >
                Stornieren & Erstatten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
