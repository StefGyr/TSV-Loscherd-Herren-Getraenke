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

export default function TerminalPage() {
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)

  // Drinks & UI-Infos
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string | null>(null)
  const [lastPayment, setLastPayment] = useState<{ date: string; amount: number } | null>(null)
  const [freeCrates, setFreeCrates] = useState<number>(0) // Summe frei verfügbarer Flaschen
  const [toast, setToast] = useState<string | null>(null)

  // Buchungs-Popup & Zitate
  const [selectedDrink, setSelectedDrink] = useState<Drink | null>(null)
  const [popup, setPopup] = useState<null | 'booking' | 'quote'>(null)
  const [quote, setQuote] = useState<{ text: string; author: string } | null>(null)

  // Uhrzeit & Auto-Logout
  const [time, setTime] = useState('')
  const [timer, setTimer] = useState(60)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Platzbelegung (Woche)
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
      if (error) {
        console.error('Fehler beim Laden der Drinks:', error)
        return
      }
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // Platzbelegung laden (Montag–Sonntag, vergangene Tage ausblenden)
  useEffect(() => {
    const loadPlatzbelegung = async () => {
      const monday = startOfWeekMonday()
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const today = new Date().toISOString().split('T')[0]

      const { data, error } = await supabase
        .from('platzbelegung')
        .select('*')
        .gte('date', monday.toISOString().split('T')[0])
        .lte('date', sunday.toISOString().split('T')[0])
        .order('date', { ascending: true })
        .order('time', { ascending: true })

      if (error) {
        console.error('Fehler beim Laden der Platzbelegung:', error)
        return
      }

      const grouped: Record<string, any[]> = {}
      for (const e of data ?? []) {
        if (e.date < today) continue
        const day = new Date(e.date).toLocaleDateString('de-DE', {
          weekday: 'long',
          day: '2-digit',
          month: '2-digit',
        })
        if (!grouped[day]) grouped[day] = []
        grouped[day].push(e)
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
    await Promise.all([
      loadMyWeekStats(u.id),
      loadFavoriteDrink(u.id),
      loadLastPayment(u.id),
      loadFreeCrates(),
    ])
  }

  // Automatisch einloggen bei 6-stelliger Eingabe
  useEffect(() => {
    if (pin.length === 6) handleLogin(pin)
  }, [pin])

  const handleLogout = () => {
    setUser(null)
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
    setTimer(60)
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
  }

  // Auto-Logout Countdown (in Übersicht)
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
      .from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())
    if (error) {
      console.error('Fehler loadMyWeekStats:', error)
      return
    }
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }

  const loadFavoriteDrink = async (uid: string) => {
    const { data, error } = await supabase
      .from('consumptions')
      .select('quantity, drinks(name)')
      .eq('user_id', uid)
    if (error) {
      console.error('Fehler loadFavoriteDrink:', error)
      return
    }
    if (!data?.length) return setFavoriteDrink('—')
    const count: Record<string, number> = {}
    for (const r of data) {
      const name =
        (Array.isArray(r.drinks)
          ? r.drinks[0]?.name
          : (r.drinks as { name?: string } | null)?.name) || 'Unbekannt'
      count[name] = (count[name] || 0) + (r.quantity || 0)
    }
    const fav = Object.entries(count).sort((a, b) => b[1] - a[1])[0]
    setFavoriteDrink(fav ? fav[0] : '—')
  }

  const loadLastPayment = async (uid: string) => {
    const { data, error } = await supabase
      .from('payments')
      .select('amount_cents, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error('Fehler loadLastPayment:', error)
      return
    }
    if (data)
      setLastPayment({
        date: new Date(data.created_at).toLocaleDateString('de-DE'),
        amount: data.amount_cents / 100,
      })
  }

  // Summe verfügbarer FREI-Flaschen
  const loadFreeCrates = async () => {
    const { data, error } = await supabase
      .from('crates')
      .select('quantity_remaining')
      .eq('is_free', true)
    if (error) {
      console.error('Fehler beim Laden der Freibierdaten:', error)
      return
    }
    const totalFree = (data ?? []).reduce(
      (sum, item) => sum + (item.quantity_remaining || 0),
      0
    )
    setFreeCrates(totalFree)
  }

  // --- Buchungs-Flow ---
  const openBookingPopup = (drink: Drink) => {
    setSelectedDrink(drink)
    setPopup('booking')
  }

  const handleBooking = async (type: 'free' | 'buy' | 'crate') => {
    if (!user || !selectedDrink) return
    setPopup(null)

    const isCrate = type === 'crate'
    const isFree = type === 'free'

    const quantity = isCrate ? BOTTLES_PER_CRATE : 1
    const source: 'single' | 'crate' = isCrate ? 'crate' : 'single'
    const unit_price_cents = isFree
      ? 0
      : (isCrate ? selectedDrink.crate_price_cents : selectedDrink.price_cents)

    // Freibier prüfen
    if (isFree && freeCrates < quantity) {
      setToast('⚠️ Nicht genug Freibier verfügbar!')
      return
    }

    // Insert in consumptions
    const { error } = await supabase.from('consumptions').insert({
      user_id: user.id,
      drink_id: selectedDrink.id,
      quantity,
      unit_price_cents,
      source,
      crate_id: null, // dein Projekt-Setup verlangt explizit null
    })

    if (error) {
      console.error('Buchung fehlgeschlagen:', error)
      setToast('❌ Buchung fehlgeschlagen')
      return
    }

    setToast('✅ Buchung erfolgreich!')

    // Freibier neu laden (wenn Freibier gebucht wurde)
    if (isFree) await loadFreeCrates()

    // Zitat anzeigen
    await showRandomQuote(isFree)

    // 5 Sekunden später Logout
    setTimeout(() => handleLogout(), 5000)
  }

  const showRandomQuote = async (isFree: boolean) => {
    // is_special: true => für Spezi/Freibier (z. B. Günter Kropf)
    const { data, error } = await supabase
      .from('quotes')
      .select('text, author')
      .eq('is_special', isFree)

    if (!error && data && data.length > 0) {
      const q = data[Math.floor(Math.random() * data.length)]
      setQuote({ text: q.text, author: q.author })
    } else {
      // Fallbacks
      setQuote({
        text: isFree
          ? 'Auf ein Spezi musst du 3 Bier trinken!'
          : 'Der Ball ist rund und das Spiel dauert 90 Minuten.',
        author: isFree ? 'Günter Kropf' : 'Sepp Herberger',
      })
    }
    setPopup('quote')
  }

  // --- UI ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      {/* Header */}
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>
          TSV Lonnerstadt • Herren-Terminal
          {user && (
            <span className="ml-3 text-green-500 font-semibold">
              👤 {user.first_name} ({timer}s)
            </span>
          )}
        </span>
      </header>

      {/* Hauptinhalt */}
      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-6 h-[calc(100vh-3.5rem)]">

        {/* 🔐 PIN-Seite */}
        {step === 'pin' && (
          <>
            {/* Links: PIN-Feld */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto flex items-center justify-center">
              <div className="w-full max-w-sm mx-auto text-center">
                <h1 className="text-3xl font-semibold mb-8">🔒 PIN-Eingabe</h1>
                <div className="flex justify-center gap-3 mb-8">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-5 h-5 rounded-full border-2 ${
                        i < pin.length ? 'bg-white' : 'border-neutral-600'
                      }`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[1,2,3,4,5,6,7,8,9].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPin((p) => (p + n).slice(0, 6))}
                      className="h-14 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl"
                    >
                      {n}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => setPin((p) => (p + '0').slice(0, 6))}
                    className="h-14 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl"
                  >
                    0
                  </button>
                  <div />
                </div>
                <div className="flex justify-center">
                  <button
                    onClick={() => setPin('')}
                    className="px-6 py-2 bg-neutral-800 rounded-lg"
                  >
                    Löschen
                  </button>
                </div>
              </div>
            </div>

            {/* Rechts: Platzbelegung */}
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
                          <div className="text-sm text-neutral-200 font-medium">
                            {e.team_home} vs. {e.team_guest}
                          </div>
                          <div className="text-xs text-neutral-400">
                            {e.competition} • {e.section}
                          </div>
                          {e.location && (
                            <div className="text-xs text-neutral-500 mt-1">📍 {e.location}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ✅ Übersicht nach Login */}
        {step === 'overview' && (
          <>
            {/* Links: Begrüßung & InfoCards */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
              <div className="text-center mb-4">
                <h1 className="text-3xl font-bold mb-1">
                  Hallo {user?.first_name} {user?.last_name} 👋
                </h1>
                <p className="text-neutral-400 text-sm">Willkommen am Herren-Terminal</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FancyCard
                  icon="💰"
                  label="Kontostand"
                  value={euro(user?.open_balance_cents ?? 0)}
                  sub="Schulden"
                  color="from-rose-900/80 to-rose-800/40"
                />
                <FancyCard
                  icon="🍺"
                  label="Gesamtverbrauch"
                  value={`${myWeekTotal}`}
                  sub="Becher / Flaschen"
                  color="from-green-900/80 to-green-800/40"
                />
                <FancyCard
                  icon="🎁"
                  label="Freibier"
                  value={`${freeCrates}`}
                  sub="aktuell verfügbare Flaschen"
                  color="from-purple-900/80 to-purple-800/40"
                />
                <FancyCard
                  icon="💶"
                  label="Letzte Zahlung"
                  value={lastPayment ? `${lastPayment.amount.toFixed(2)} €` : '—'}
                  sub={lastPayment ? lastPayment.date : ''}
                  color="from-blue-900/80 to-blue-800/40"
                />
                <FancyCard
                  icon="⭐"
                  label="Lieblingsgetränk"
                  value={favoriteDrink || '—'}
                  color="from-amber-900/80 to-amber-800/40"
                />
              </div>
            </div>

            {/* Rechts: Getränke & Buchung */}
            <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">🍻 Getränke verbuchen</h2>
                <button
                  onClick={handleLogout}
                  className="text-sm px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700"
                >
                  🔒 Logout
                </button>
              </div>

              <div className="space-y-2">
                {drinks.map((d) => (
                  <div
                    key={d.id}
                    className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex justify-between items-center"
                  >
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-neutral-500">{euro(d.price_cents)} / Stk</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* lokale +/- Menge optional beibehalten */}
                      <button
                        onClick={() =>
                          setDrinks((prev) =>
                            prev.map((x) =>
                              x.id === d.id ? { ...x, qty: Math.max(0, x.qty - 1) } : x
                            )
                          )
                        }
                        className="w-9 h-9 bg-neutral-800 rounded-lg text-xl"
                      >
                        –
                      </button>
                      <span className="w-6 text-center">{d.qty}</span>
                      <button
                        onClick={() =>
                          setDrinks((prev) =>
                            prev.map((x) =>
                              x.id === d.id ? { ...x, qty: x.qty + 1 } : x
                            )
                          )
                        }
                        className="w-9 h-9 bg-neutral-800 rounded-lg text-xl"
                      >
                        +
                      </button>

                      <button
                        onClick={() => openBookingPopup(d)}
                        className="px-5 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-sm font-medium"
                      >
                        📤 Jetzt verbuchen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ✅ Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 💬 Buchungs-Popup */}
      <AnimatePresence>
        {popup === 'booking' && selectedDrink && (
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center max-w-sm w-full">
              <h2 className="text-xl font-semibold mb-4">
                Wie möchtest du {selectedDrink.name} verbuchen?
              </h2>
              <div className="flex flex-col gap-3">
                {freeCrates > 0 && (
                  <button
                    onClick={() => handleBooking('free')}
                    className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded-lg text-white font-medium"
                  >
                    🎁 Freibier
                  </button>
                )}
                <button
                  onClick={() => handleBooking('buy')}
                  className="w-full bg-green-600 hover:bg-green-700 py-2 rounded-lg text-white font-medium"
                >
                  💰 Kaufen
                </button>
                <button
                  onClick={() => handleBooking('crate')}
                  className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-white font-medium"
                >
                  🧊 Kiste kaufen
                </button>
                <button
                  onClick={() => setPopup(null)}
                  className="w-full mt-3 text-sm text-neutral-400 hover:text-white"
                >
                  Abbrechen
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ⚽ Fußballer-Spruch-Popup */}
      <AnimatePresence>
        {popup === 'quote' && quote && (
          <motion.div
            className="fixed inset-0 bg_black/70 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-6 text-center max-w-md w-full">
              <p className="text-lg italic text-neutral-200 mb-2">„{quote.text}“</p>
              <p className="text-sm text-neutral-500">– {quote.author}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// 🎨 Info-Karte (wie Profil-Seite)
function FancyCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: string
  label: string
  value: string
  sub?: string
  color: string
}) {
  return (
    <motion.div
      whileHover={{ scale: 1.03 }}
      className={`p-4 rounded-2xl bg-gradient-to-br ${color} text-white shadow-md flex flex-col justify-center`}
    >
      <div className="flex items-center gap-3 mb-2">
        <div className="text-3xl">{icon}</div>
        <div className="text-sm text-neutral-300">{label}</div>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-neutral-400 mt-1">{sub}</div>}
    </motion.div>
  )
}
