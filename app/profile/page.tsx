'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'
import { Beer, Gift, Wallet, Star, PiggyBank } from 'lucide-react'


type PopupData =
  | null
  | {
    title: string
    method: 'bar' | 'paypal'
  }

type ExtraPopup =
  | null
  | {
    owes: number
    diff: number
    amount: number
    method: 'bar' | 'paypal'
  }

type Toast = { id: number; text: string; type?: 'success' | 'error' }
type Filter = '7days' | 'month' | 'all'

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [bookings, setBookings] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [popup, setPopup] = useState<PopupData>(null)
  const [extraPopup, setExtraPopup] = useState<ExtraPopup>(null)
  const [amountInput, setAmountInput] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [filter, setFilter] = useState<Filter>('month')
  const [pin, setPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [pinMessage, setPinMessage] = useState('')

  const [stats, setStats] = useState({
    totalDrinks: 0,
    totalFree: 0,
    lastPayment: null as null | { amount: number; created_at: string },
  })

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500)
  }

  const formatDateTime = (ts: string) => {
    const d = new Date(ts)
    return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} Uhr`
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setUser(data.user)
      if (data.user) await fetchData(data.user.id)
    })
  }, [])

  const fetchData = async (uid: string) => {
    const [{ data: cons }, { data: pay }, { data: prof }] = await Promise.all([
      supabase
        .from('consumptions')
        .select('quantity, unit_price_cents, source, via_terminal, created_at, drinks(name)')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('payments')
        .select('amount_cents, verified, method, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').eq('id', uid).single(),
    ])

    setBookings(cons || [])
    setPayments(pay || [])
    setProfile(prof)
    setPin(prof?.pin || '')

    const totalDrinks = (cons || []).reduce((sum, c) => sum + (c.quantity || 0), 0)
    // 🔹 Freibier: tatsächliche Anzahl getrunkener Gratisgetränke (nicht nur Buchungen)
    const totalFree = (cons || [])
      .filter((c) => (c.unit_price_cents || 0) === 0)
      .reduce((sum, c) => sum + (c.quantity || 0), 0)

    const lastPayment = pay && pay.length > 0 ? { amount: pay[0].amount_cents / 100, created_at: pay[0].created_at } : null
    setStats({ totalDrinks, totalFree, lastPayment })
  }

  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('profile-realtime')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => fetchData(user.id))
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [user])

  const now = new Date()
  const filterData = (arr: any[]) => {
    if (filter === '7days') {
      const w = new Date(now)
      w.setDate(now.getDate() - 7)
      return arr.filter((a) => new Date(a.created_at) >= w)
    }
    if (filter === 'month') {
      return arr.filter((a) => {
        const d = new Date(a.created_at)
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
    }
    return arr
  }

  const filteredBookings = useMemo(() => filterData(bookings), [bookings, filter])

  const overview = useMemo(() => {
    const rows: Record<string, { qty: number; sumCents: number }> = {}

    // Extra Accumulators
    let provisionQty = 0
    let provisionTotal = 0
    let freeQty = 0

    for (const b of filteredBookings) {
      const price = b.unit_price_cents || 0
      const qty = b.quantity || 0

      // Case 1: Crate Provision (Quantity 0, Price > 0)
      if (b.source === 'crate' && qty === 0) {
        provisionQty += 1
        provisionTotal += price
        continue
      }

      // Case 2: Free Drink (Price 0, Quantity > 0)
      if (price === 0 && qty > 0) {
        if (b.source === 'single') freeQty += qty
        continue
      }

      // Case 3: Paid Drink / Paid Crate (Price > 0, Quantity > 0)
      // "Bought Crate" (q=20) falls here and is added to the drink name (e.g. "Bier")
      if (price > 0 && qty > 0) {
        const name = b.drinks?.name || 'Unbekannt'
        if (!rows[name]) rows[name] = { qty: 0, sumCents: 0 }
        rows[name].qty += qty
        rows[name].sumCents += price * qty
      }
    }

    // Add Provisions Row
    if (provisionQty > 0) {
      rows['🎁 Bereitgestellte Kisten'] = { qty: provisionQty, sumCents: provisionTotal }
    }

    // Add Free Drinks Row
    if (freeQty > 0) {
      rows['🎉 Verbrauchte Freigetränke'] = { qty: freeQty, sumCents: 0 }
    }

    return rows
  }, [filteredBookings])

  const favoriteDrink = useMemo(() => {
    const map: Record<string, number> = {}
    for (const b of bookings) {
      const name = b.drinks?.name || 'Unbekannt'
      map[name] = (map[name] || 0) + (b.quantity || 0)
    }
    let fav: { name: string; qty: number } | null = null
    for (const [name, qty] of Object.entries(map)) {
      if (!fav || qty > fav.qty) fav = { name, qty }
    }
    return fav
  }, [bookings])

  const balanceCents = profile?.open_balance_cents ?? 0
  const isDebt = balanceCents > 0
  const isCredit = balanceCents < 0

  // --- Payments ---
  const openPaymentPopup = (method: 'bar' | 'paypal') => {
    const balance = profile?.open_balance_cents ?? 0
    const owes = balance > 0 ? (balance / 100).toFixed(2) : ''

    // 🔹 Vorausfüllen mit noch offenem Betrag (falls > 0), sonst leer
    setAmountInput(owes)
    setPopup({ title: method === 'paypal' ? 'PayPal-Zahlung melden' : 'Barzahlung melden', method })
  }


  const handleConfirmPayment = () => {
    const num = parseFloat(amountInput.replace(',', '.') || '')
    if (isNaN(num) || num <= 0) return addToast('Bitte gültigen Betrag eingeben.', 'error')
    if (!popup?.method || !user || !profile) return

    const balance = profile.open_balance_cents ?? 0
    const owes = balance > 0 ? balance / 100 : 0

    if (owes > 0 && num > owes) {
      const diff = parseFloat((num - owes).toFixed(2))
      setPopup(null)
      setExtraPopup({ owes, diff, amount: num, method: popup.method })
    } else {
      recordPayment(num, popup.method)
    }
  }

  const recordPayment = async (amount: number, method: 'bar' | 'paypal') => {
    if (!profile) return addToast('Profil konnte nicht geladen werden', 'error')

    let paypalWindow: Window | null = null

    // 🔹 Fenster direkt beim Klick öffnen, damit Browser es nicht blockt
    if (method === 'paypal') {
      paypalWindow = window.open('', '_blank')
    }

    const { error } = await supabase.from('payments').insert([
      {
        user_id: profile.id,
        amount_cents: Math.round(amount * 100),
        method,
        verified: false,
      },
    ])

    if (error) {
      // Falls Insert fehlschlägt: geöffnetes Fenster wieder schließen
      if (paypalWindow) {
        paypalWindow.close()
      }
      return addToast('Fehler beim Melden der Zahlung', 'error')
    }

    addToast(
      method === 'bar'
        ? '💵 Barzahlung gemeldet – wird nach Admin-Freigabe wirksam.'
        : '💳 Zahlung gemeldet – wird nach Admin-Freigabe wirksam.',
      'success'
    )
    setPopup(null)
    setExtraPopup(null)
    fetchData(user.id)

    if (method === 'paypal') {
      const redirect = `https://paypal.me/benjamindenert/${amount}`
      if (paypalWindow) {
        paypalWindow.location.href = redirect
      } else {
        // Fallback, falls Popup doch geblockt wurde
        window.location.href = redirect
      }
    }
  }



  const handleExtraChoice = (choice: 'credit' | 'tip') => {
    if (!extraPopup) return
    const { owes, diff, amount, method } = extraPopup
    if (choice === 'tip') {
      addToast(`${diff.toFixed(2)} € als Trinkgeld (nicht verbucht).`, 'success')
      recordPayment(owes, method)
    } else {
      addToast(`${diff.toFixed(2)} € als Guthaben.`, 'success')
      recordPayment(amount, method)
    }
  }

  const updatePin = async () => {
    setPinMessage('')
    if (newPin.length !== 6 || isNaN(Number(newPin))) {
      return setPinMessage('PIN muss 6 Ziffern haben.')
    }

    const { data: existing } = await supabase.from('profiles').select('id').eq('pin', newPin)
    if (existing && existing.length > 0) return setPinMessage('PIN ist bereits vergeben.')

    const { error } = await supabase.from('profiles').update({ pin: newPin }).eq('id', user.id)
    if (error) return setPinMessage('Fehler beim Speichern.')

    setPin(newPin)
    setNewPin('')
    setPinMessage('PIN erfolgreich geändert ✅')
  }

  return (
    <>
      <TopNav />
      <div className="pt-20 max-w-5xl mx-auto p-4 text-white space-y-8">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">
          Mein Profil
          {profile?.first_name && (
            <span className="text-gray-400 ml-2 text-base md:text-lg">
              ({profile.first_name} {profile.last_name})
            </span>
          )}
        </h1>

        {/* --- Stat Cards --- */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
          <StatCard
            icon={<PiggyBank className="w-5 h-5" />}
            label="Kontostand"
            value={`${(Math.abs(balanceCents) / 100).toFixed(2)} €`}
            sub={
              isDebt
                ? 'Schulden'
                : isCredit
                  ? 'Guthaben'
                  : 'Ausgeglichen'
            }
            accent={
              isDebt
                ? 'from-red-500/20 to-red-300/10'
                : isCredit
                  ? 'from-green-500/20 to-green-300/10'
                  : 'from-gray-500/20 to-gray-300/10'
            }
          />
          <StatCard icon={<Beer className="w-5 h-5" />} label="Gesamtverbrauch" value={stats.totalDrinks} accent="from-emerald-500/20 to-emerald-300/10" />
          <StatCard icon={<Gift className="w-5 h-5" />} label="Freibier" value={stats.totalFree} accent="from-pink-500/20 to-pink-300/10" />
          <StatCard
            icon={<Wallet className="w-5 h-5" />}
            label="Letzte Zahlung"
            value={stats.lastPayment ? `${stats.lastPayment.amount.toFixed(2)} €` : '—'}
            sub={stats.lastPayment ? new Date(stats.lastPayment.created_at).toLocaleDateString() : ''}
            accent="from-blue-500/20 to-blue-300/10"
          />
          <StatCard
            icon={<Star className="w-5 h-5" />}
            label="Lieblingsgetränk"
            value={favoriteDrink ? favoriteDrink.name : '—'}
            sub={favoriteDrink ? `${favoriteDrink.qty}×` : ''}
            accent="from-amber-500/20 to-amber-300/10"
          />
        </section>

        {/* --- Zahlungen direkt unter Karten --- */}
        <section className="bg-gray-800/70 p-4 rounded-2xl border border-gray-700/70 space-y-4">
          <h2 className="text-xl font-semibold">💳 Zahlungen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
            <button onClick={() => openPaymentPopup('bar')} className="bg-yellow-600 hover:bg-yellow-700 p-2 rounded-lg font-medium shadow-sm">
              💵 Barzahlung melden
            </button>
            <button onClick={() => openPaymentPopup('paypal')} className="bg-blue-700 hover:bg-blue-800 p-2 rounded-lg font-medium shadow-sm">
              💳 PayPal-Zahlung melden
            </button>
          </div>

          <ul className="space-y-2">
            {payments.length === 0 && <li className="text-gray-400">Keine Zahlungen vorhanden.</li>}
            {payments.map((p, i) => (
              <li
                key={i}
                className="p-3 rounded-2xl border bg-gray-900/80 border-gray-700/70 flex justify-between items-center"
              >
                <div>
                  <span>
                    {(p.amount_cents / 100).toFixed(2)} € • {p.method === 'paypal' ? 'PayPal' : 'Bar'}
                  </span>
                  <div className="text-xs text-gray-400">{formatDateTime(p.created_at)}</div>
                </div>
                <div className="text-sm text-gray-400">
                  {p.verified ? (
                    <span className="text-green-400">✅ Verifiziert</span>
                  ) : (
                    <span className="text-yellow-400">⏳ Offen</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* --- Gesamtübersicht & Einzelbuchungen --- */}
        <section className="bg-gray-800/60 p-4 rounded-2xl border border-gray-700/70 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold">🧾 Gesamtübersicht</h2>
            <div className="flex gap-2">
              {[
                { label: '7 Tage', value: '7days' },
                { label: 'Diesen Monat', value: 'month' },
                { label: 'Alle', value: 'all' },
              ].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value as Filter)}
                  className={`px-2.5 py-1.5 rounded text-xs border transition ${filter === f.value
                    ? 'bg-green-700 border-green-500 text-white'
                    : 'bg-gray-800/60 border-gray-600 text-gray-300 hover:text-white'
                    }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {Object.keys(overview).length === 0 ? (
            <p className="text-gray-400 text-sm">Keine Buchungen im gewählten Zeitraum (ohne Freibier).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700/70">
                    <th className="text-left py-2 font-medium">Getränk</th>
                    <th className="text-right py-2 font-medium">Menge</th>
                    <th className="text-right py-2 font-medium">Summe (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(overview).map(([name, d]: any) => (
                    <tr key={name} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                      <td className="py-2">{name}</td>
                      <td className="text-right py-2">{d.qty}</td>
                      <td className="text-right py-2">{(d.sumCents / 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Einzelbuchungen */}
        <section>
          <h2 className="text-xl font-semibold mb-2">📋 Einzelbuchungen</h2>
          <ul className="space-y-2">
            {filteredBookings.length === 0 && <li className="text-gray-400">Keine Buchungen im gewählten Zeitraum.</li>}
            {filteredBookings.map((b: any, i: number) => {
              const isCrateProvision = b.source === 'crate' && (b.quantity || 0) === 0

              let label = `× ${b.quantity}`
              if (isCrateProvision) label = '🎉 Kiste bereitgestellt'
              else if (b.source === 'crate') label = `📦 Kiste gekauft (${b.quantity} Fl.)`

              let priceDisplay = ''
              if (isCrateProvision) {
                priceDisplay = `${(b.unit_price_cents / 100).toFixed(2)} € (Gutschrift)`
              } else if (b.source === 'crate') {
                // Kauf via Terminal -> Kistenpreis * 1 (bzw quantity ist 20, aber unit price ist flaschenpreis? 
                // CHECK: Im Terminal: quantity=20, unit_price = crate_price / 20. Total = crate_price.
                // Wait. Terminal logic: rows = [{ quantity: 20, unit_price: perBottle ... }]
                // So total = quantity * unit_price. Correct.
                const total = (b.unit_price_cents * b.quantity)
                priceDisplay = `${(total / 100).toFixed(2)} €`
              } else if (b.unit_price_cents === 0) {
                priceDisplay = 'Freibier'
              } else {
                priceDisplay = `${((b.unit_price_cents * b.quantity) / 100).toFixed(2)} €`
              }

              return (
                <li
                  key={i}
                  className="p-3 rounded-2xl border bg-gray-800/70 border-gray-700/70 flex justify-between items-center"
                >
                  <div>
                    <span className="font-medium">{b.drinks?.name || 'Unbekannt'}</span>

                    <span className={`ml-1 ${b.source === 'crate' ? 'text-green-400' : ''}`}>
                      {label}
                    </span>

                    {b.via_terminal && <span className="text-blue-400 ml-2 text-sm">🖥️ Terminal</span>}

                    <div className="text-xs text-gray-400">{formatDateTime(b.created_at)}</div>
                  </div>

                  <div className="text-sm text-gray-300 text-right">
                    {priceDisplay}
                  </div>
                </li>
              )
            })}

          </ul>
        </section>

        {/* --- PIN ändern --- */}
        <section className="bg-gray-800/70 p-4 rounded-2xl border border-gray-700/70">
          <h2 className="text-lg font-semibold mb-2">🔐 PIN ändern</h2>
          <p className="mb-2 text-sm text-gray-400">
            Aktueller PIN: <strong>{pin || '–'}</strong>
          </p>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              maxLength={6}
              placeholder="Neuer 6-stelliger PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="flex-1 p-2 bg-gray-900 border border-gray-700 rounded-lg"
            />
            <button onClick={updatePin} className="bg-green-700 hover:bg-green-800 px-4 rounded-lg">
              Speichern
            </button>
          </div>
          {pinMessage && <p className="text-yellow-400 text-sm">{pinMessage}</p>}
        </section>

        <Toasts toasts={toasts} />
      </div>

      {/* Popups */}
      <AnimatePresence>
        {(popup || extraPopup) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gradient-to-b from-gray-800 to-gray-900 p-6 rounded-2xl border border-gray-700 shadow-2xl w-[90%] max-w-sm text-center space-y-5"
            >
              {!extraPopup ? (
                <>
                  <h3 className="text-xl font-semibold text-white">{popup?.title}</h3>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Betrag in €"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full bg-gray-900/80 text-white text-center text-lg p-3 rounded-xl border border-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <p className="text-sm text-gray-400">
                    {popup?.method === 'bar'
                      ? '💵 Barzahlungen werden vom Admin geprüft und anschließend verbucht.'
                      : '💳 Nach Bestätigung wirst du zu PayPal weitergeleitet.'}
                  </p>
                  <div className="flex justify-center gap-3 pt-2">
                    <button onClick={() => setPopup(null)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm">
                      Abbrechen
                    </button>
                    <button
                      onClick={handleConfirmPayment}
                      className="px-4 py-2 bg-green-700 hover:bg-green-800 rounded-lg text-sm font-medium"
                    >
                      Bestätigen
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-semibold text-white">Überzahlung erkannt</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">
                    Du hast <strong>{extraPopup.amount.toFixed(2)} €</strong> eingegeben.<br />
                    Deine Schulden betragen <strong>{extraPopup.owes.toFixed(2)} €</strong>.<br />
                    Der Restbetrag von <strong>{extraPopup.diff.toFixed(2)} €</strong> kann als Guthaben oder Trinkgeld verbucht werden.
                  </p>
                  <div className="flex justify-center gap-3 pt-3">
                    <button
                      onClick={() => handleExtraChoice('credit')}
                      className="px-4 py-2 bg-green-700 hover:bg-green-800 rounded-lg text-sm font-medium"
                    >
                      💶 Guthaben behalten
                    </button>
                    <button
                      onClick={() => handleExtraChoice('tip')}
                      className="px-4 py-2 bg-yellow-700 hover:bg-yellow-800 rounded-lg text-sm font-medium"
                    >
                      🎁 Trinkgeld geben
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/* --- Subcomponents --- */
function StatCard({ icon, label, value, sub, accent }: any) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gray-800/60 backdrop-blur-sm p-4 shadow-sm`}
    >
      <div className={`absolute inset-0 pointer-events-none bg-gradient-to-tr ${accent || 'from-white/5 to-white/0'}`} />
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-black/30 border border-white/5 shadow-inner">{icon}</div>
        <div>
          <p className="text-xs text-gray-400">{label}</p>
          <p className="text-xl font-semibold leading-tight">{value}</p>
          {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

function Toasts({ toasts }: any) {
  return (
    <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
      <AnimatePresence>
        {toasts.map((t: any) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`px-4 py-2 rounded-lg text-sm shadow-lg backdrop-blur-sm ${t.type === 'error' ? 'bg-red-700/80 text-white' : 'bg-green-700/80 text-white'
              }`}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
