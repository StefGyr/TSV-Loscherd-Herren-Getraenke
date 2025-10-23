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

const BOTTLES_PER_CRATE = 20
const euro = (c: number) => (c / 100).toFixed(2) + ' €'

export default function TerminalPage() {
  const [step, setStep] = useState<'pin' | 'overview'>('pin')
  const [pin, setPin] = useState('')
  const [user, setUser] = useState<Profile | null>(null)
  const [drinks, setDrinks] = useState<(Drink & { qty: number })[]>([])
  const [selectedCrateDrink, setSelectedCrateDrink] = useState<number>(0)
  const [myWeekTotal, setMyWeekTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string | null>(null)
  const [lastPayment, setLastPayment] = useState<{ date: string; amount: number } | null>(null)
  const [freeCrates, setFreeCrates] = useState<number>(0)
  const [toast, setToast] = useState<string | null>(null)
  const [popup, setPopup] = useState<any>(null)
  const [groupedByDay, setGroupedByDay] = useState<Record<string, any[]>>({})
  const [time, setTime] = useState('')
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadingInfo, setLoadingInfo] = useState(true)

  // --- Uhrzeit ---
  useEffect(() => {
    const update = () => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`)
    }
    update()
    const i = setInterval(update, 60000)
    return () => clearInterval(i)
  }, [])

  // --- Wochenstart (Montag 00:00) ---
  const startOfWeekMonday = () => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    const res = new Date(d.setDate(diff))
    res.setHours(0, 0, 0, 0)
    return res
  }

  // --- Platzbelegung (für PIN-Seite) ---
  useEffect(() => {
  const loadPlatzbelegung = async () => {
    const start = startOfWeekMonday()
    const end = new Date(start)
    end.setDate(start.getDate() + 7)
    end.setHours(23, 59, 59, 999)

    const { data, error } = await supabase
      .from('platzbelegung')
      .select('id, date, time, team_home, team_guest, competition, section, field, location')
      .gte('date', start.toISOString().split('T')[0])
      .lte('date', end.toISOString().split('T')[0])
      .order('date', { ascending: true })

    if (error) return console.error('Fehler beim Laden der Platzbelegung:', error)

    const grouped: Record<string, any[]> = {}

    for (const e of data ?? []) {
      const label = new Date(e.date).toLocaleDateString('de-DE', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      })

      if (!grouped[label]) grouped[label] = []

      grouped[label].push({
        id: e.id,
        date: e.date,
        time: e.time,
        field: e.field,
        location: e.location,
        match: `${e.team_home ?? ''} ${e.team_guest ?? ''}`.trim(),
        competition: e.competition,
        section: e.section,
      })
    }

    setGroupedByDay(grouped)
  }

  loadPlatzbelegung()
}, [])


  // --- Drinks laden ---
  useEffect(() => {
    const loadDrinks = async () => {
      const { data } = await supabase.from('drinks').select('*').order('name')
      setDrinks((data ?? []).map((d: any) => ({ ...d, qty: 0 })))
    }
    loadDrinks()
  }, [])

  // --- Login ---
  const handleLogin = async () => {
    const input = pin.trim()
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
    setLoadingInfo(false)
  }

  // --- Logout ---
  const handleLogout = () => {
    setUser(null)
    setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
    setStep('pin')
  }

  // --- Auto-Logout ---
  const resetTimer = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => handleLogout(), 60000)
  }
  useEffect(() => {
    if (step === 'overview') resetTimer()
    const a = () => step === 'overview' && resetTimer()
    window.addEventListener('click', a)
    window.addEventListener('keydown', a)
    return () => {
      window.removeEventListener('click', a)
      window.removeEventListener('keydown', a)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [step])

  // --- Daten laden ---
  const loadMyWeekStats = async (uid: string) => {
    const from = startOfWeekMonday()
    const { data } = await supabase
      .from('consumptions')
      .select('quantity')
      .eq('user_id', uid)
      .gte('created_at', from.toISOString())
    setMyWeekTotal((data ?? []).reduce((s, r) => s + (r.quantity || 0), 0))
  }

  const loadFavoriteDrink = async (uid: string) => {
    const { data } = await supabase
      .from('consumptions')
      .select('quantity, drinks(name)')
      .eq('user_id', uid)
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
    const { data } = await supabase
      .from('payments')
      .select('amount_cents, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data)
      setLastPayment({
        date: new Date(data.created_at).toLocaleDateString('de-DE'),
        amount: data.amount_cents / 100,
      })
  }

  const loadFreeCrates = async () => {
    const { count } = await supabase
      .from('crates')
      .select('*', { count: 'exact', head: true })
      .eq('is_free', true)
      .gt('quantity_remaining', 0)
    setFreeCrates(count || 0)
  }

// --- 🧊 Kiste ausgeben (mit Info-Popup und Preisangabe) ---
const handleCrateWithdraw = async (selectedDrinkId: number) => {
  if (!user) return setToast('⚠️ Kein Nutzer eingeloggt!')

  const drink = drinks.find((d) => d.id === selectedDrinkId)
  if (!drink) return setToast('❌ Getränk nicht gefunden')

  const price = drink.crate_price_cents || 0
  const priceEuro = euro(price)

  // 👉 Popup vor der eigentlichen Buchung anzeigen
  setPopup({
    title: `Kiste ${drink.name}`,
    message:
      `⚠️ Diese Kiste geht auf deinen Nacken!\n\n` +
      `Sie erscheint **nicht als Freibier** und wird dir komplett berechnet.\n` +
      `💶 Preis: ${priceEuro}\n\n` +
      `🍺 Gedacht z. B. für eine Kiste Bier nach dem Spiel in der Kabine.`,
    onConfirm: async () => {
      const now = new Date().toISOString()

      // Verbrauch als Buchung eintragen
      const { error: insertError } = await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: drink.id,
        quantity: BOTTLES_PER_CRATE,
        source: 'crate',
        unit_price_cents: price / BOTTLES_PER_CRATE,
        via_terminal: true,
        created_at: now,
      })

      if (insertError) {
        console.error(insertError)
        return setToast('❌ Fehler beim Verbuchen der Kiste')
      }

      // Kontostand aktualisieren
      const delta = price
      const { data: upd } = await supabase
        .from('profiles')
        .update({ open_balance_cents: user.open_balance_cents + delta })
        .eq('id', user.id)
        .select('open_balance_cents')
        .single()

      if (upd) setUser({ ...user, open_balance_cents: upd.open_balance_cents })

      setToast(`🍻 Kiste ${drink.name} verbucht (${priceEuro})`)
      setSelectedCrateDrink(0)
    },
  })
}


// --- Smarte Freibier-Logik (Terminal & Home identisch) ---
const confirmSinglesBooking = async (free: boolean) => {
  if (!user) return
  if (drinks.every((d) => d.qty === 0)) return setToast('❌ Bitte Getränk wählen!')

  let toastParts: string[] = []

  for (const d of drinks.filter((x) => x.qty > 0)) {
    let freeQty = 0
    let paidQty = 0
    const now = new Date().toISOString()

    if (free) {
      // Freibier prüfen
      const { data: crates } = await supabase
        .from('crates')
        .select('id, quantity_remaining')
        .eq('drink_id', d.id)
        .eq('is_free', true)
        .gt('quantity_remaining', 0)
        .order('created_at', { ascending: true })
        .limit(1)

      if (crates && crates.length > 0) {
        const crate = crates[0]
        freeQty = Math.min(crate.quantity_remaining, d.qty)
        paidQty = d.qty - freeQty

        // Freibierbestand reduzieren
        await supabase
          .from('crates')
          .update({ quantity_remaining: Math.max(0, crate.quantity_remaining - freeQty) })
          .eq('id', crate.id)
      } else {
        paidQty = d.qty
        setToast(`⚠️ Kein Freibier mehr für ${d.name} verfügbar`)
      }
    } else {
      paidQty = d.qty
    }

    // ✅ Freibierteil (0 €)
    if (freeQty > 0) {
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: d.id,
        quantity: freeQty,
        source: 'crate',
        unit_price_cents: 0,
        via_terminal: true,
        created_at: now,
      })
    }

    // ✅ Bezahlter Teil
    if (paidQty > 0) {
      const totalCents = paidQty * d.price_cents
      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: d.id,
        quantity: paidQty,
        source: 'single',
        unit_price_cents: d.price_cents,
        via_terminal: true,
        created_at: now,
      })
      const { data: upd } = await supabase
        .from('profiles')
        .update({ open_balance_cents: user.open_balance_cents + totalCents })
        .eq('id', user.id)
        .select('open_balance_cents')
        .single()
      if (upd) setUser({ ...user, open_balance_cents: upd.open_balance_cents })
    }

    // 🧾 Toast-Text pro Getränk
    if (freeQty > 0 && paidQty > 0) {
      toastParts.push(`${d.name}: 🎉 ${freeQty}x + 💰 ${paidQty}x`)
    } else if (freeQty > 0) {
      toastParts.push(`${d.name}: 🎉 ${freeQty}x Freibier`)
    } else if (paidQty > 0) {
      toastParts.push(`${d.name}: 💰 ${paidQty}x bezahlt`)
    }
  }

  // 🔁 UI-Reset & Feedback
  setDrinks((d) => d.map((x) => ({ ...x, qty: 0 })))
  await loadMyWeekStats(user.id)
  setToast(toastParts.length ? toastParts.join(' | ') : '✅ Buchung abgeschlossen')
  setTimeout(() => handleLogout(), 2500)
}



  const openBookingPopup = async () => {
    if (!user) return setToast('⚠️ Kein Nutzer eingeloggt!')
    if (drinks.every((d) => d.qty === 0)) return setToast('❌ Bitte Getränk wählen!')
    const total = drinks.reduce((sum, d) => sum + d.qty * d.price_cents, 0)
    const selectedDrinks = drinks.filter((x) => x.qty > 0)

    let freeAvailable = false
    for (const d of selectedDrinks) {
      const { data: crates } = await supabase
        .from('crates')
        .select('id')
        .eq('drink_id', d.id)
        .eq('is_free', true)
        .gt('quantity_remaining', 0)
        .limit(1)
      if (crates && crates.length > 0) freeAvailable = true
    }

    setPopup({
      title: 'Buchung bestätigen',
      message: `Du hast ${selectedDrinks.map((x) => `${x.qty}× ${x.name}`).join(', ')} im Wert von ${euro(total)}.\n\nWie möchtest du verbuchen?`,
      onConfirm: () => confirmSinglesBooking(false),
      freeConfirm: freeAvailable ? () => confirmSinglesBooking(true) : undefined,
    })
  }

  // --- UI ---
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white">
      <header className="fixed top-0 left-0 w-full bg-neutral-950/80 backdrop-blur border-b border-neutral-800 text-neutral-400 text-sm py-2 px-4 flex justify-between items-center z-40">
        <span>🕒 {time}</span>
        <span>TSV Lonnerstadt • Herren-Terminal</span>
      </header>

      <div className="pt-14 px-6 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 h-[calc(100vh-3.5rem)]">
        {/* Links */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-8 overflow-y-auto">
          {step === 'pin' ? (
            <div className="w-full max-w-xs mx-auto text-center">
              <h1 className="text-3xl font-semibold mb-8">🔒 PIN-Eingabe</h1>
              <div className="flex justify-center gap-3 mb-8">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-5 h-5 rounded-full border-2 ${i < pin.length ? 'bg-white' : 'border-neutral-600'}`}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                {[1,2,3,4,5,6,7,8,9].map(n => (
                  <button key={n} onClick={() => setPin(p => (p + n).slice(0,6))} className="h-16 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">{n}</button>
                ))}
                <div />
                <button onClick={() => setPin(p => (p + '0').slice(0,6))} className="h-16 text-2xl bg-neutral-800 hover:bg-neutral-700 rounded-xl">0</button>
                <div />
              </div>
              <div className="flex justify-center gap-4">
                <button onClick={() => setPin(p => p.slice(0,-1))} className="px-5 py-2 bg-neutral-800 rounded-lg">Löschen</button>
                <button onClick={handleLogin} className="px-7 py-2 bg-green-600 hover:bg-green-700 rounded-lg">Bestätigen</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {loadingInfo ? (
                <p className="text-neutral-500 text-center">⏳ Daten werden geladen...</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <InfoCard icon="💰" label="Kontostand" value={euro(user?.open_balance_cents ?? 0)} />
                  <InfoCard icon="🍺" label="Gesamtverbrauch" value={`${myWeekTotal}`} />
                  <InfoCard icon="💶" label="Letzte Zahlung" value={lastPayment ? `${lastPayment.amount.toFixed(2)} € am ${lastPayment.date}` : '—'} />
                  <InfoCard icon="⭐" label="Lieblingsgetränk" value={favoriteDrink || '—'} />
                  <InfoCard icon="🎁" label="Freibierkisten" value={`${freeCrates}`} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rechts */}
        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/40 p-6 overflow-y-auto">
          {step === 'overview' && (
            <>
              <h2 className="text-xl font-semibold mb-4">🍻 Getränke verbuchen</h2>
              <div className="space-y-2">
                {drinks.map(d => (
                  <div key={d.id} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3 flex justify-between items-center">
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-neutral-500">{euro(d.price_cents)} / Stk</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setDrinks(prev => prev.map(x => x.id===d.id ? {...x, qty: Math.max(0,x.qty-1)} : x))} className="w-9 h-9 bg-neutral-800 rounded-lg text-xl">–</button>
                      <span className="w-6 text-center">{d.qty}</span>
                      <button onClick={() => setDrinks(prev => prev.map(x => x.id===d.id ? {...x, qty:x.qty+1} : x))} className="w-9 h-9 bg-neutral-800 rounded-lg text-xl">+</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 mt-6">
                <button onClick={openBookingPopup} className="w-full h-14 rounded-2xl bg-green-600 hover:bg-green-700 text-lg font-medium">
                  📤 Jetzt verbuchen
                </button>

                <div className="flex gap-2">
                  <select
                    id="crateDrink"
                    className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 text-white"
                    onChange={(e) => setSelectedCrateDrink(Number(e.target.value))}
                    value={selectedCrateDrink}
                  >
                    <option value={0}>Kiste wählen...</option>
                    {drinks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({euro(d.crate_price_cents)})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => selectedCrateDrink && handleCrateWithdraw(selectedCrateDrink)}
                    disabled={!selectedCrateDrink}
                    className="px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-lg font-medium"
                  >
                    🥶 Kiste
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Popup */}
      <AnimatePresence>
        {popup && (
          <motion.div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <motion.div className="bg-neutral-900/95 p-6 rounded-2xl border border-neutral-700 max-w-sm w-full text-center shadow-2xl">
              <h3 className="text-lg font-semibold mb-2">{popup.title}</h3>
              <p className="text-sm text-neutral-300 mb-6 whitespace-pre-line">{popup.message}</p>
              <div className="flex justify-center gap-4">
                <button onClick={() => setPopup(null)} className="px-4 py-2 bg-neutral-700 rounded">Abbrechen</button>
                {popup.freeConfirm && <button onClick={() => { popup.freeConfirm(); setPopup(null) }} className="px-4 py-2 bg-yellow-600 rounded">Freibier</button>}
                <button onClick={() => { popup.onConfirm(); setPopup(null) }} className="px-4 py-2 bg-green-700 rounded">Bezahlen</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-5 right-5 bg-green-700 px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InfoCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <motion.div whileHover={{ scale: 1.03 }} className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center shadow-sm">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-sm text-neutral-400">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </motion.div>
  )
}