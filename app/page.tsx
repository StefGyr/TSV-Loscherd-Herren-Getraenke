'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'
import { PiggyBank, Beer, Gift, Wallet } from 'lucide-react'

const BOTTLES_PER_CRATE = 20
const FREE_POOL_ID = 1
const euro = (cents: number) => `${(cents / 100).toFixed(2)} €`
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE')

export default function HomePage() {
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<any[]>([])
  const [freePool, setFreePool] = useState<number>(0)
  const [bierPrice, setBierPrice] = useState<number>(0)
  const [confirmPopup, setConfirmPopup] = useState(false)
  const [freePopup, setFreePopup] = useState(false)
  const [toasts, setToasts] = useState<any[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }

  useEffect(() => {
    const load = async () => {
      const { data: drinks } = await supabase.from('drinks').select('*')
      setDrinks(drinks || [])
      const bier = drinks?.find((d: any) => d.name.toLowerCase() === 'bier')
      if (bier) setBierPrice(bier.crate_price_cents)

      const { data: user } = await supabase.auth.getUser()
      if (!user.user) return
      const uid = user.user.id

      const prof = await supabase.from('profiles').select('open_balance_cents').eq('id', uid).maybeSingle()
      setBalance(prof.data?.open_balance_cents ?? 0)

      const pool = await supabase.from('free_pool').select('quantity_remaining').eq('id', FREE_POOL_ID).maybeSingle()
      setFreePool(pool.data?.quantity_remaining ?? 0)

      const cons = await supabase
        .from('consumptions')
        .select('quantity, unit_price_cents, created_at, drinks(name)')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(8)
      const mapped =
        cons.data?.map((r: any) => ({
          created_at: r.created_at,
          text:
            r.unit_price_cents === 0
              ? `🎉 ${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Freibier)`
              : `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (${euro(
                  r.unit_price_cents * r.quantity,
                )})`,
        })) ?? []
      setBookings(mapped)
    }
    load()
  }, [])

  const handlePaidBooking = async () => {
    if (!selectedDrink) return addToast('Bitte Getränk wählen', 'error')
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id
    if (!uid) return
    const total = selectedDrink.price_cents * quantity
    const now = new Date().toISOString()
    const ins = await supabase.from('consumptions').insert({
      user_id: uid,
      drink_id: selectedDrink.id,
      quantity,
      unit_price_cents: selectedDrink.price_cents,
      created_at: now,
    })
    if (ins.error) return addToast('❌ Buchung fehlgeschlagen', 'error')
    await supabase.rpc('increment_balance', { user_id_input: uid, amount_input: total })
    setBalance((b) => b + total)
    addToast(`💰 ${quantity}× ${selectedDrink.name} verbucht`)
    setSelectedDrink(null)
    setQuantity(1)
    setConfirmPopup(false)
  }

  const handleProvideFreeDrinks = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const uid = auth.user?.id
    if (!uid) return
    const rpc1 = await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: -BOTTLES_PER_CRATE })
    if (rpc1.error) return addToast('Fehler beim Erhöhen des Freibier-Pools', 'error')
    setFreePool((p) => p + BOTTLES_PER_CRATE)
    await supabase.rpc('increment_balance', { user_id_input: uid, amount_input: bierPrice })
    setBalance((b) => b + bierPrice)
    addToast('🎉 20 Freigetränke bereitgestellt!')
    setFreePopup(false)
  }

  return (
    <>
      <TopNav />
      <div className="pt-20 min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 text-white px-4 pb-24">
        <div className="max-w-md mx-auto space-y-6">
          {/* Cards */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <Card icon={<PiggyBank />} label="Kontostand" value={euro(Math.abs(balance))} />
            <Card icon={<Beer />} label="Freibier" value={freePool.toString()} />
            <Card icon={<Gift />} label="Gesamtverbrauch" value={bookings.length.toString()} />
            <Card icon={<Wallet />} label="Letzte Buchung" value={bookings[0] ? shortDate(bookings[0].created_at) : '—'} />
          </div>

          <section className="bg-neutral-900/60 border border-neutral-800 rounded-2xl p-6">
            <h1 className="text-2xl font-semibold mb-4">🍺 Getränk verbuchen</h1>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {drinks.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDrink(d)}
                  className={`p-3 rounded-xl border text-sm ${
                    selectedDrink?.id === d.id
                      ? 'bg-white text-black border-white'
                      : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'
                  }`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            {selectedDrink && (
              <div className="flex justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-10 h-10 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-2xl">
                    –
                  </button>
                  <span className="w-8 text-center text-xl">{quantity}</span>
                  <button onClick={() => setQuantity((q) => q + 1)} className="w-10 h-10 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-2xl">
                    +
                  </button>
                </div>
                <span className="text-sm text-neutral-400">{euro(selectedDrink.price_cents)} / Stück</span>
              </div>
            )}
            <button
              disabled={!selectedDrink}
              onClick={() => setConfirmPopup(true)}
              className="w-full h-12 bg-white text-black rounded-lg font-medium hover:bg-gray-200 transition disabled:opacity-50"
            >
              Jetzt verbuchen
            </button>
          </section>

          <div className="mt-4">
            <button
              onClick={() => setFreePopup(true)}
              className="w-full h-12 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium transition"
            >
              🍻 Freigetränke bereitstellen
            </button>
          </div>

          <section className="mt-6">
            <h2 className="text-xl font-semibold mb-2">🧾 Letzte Buchungen</h2>
            <ul className="text-sm divide-y divide-neutral-800">
              {bookings.length === 0 && <li className="py-2 text-neutral-500">Keine Buchungen</li>}
              {bookings.map((b, i) => (
                <li key={i} className="py-2 flex justify-between">
                  <span>{shortDate(b.created_at)} {b.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Buchungs-Popup */}
        <AnimatePresence>
          {confirmPopup && selectedDrink && (
            <Popup
              title="🍺 Buchung bestätigen"
              message={`Du buchst ${quantity}× ${selectedDrink.name} = ${euro(selectedDrink.price_cents * quantity)}.\nJetzt wirklich verbuchen?`}
              onCancel={() => setConfirmPopup(false)}
              onConfirm={handlePaidBooking}
            />
          )}
        </AnimatePresence>

        {/* Freigetränke-Popup */}
        <AnimatePresence>
          {freePopup && (
            <Popup
              title="🍻 Freigetränke bereitstellen"
              message={`Du stellst ${BOTTLES_PER_CRATE} Freigetränke für alle bereit.\nDafür wird ${euro(bierPrice)} abgebucht.`}
              onCancel={() => setFreePopup(false)}
              onConfirm={handleProvideFreeDrinks}
            />
          )}
        </AnimatePresence>

        {/* Toasts */}
        <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className={`px-4 py-2 rounded-lg text-sm shadow-lg ${t.type === 'error' ? 'bg-red-700' : 'bg-green-700'}`}>
                {t.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

function Card({ icon, label, value }: any) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-700/70 bg-gray-800/60 backdrop-blur-sm p-4 shadow-sm flex items-center gap-3">
      <div className="p-2 rounded-xl bg-black/30 border border-white/5 shadow-inner">{icon}</div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
      </div>
    </div>
  )
}

function Popup({ title, message, onCancel, onConfirm }: any) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 flex items-center justify-center bg-black/70 z-50">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-neutral-900 p-6 rounded-2xl text-center shadow-2xl border border-neutral-700 max-w-sm w-full">
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-sm text-neutral-300 mb-6 whitespace-pre-line">{message}</p>
        <div className="flex justify-center gap-4">
          <button onClick={onCancel} className="px-4 py-2 bg-neutral-700 rounded hover:bg-neutral-600">Abbrechen</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-green-700 rounded hover:bg-green-800">Bestätigen</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
