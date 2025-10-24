'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase-browser'

type Drink = {
  id: number
  name: string
  price_cents: number
  crate_price_cents: number
}

type Profile = {
  id: string
  first_name: string
  last_name: string
  pin: string
  open_balance_cents: number
}

const euro = (c: number) => (c / 100).toFixed(2) + ' €'
const BOTTLES_PER_CRATE = 20

// Lokales YYYY-MM-DD (ohne UTC-Shift)
const ymd = (d: Date) => {
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export default function TerminalPage() {
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)

  // Drinks & Infos
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string | null>(null)
  const [lastPayment, setLastPayment] = useState<{ date: string; amount: number } | null>(null)
  const [freeCrates, setFreeCrates] = useState<number>(0)
  const [toast, setToast] = useState<string | null>(null)

  // Popups & Sprüche
  type PopupType = null | 'booking' | 'crateInfo' | 'quote'
  const [popup, setPopup] = useState<PopupType>(null)
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null)
  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null)
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Uhr & Auto-Logout
  const [time, setTime] = useState('')
  const [timer, setTimer] = useState(60)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Platzbelegung
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})

  // Uhrzeit
  useEffect(() => {
    const update = () => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const i = setInterval(update, 60000)
    return () => clearInterval(i)
  }, [])

  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  // Drinks laden
  useEffect(() => {
    const loadDrinks = async () => {
      const { data, error } = await supabase.from('drinks').select('*').order('name')
      if (error) return console.error('Fehler Drinks:', error)
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // Platzbelegung Montag–Sonntag, vergangene Tage ausblenden (lokale Datumslogik)
  useEffect(() => {
    const loadPlatzbelegung = async () => {
      const monday = startOfWeekMonday()
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const today = ymd(new Date())

      const { data, error } = await supabase
        .from('platzbelegung')
        .select('*')
        .gte('date', ymd(monday))
        .lte('date', ymd(sunday))
        .order('date', { ascending: true })
        .order('time', { ascending: true })

      if (error) return console.error('Fehler Platzbelegung:', error)

      const grouped: Record<string, any[]> = {}
      for (const e of data ?? []) {
        if ((e.date as string) < today) continue // Vergangenes verstecken
        const dayKey = new Date(e.date).toLocaleDateString('de-DE', {
          weekday: 'long', day: '2-digit', month: '2-digit',
        })
        if (!grouped[dayKey]) grouped[dayKey] = []
        grouped[dayKey].push(e)
      }
      setGroupedByDay(grouped)
    }
    loadPlatzbelegung()
  }, [])

  // Login
  const handleLogin = async (inputPin?: string) => {
    const input = (inputPin ?? pin).trim()
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, pin, open_balance_cents')
    if (error || !data) return setToast('⚠️ Fehler beim Abruf')

    const match = data.find((p: any) => String(p.pin).trim() === input)
    if (!match) {
      setToast('❌ Falscher PIN')
      setPin('')
      return
    }

    const u: Profile = {
      id: match.id,
      first_name: match.first_name,
      last_name: match.last_name,
      pin: match.pin,
      open_balance_cents: match.open_balance_cents ?? 0,
    }
    setUser(u)
    setPin('')
    setStep('overview')
    await Promise.all([loadMyWeekStats(u.id), loadFavoriteDrink(u.id), loadLastPayment(u.id), loadFreeCrates()])
  }

  // Auto-Login bei 6-stelliger Eingabe
  useEffect(() => { if (pin.length === 6) handleLogin(pin) }, [pin])

  const handleLogout = () => {
    // Spruch-Timer aufräumen, falls offen
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    setPopup(null)
    setQuote(null)

    setUser(null)
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
    setTimer(60)
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  }

  // Auto-Logout Countdown
  useEffect(() => {
    if (step === 'overview') {
      const countdown = setInterval(() => {
        setTimer((t) => {
          if (t <= 1) {
            clearInterval(countdown)
            handleLogout()
            return 0
          }
          return t - 1
        })
      }, 1000)
      const reset = () => setTimer(60)
      window.addEventListener('click', reset)
      window.addEventListener('keydown', reset)
      return () => {
        clearInterval(countdown)
        window.removeEventListener('click', reset)
        window.removeEventListener('keydown', reset)
      }
    }
  }, [step])

  // Stats
  const loadMyWeekStats = async (uid: string) => {
    const from = startOfWeekMonday()
    const { data, error } = await supabase
      .from('consumptions').select('quantity')
      .eq('user_id', uid).gte('created_at', from.toISOString())
    if (error) return console.error('Fehler WeekStats:', error)
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }

  const loadFavoriteDrink = async (uid: string) => {
    const { data, error } = await supabase
      .from('consumptions').select('quantity, drinks(name)').eq('user_id', uid)
    if (error) return console.error('Fehler Fav:', error)
    if (!data?.length) return setFavoriteDrink('—')
    const count: Record<string, number> = {}
    for (const r of data) {
      const name =
        (Array.isArray(r.drinks)
          ? r.drinks[0]?.name
          : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
      count[name] = (count[name] || 0) + (r.quantity || 0)
    }
    const fav = Object.entries(count).sort((a,b)=>b[1]-a[1])[0]
    setFavoriteDrink(fav ? fav[0] : '—')
  }

  const loadLastPayment = async (uid: string) => {
    const { data, error } = await supabase
      .from('payments').select('amount_cents, created_at')
      .eq('user_id', uid).order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    if (error) return console.error('Fehler LastPayment:', error)
    if (data) setLastPayment({ date: new Date(data.created_at).toLocaleDateString('de-DE'), amount: data.amount_cents / 100 })
  }

  // Freibier (Summe quantity_remaining)
  const loadFreeCrates = async () => {
    const { data, error } = await supabase
      .from('crates').select('quantity_remaining').eq('is_free', true)
    if (error) return console.error('Fehler Freibier:', error)
    const totalFree = (data ?? []).reduce((s, i) => s + (i.quantity_remaining || 0), 0)
    setFreeCrates(totalFree)
  }

  // ------------------- Buchungs-Flow -------------------

  // Einzel/Free Auswahl öffnen
  const openBookingPopup = (drink: Drink) => {
    setSelectedDrink(drink)
    setPopup('booking')
  }

  // Kisten-Info öffnen (neue Logik)
  const openCrateInfo = (drink: Drink) => {
    setSelectedDrink(drink)
    setPopup('crateInfo')
  }

  // Zitat beim Logout einblenden – 10s oder bis Klick
  const showLogoutQuote = async (forceGuenter = false) => {
    // Zufällige Sprüche (is_special=false) – außer Spezi: immer Günter
    if (forceGuenter) {
      setQuote({ text: 'Auf ein Spezi musst du 3 Bier trinken!', author: 'Günter Kropf' })
      setPopup('quote')
    } else {
      const { data, error } = await supabase
        .from('quotes').select('text, author').eq('is_special', false)
      if (!error && data && data.length > 0) {
        const q = data[Math.floor(Math.random() * data.length)]
        setQuote({ text: q.text, author: q.author })
      } else {
        setQuote({ text: 'Der Ball ist rund und das Spiel dauert 90 Minuten.', author: 'Sepp Herberger' })
      }
      setPopup('quote')
    }

    // 10 Sekunden, dann (falls nicht manuell geschlossen) Logout
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    quoteTimer.current = setTimeout(() => {
      setPopup(null)
      handleLogout()
    }, 10000)
  }

  // Quote sofort schließen & logout
  const dismissQuoteNow = () => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current)
    setPopup(null)
    handleLogout()
  }

  // Buchen
  const handleBooking = async (type: 'free' | 'buy' | 'crate') => {
    if (!user || !selectedDrink) return
    setPopup(null)

    const isCrate = type === 'crate'
    const isFree = type === 'free'
    const quantity = isCrate ? BOTTLES_PER_CRATE : 1
    const source: 'single' | 'crate' = isCrate ? 'crate' : 'single'
    const unit_price_cents = isFree ? 0 : (isCrate ? selectedDrink.crate_price_cents : selectedDrink.price_cents)

    if (isFree && freeCrates < quantity) {
      setToast('⚠️ Nicht genug Freibier verfügbar!')
      return
    }

    const { error } = await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: selectedDrink.id,
      quantity,
      unit_price_cents,
      source,
      crate_id: null,
    })
    if (error) {
      console.error('Buchung fehlgeschlagen:', error)
      setToast('❌ Buchung fehlgeschlagen')
      return
    }

    setToast('✅ Buchung erfolgreich!')
    if (isFree) await loadFreeCrates()

    // 5s warten → Spruch anzeigen → 10s oder Klick → Logout
    setTimeout(() => {
      // Spezi-Sonderfall: wenn der Drink Spezi ist (Name enthält „Spezi“), immer Günter
      const isSpezi = selectedDrink.name.toLowerCase().includes('spezi')
      showLogoutQuote(isSpezi)
    }, 5000)
  }

  // ------------------- UI -------------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>
          TSV Lonnerstadt • Herren-Terminal
          {user && <span className="ml-3 text-green-500 font-semibold">👤 {user.first_name} ({timer}s)</span>}
        </span>
      </header>

      {/* Hauptinhalt */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 h-[calc(100vh-3.5rem)]">

        {/* PIN */}
        {step === 'pin' && (
          <>
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto flex items-center justify-center">
              <div className="w-full max-w-sm mx-auto text-center">
                <h1 className="text-3xl font-semibold mb-8">🔒 PIN-Eingabe</h1>
                <div className="flex justify-center gap-3 mb-8">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? 'bg-white' : 'border-neutral-600'}`} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[1,2,3,4,5,6,7,8,9].map((n) => (
                    <button key={n} onClick={() => setPin((p) => (p + n).slice(0, 6))} className="h-14 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">{n}</button>
                  ))}
                  <div />
                  <button onClick={() => setPin((p) => (p + '0').slice(0, 6))} className="h-14 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">0</button>
                  <div />
                </div>
                <div className="flex justify-center">
                  <button onClick={() => setPin('')} className="px-6 py-2 bg-neutral-800 rounded-lg">Löschen</button>
                </div>
              </div>
            </div>

            {/* Platzbelegung */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <h2 className="text-xl font-semibold mb-3 text-center">📅 Platzbelegung dieser Woche</h2>
              {Object.keys(groupedByDay).length === 0 ? (
                <p className="text-neutral-500 text-center text-sm">Keine Belegung gefunden.</p>
              ) : (
                <div className="space-y-5">
                  {Object.entries(groupedByDay).map(([day, entries]) => (
                    <div key={day}>
                      <h3 className="text-lg font-semibold text-green-400 mb-2 border-b border-neutral-800 pb-1">{day}</h3>
                      {(entries as any[]).map((e) => (
                        <div key={e.id} className="border border-neutral-800 bg-neutral-950/50 rounded-lg p-3 mb-2">
                          <div className="flex justify-between">
                            <span className="text-green-400 font-bold">Platz {e.field}</span>
                            <span className="text-sm text-neutral-400">{e.time} Uhr</span>
                          </div>
                          <div className="text-sm text-neutral-200 font-medium">{e.team_home} vs. {e.team_guest}</div>
                          <div className="text-xs text-neutral-400">{e.competition} • {e.section}</div>
                          {e.location && <div className="text-xs text-neutral-500 mt-1">📍 {e.location}</div>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Übersicht */}
        {step === 'overview' && (
          <>
            {/* Links: Begrüßung + Karten */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
              <div className="text-center mb-4">
                <h1 className="text-3xl font-bold mb-1">Hallo {user?.first_name} {user?.last_name} 👋</h1>
                <p className="text-neutral-400 text-sm">Willkommen am Herren-Terminal</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FancyCard icon="💰" label="Kontostand" value={euro(user?.open_balance_cents ?? 0)} sub="Schulden" color="from-rose-900/80 to-rose-800/40" />
                <FancyCard icon="🍺" label="Gesamtverbrauch" value={`${myWeekTotal}`} sub="Becher / Flaschen" color="from-green-900/80 to-green-800/40" />
                <FancyCard icon="🎁" label="Freibier" value={`${freeCrates}`} sub="aktuell verfügbare Flaschen" color="from-purple-900/80 to-purple-800/40" />
                <FancyCard icon="💶" label="Letzte Zahlung" value={lastPayment ? `${lastPayment.amount.toFixed(2)} €` : '—'} sub={lastPayment ? lastPayment.date : ''} color="from-blue-900/80 to-blue-800/40" />
                <FancyCard icon="⭐" label="Lieblingsgetränk" value={favoriteDrink || '—'} color="from-amber-900/80 to-amber-800/40" />
              </div>
            </div>

            {/* Rechts: Getränke – Einzel & Kiste */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">🍻 Getränke verbuchen</h2>
                <button onClick={handleLogout} className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700">🔒 Logout</button>
              </div>

              <div className="space-y-2">
                {drinks.map((d) => (
                  <div key={d.id} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-neutral-500">{euro(d.price_cents)} / Stk • Kiste: {euro(d.crate_price_cents)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Einzel/Free Auswahl */}
                      <button onClick={() => openBookingPopup(d)} className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-sm font-medium">
                        📤 Einzel / Freibier
                      </button>
                      {/* Neue Kisten-Logik: eigener Button + Info-Popup */}
                      <button onClick={() => openCrateInfo(d)} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-sm font-medium">
                        🧊 Kiste kaufen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Popup: Einzel/Freibier Auswahl */}
      <AnimatePresence>
        {popup === 'booking' && selectedDrink && (
          <motion.div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center max-w-sm w-full">
              <h2 className="text-xl font-semibold mb-4">Wie möchtest du {selectedDrink.name} verbuchen?</h2>
              <div className="flex flex-col gap-3">
                {freeCrates > 0 && (
                  <button onClick={() => handleBooking('free')} className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded-lg text-white font-medium">🎁 Freibier</button>
                )}
                <button onClick={() => handleBooking('buy')} className="w-full bg-green-600 hover:bg-green-700 py-2 rounded-lg text-white font-medium">💰 Kaufen (Einzel)</button>
                <button onClick={() => setPopup(null)} className="w-full mt-1 text-sm text-neutral-400 hover:text-white">Abbrechen</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Popup: Kisten-Info (Kabine, kein Freibier-Abzug) */}
      <AnimatePresence>
        {popup === 'crateInfo' && selectedDrink && (
          <motion.div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center max-w-md w-full">
              <h3 className="text-lg font-semibold mb-3">🧊 Kiste {selectedDrink.name} kaufen</h3>
              <p className="text-sm text-neutral-300 mb-4">
                Diese Kiste ist dafür gedacht, nach dem Spiel oder Training in die Kabine zu stellen, damit sich jeder etwas nehmen kann.
                <br />
                <strong>Wichtig:</strong> Diese Menge wird <u>nicht</u> auf die Freibiermenge angerechnet – die Spieler müssen dafür nichts eintragen.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => handleBooking('crate')} className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-white font-medium">
                  ✅ Kiste kaufen ({euro(selectedDrink.crate_price_cents)})
                </button>
                <button onClick={() => setPopup(null)} className="w-full text-sm text-neutral-400 hover:text-white">Abbrechen</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spruch-Popup (beim Logout-Start) – 10s oder Klick */}
      <AnimatePresence>
        {popup === 'quote' && quote && (
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            onClick={dismissQuoteNow}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center max-w-md w-full">
              <p className="text-lg italic text-neutral-200 mb-2">„{quote.text}“</p>
              <p className="text-sm text-neutral-500">– {quote.author}</p>
              <p className="text-xs text-neutral-500 mt-3">Tippe, um fortzufahren …</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Karten-Komponente
function FancyCard({
  icon, label, value, sub, color,
}: { icon: string; label: string; value: string; sub?: string; color: string }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} className={`p-4 rounded-2xl bg-gradient-to-br ${color} text-white shadow-md flex flex-col justify-center`}>
      <div className="flex items-center gap-3 mb-2">
        <div className="text-3xl">{icon}</div>
        <div className="text-sm text-neutral-300">{label}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </motion.div>
  )
}
