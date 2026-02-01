'use client'

import React, { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import TopNav from '@/components/TopNav'
import { supabase } from '@/lib/supabase-browser'
import { PiggyBank, Beer, Gift, Wallet, ShoppingCart, Plus, Minus, Check, X } from 'lucide-react'

const BOTTLES_PER_CRATE = 20
const FREE_POOL_TABLE = 'free_pool'
const FREE_POOL_ID = 1
const euro = (c: number) => `${(c / 100).toFixed(2)} €`
const shortDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} • ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
}

export default function HomePage() {
  const [drinks, setDrinks] = useState<any[]>([])
  const [selectedDrink, setSelectedDrink] = useState<any | null>(null)
  const [quantity, setQuantity] = useState(1)

  // ⚡️ Optimistic State
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [balance, setBalance] = useState<number>(0)
  const [bookings, setBookings] = useState<any[]>([])
  const [freePool, setFreePool] = useState<number>(0)
  const [bierPrice, setBierPrice] = useState<number>(0)

  // Stats
  const [monthTotal, setMonthTotal] = useState(0)
  const [favoriteDrink, setFavoriteDrink] = useState<string>('—')

  // Popups
  const [freeChoiceDrink, setFreeChoiceDrink] = useState<any | null>(null)
  const [pendingQty, setPendingQty] = useState<number>(0)
  const [popup, setPopup] = useState(false) // Bezahlen-Bestätigung
  const [freePopup, setFreePopup] = useState(false) // Freigetränke bereitstellen
  const [partialPopup, setPartialPopup] = useState<{ free: number; pay: number } | null>(null) // Teil-Freibier
  const [toasts, setToasts] = useState<{ id: number; text: string; type: 'success' | 'error' }[]>([])

  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((p) => [...p, { id, text, type }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3000)
  }

  // ---------------- Loader ----------------
  const refreshBookings = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const { data } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, source, created_at, drinks(name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(6)

    setBookings(
      (data || []).map((r: any) => {
        let text = ''
        let type: 'paid' | 'free' | 'crate' = 'paid'

        const isCrateProvision = r.source === 'crate' && (r.quantity || 0) === 0
        let price = (r.unit_price_cents || 0) * (r.quantity || 0)

        if (isCrateProvision) {
          type = 'crate'
          text = `Kiste / Runde bereitgestellt`
          price = r.unit_price_cents || 0
        } else if (r.source === 'crate') {
          type = 'crate'
          text = `Kiste gekauft (${r.quantity} Fl.)`
        } else if (r.unit_price_cents === 0) {
          type = 'free'
          text = `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'} (Frei)`
        } else {
          type = 'paid'
          text = `${r.quantity}× ${r.drinks?.name ?? 'Unbekannt'}`
        }

        return {
          created_at: r.created_at,
          text,
          price,
          type,
          drinkName: r.drinks?.name
        }
      }),
    )
  }

  const loadUserStats = async () => {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth?.user
    if (!user) return

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString()

    const { data, error } = await supabase
      .from('consumptions')
      .select('quantity, unit_price_cents, drink_id, drinks(name)')
      .eq('user_id', user.id)
      .gte('created_at', startOfMonth)
      .lte('created_at', endOfMonth)

    if (!error && data) {
      const sum = data.reduce((acc, c) => acc + ((c.quantity || 0) * (c.unit_price_cents || 0)), 0)
      setMonthTotal(sum)

      const counts: Record<string, number> = {}
      data.forEach((c: any) => {
        if (c.drinks?.name) {
          counts[c.drinks.name] = (counts[c.drinks.name] || 0) + (c.quantity || 0)
        }
      })
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      setFavoriteDrink(top ? `${top[0]} (${top[1]})` : '—')
    }
  }

  useEffect(() => {
    const init = async () => {
      const { data: drinks } = await supabase.from('drinks').select('*').order('name')
      setDrinks(drinks || [])
      const bier = drinks?.find((d: any) => d.name.toLowerCase() === 'bier')
      if (bier) setBierPrice(bier.crate_price_cents)

      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) return

      const prof = await supabase.from('profiles').select('open_balance_cents').eq('id', user.id).maybeSingle()
      setBalance(prof.data?.open_balance_cents ?? 0)

      const pool = await supabase.from(FREE_POOL_TABLE).select('quantity_remaining').eq('id', FREE_POOL_ID).maybeSingle()
      setFreePool(pool.data?.quantity_remaining ?? 0)

      await Promise.all([refreshBookings(), loadUserStats()])
    }
    init()
    const interval = setInterval(init, 60000)
    return () => clearInterval(interval)
  }, [])


  // ---------------- Logic ----------------
  const handlePaidBooking = async (drink: any, qty: number) => {
    if (isSubmitting) return
    setIsSubmitting(true)

    const total = drink.price_cents * qty
    const now = new Date().toISOString()
    const prevBalance = balance

    // ⚡️ Optimistic Update
    setBalance((b) => b + total)
    setBookings(prev => [{
      created_at: now,
      text: `${qty}× ${drink.name}`,
      price: total,
      type: 'paid',
      drinkName: drink.name
    }, ...prev.slice(0, 5)])

    setPopup(false)
    addToast(`💰 ${qty}× ${drink.name} verbucht`)
    setSelectedDrink(null)
    setQuantity(1)
    setFreeChoiceDrink(null)

    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) throw new Error('No User')

      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: drink.id,
        quantity: qty,
        unit_price_cents: drink.price_cents,
        source: 'single',
        created_at: now,
      })
      await supabase.rpc('increment_balance', { user_id_input: user.id, amount_input: total })
      refreshBookings()
      loadUserStats()
    } catch (err) {
      console.error(err)
      setBalance(prevBalance)
      addToast('❌ Fehler: Buchung rückgängig gemacht', 'error')
      refreshBookings()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFreeBooking = async (drink: any, qty: number) => {
    const freeQty = Math.min(qty, freePool)
    const payQty = qty - freeQty

    if (payQty > 0 && freeQty > 0) {
      setPartialPopup({ free: freeQty, pay: payQty })
      return
    }

    if (isSubmitting) return
    setIsSubmitting(true)
    const now = new Date().toISOString()
    const prevPool = freePool

    setFreePool((p) => Math.max(0, p - freeQty))
    setBookings(prev => [{
      created_at: now,
      text: `${freeQty}× ${drink.name} (Frei)`,
      price: 0,
      type: 'free',
      drinkName: drink.name
    }, ...prev.slice(0, 5)])

    addToast(`🎉 ${freeQty}× ${drink.name} als Freibier verbucht`)
    setFreeChoiceDrink(null)
    setSelectedDrink(null)

    try {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth?.user
      if (!user) throw new Error('No User')

      await supabase.from('consumptions').insert({
        user_id: user.id,
        drink_id: drink.id,
        quantity: freeQty,
        unit_price_cents: 0,
        source: 'single',
        created_at: now,
      })
      await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: freeQty })
      refreshBookings()
      loadUserStats()
    } catch (err) {
      console.error(err)
      setFreePool(prevPool)
      addToast('Freibier-Fehler', 'error')
      refreshBookings()
    } finally {
      setIsSubmitting(false)
    }
  }
  const confirmPartialFreeBooking = async () => {
    if (!freeChoiceDrink || !partialPopup) return
    if (isSubmitting) return
    setIsSubmitting(true)

    // Logic identisch zu vorher, gekürzt für Übersichtlichkeit
    const { free, pay } = partialPopup
    const totalPay = freeChoiceDrink.price_cents * pay
    const now = new Date().toISOString()

    // Optimistic
    setBalance(b => b + totalPay)
    setFreePool(p => Math.max(0, p - free))
    if (pay > 0) setBookings(prev => [{ created_at: now, text: `${pay}x ${freeChoiceDrink.name}`, price: totalPay, type: 'paid' }, ...prev].slice(0, 6))
    if (free > 0) setBookings(prev => [{ created_at: now, text: `${free}x ${freeChoiceDrink.name} (Frei)`, price: 0, type: 'free' }, ...prev].slice(0, 6))

    setPartialPopup(null)
    setFreeChoiceDrink(null)
    setSelectedDrink(null)
    addToast(`Mix: ${free}x Frei, ${pay}x Bezahlt`)

    try {
      const { data } = await supabase.auth.getUser(); if (!data.user) throw "No user";
      if (free > 0) {
        await supabase.from('consumptions').insert({ user_id: data.user.id, drink_id: freeChoiceDrink.id, quantity: free, unit_price_cents: 0, source: 'single', created_at: now })
        await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: free })
      }
      if (pay > 0) {
        await supabase.from('consumptions').insert({ user_id: data.user.id, drink_id: freeChoiceDrink.id, quantity: pay, unit_price_cents: freeChoiceDrink.price_cents, source: 'single', created_at: now })
        await supabase.rpc('increment_balance', { user_id_input: data.user.id, amount_input: totalPay })
      }
      refreshBookings(); loadUserStats();
    } catch (e) { console.error(e); addToast("Fehler bei Mix-Buchung", "error"); refreshBookings(); }
    finally { setIsSubmitting(false) }
  }


  const handleProvideFreeDrinks = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    const now = new Date().toISOString()
    const prevBalance = balance
    const prevPool = freePool

    setFreePool((p) => p + BOTTLES_PER_CRATE)
    setBalance((b) => b + bierPrice)
    setBookings(prev => [{ created_at: now, text: 'Runde spendiert', price: bierPrice, type: 'crate' }, ...prev].slice(0, 6))

    addToast('🍾 Runde spendiert!')
    setFreePopup(false)

    try {
      const { data } = await supabase.auth.getUser(); if (!data.user) throw "No User";
      await supabase.rpc('terminal_decrement_free_pool', { _id: FREE_POOL_ID, _used: -BOTTLES_PER_CRATE })
      await supabase.rpc('increment_balance', { user_id_input: data.user.id, amount_input: bierPrice })
      const bierDrink = drinks.find((d: any) => d.name.toLowerCase() === 'bier')
      await supabase.from('consumptions').insert({ user_id: data.user.id, drink_id: bierDrink?.id ?? null, quantity: 0, unit_price_cents: bierPrice, source: 'crate', created_at: now })
      refreshBookings(); loadUserStats();
    } catch (e) {
      console.error(e); setBalance(prevBalance); setFreePool(prevPool); addToast('Fehler', 'error'); refreshBookings();
    } finally { setIsSubmitting(false) }
  }


  const totalPrice = useMemo(() => (selectedDrink ? selectedDrink.price_cents * quantity : 0), [selectedDrink, quantity])

  // ---------------- UI ----------------
  return (
    <>
      <TopNav />
      {/* Background Gradient */}
      <div className="pt-24 min-h-screen bg-gradient-to-b from-neutral-900 via-neutral-900 to-black text-white px-4 pb-32">
        <div className="max-w-lg mx-auto space-y-8">

          {/* Header Greeting could go here if needed, but keeping it minimal */}

          {/* --- Dashboard Grid --- */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard icon={<PiggyBank />} accent="from-emerald-500/20 to-emerald-500/5" label="Kontostand" value={euro(balance)} sub="Guthaben" href="/profile" isHighlight={balance < 0} />
            <StatCard icon={<Beer />} accent="from-blue-500/20 to-blue-500/5" label="Monat" value={euro(monthTotal)} sub="Ausgaben" />
            <StatCard icon={<Gift />} accent="from-purple-500/20 to-purple-500/5" label="Freibier-Pool" value={freePool.toString()} sub="Verfügbar" />
            <StatCard icon={<Wallet />} accent="from-amber-500/20 to-amber-500/5" label="Favorit" value={favoriteDrink.split(' ')[0]} sub={favoriteDrink.includes('(') ? favoriteDrink.split('(')[1].replace(')', '') + ' mal' : ''} />
          </div>

          {/* --- Special Action: Runde spendieren --- */}
          <button
            onClick={() => setFreePopup(true)}
            className="w-full py-4 rounded-3xl bg-gradient-to-r from-emerald-900/50 to-emerald-800/30 border border-emerald-500/30 text-emerald-400 font-bold hover:bg-emerald-900/70 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all flex items-center justify-center gap-3 shadow-lg group"
          >
            <div className="p-2 bg-emerald-500/10 rounded-full group-hover:bg-emerald-500/20 transition-colors">
              <Gift size={20} />
            </div>
            <span>Runde spendieren</span>
          </button>


          {/* --- Booking Section --- */}
          <section className="bg-neutral-900/40 rounded-3xl border border-neutral-800/50 backdrop-blur-sm p-6 shadow-xl relative overflow-hidden">
            {/* Dynamic Highlight Border */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-neutral-700 to-transparent opacity-50"></div>

            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-neutral-200 flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-neutral-400" /> Getränk buchen
              </h2>
              {isSubmitting && <div className="text-xs text-neutral-500 animate-pulse">Verbuche...</div>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              {drinks.map((d) => (
                <button
                  key={d.id}
                  disabled={isSubmitting}
                  onClick={() => { setSelectedDrink(d); setQuantity(1); }}
                  className={`relative p-4 rounded-2xl border text-left transition-all duration-200 group overflow-hidden
                       ${selectedDrink?.id === d.id
                      ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.3)] scale-[1.02] z-10'
                      : 'bg-neutral-800/50 text-neutral-300 border-neutral-700/50 hover:bg-neutral-800 hover:border-neutral-600'}
                     `}
                >
                  <div className="font-bold text-lg">{d.name}</div>
                  <div className={`text-xs mt-1 font-medium opacity-80 ${selectedDrink?.id === d.id ? 'text-neutral-600' : 'text-neutral-500'}`}>
                    {euro(d.price_cents)}
                  </div>
                  {/* Selection Indicator */}
                  {selectedDrink?.id === d.id && (
                    <div className="absolute top-3 right-3 text-emerald-600"><Check size={18} strokeWidth={3} /></div>
                  )}
                </button>
              ))}
            </div>

            {/* Quantity & Action */}
            <AnimatePresence mode="wait">
              {selectedDrink ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-neutral-950/50 rounded-2xl p-4 border border-neutral-800 mb-2">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-neutral-400 text-sm">Anzahl</span>
                      <div className="flex items-center gap-4 bg-neutral-900 rounded-xl p-1 border border-neutral-800">
                        <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-10 h-10 flex items-center justify-center hover:bg-neutral-800 rounded-lg transition-colors"><Minus size={18} /></button>
                        <span className="w-8 text-center font-bold text-xl">{quantity}</span>
                        <button onClick={() => setQuantity(q => q + 1)} className="w-10 h-10 flex items-center justify-center hover:bg-neutral-800 rounded-lg transition-colors"><Plus size={18} /></button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-neutral-800">
                      <div className="text-sm text-neutral-400">Summe</div>
                      <div className="text-2xl font-bold text-white">{euro(totalPrice)}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => freePool > 0 ? (setFreeChoiceDrink(selectedDrink), setPendingQty(quantity)) : setPopup(true)}
                    disabled={isSubmitting}
                    className="w-full py-4 bg-white text-black font-bold text-lg rounded-2xl hover:bg-gray-200 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2"
                  >
                    <span>Jetzt verbuchen</span>
                    <ArrowUpRightSmall />
                  </button>
                </motion.div>
              ) : (
                <div className="h-12 flex items-center justify-center text-neutral-600 text-sm italic">
                  Wähle ein Getränk aus...
                </div>
              )}
            </AnimatePresence>
          </section>


          {/* --- Activity Feed --- */}
          <section>
            <div className="flex items-center justify-between px-2 mb-3">
              <h3 className="text-sm font-bold text-neutral-500 uppercase tracking-widest">Letzte Aktivitäten</h3>
              <Link href="/profile" className="text-xs text-neutral-400 hover:text-white transition-colors">Alle anzeigen</Link>
            </div>
            <div className="bg-neutral-900 rounded-3xl border border-neutral-800 overflow-hidden shadow-sm">
              {bookings.length === 0 ? (
                <div className="p-8 text-center text-neutral-600 text-sm">Noch keine Aktivitäten heute.</div>
              ) : (
                bookings.map((b, i) => (
                  <div key={i} className="group flex items-center justify-between p-4 border-b border-neutral-800 last:border-0 hover:bg-neutral-800/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center border border-white/5 shadow-inner
                                  ${b.type === 'free' ? 'bg-emerald-500/10 text-emerald-400' : b.type === 'crate' ? 'bg-purple-500/10 text-purple-400' : 'bg-neutral-800 text-neutral-400'}`}>
                        {b.type === 'free' ? <Gift size={18} /> : b.type === 'crate' ? <Gift size={18} /> : <Beer size={18} />}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-neutral-200">{b.text}</div>
                        <div className="text-xs text-neutral-500">{shortDate(b.created_at)}</div>
                      </div>
                    </div>
                    <div className={`font-mono text-sm font-medium ${b.type === 'free' || b.type === 'crate' ? 'text-emerald-500' : 'text-neutral-300'}`}>
                      {b.type === 'free' ? 'GRATIS' : euro(b.price)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>


        </div>

        {/* --- Modals / Popups --- */}
        <AnimatePresence>
          {/* Confirmation Popup */}
          {popup && selectedDrink && (
            <GlassPopup onClose={() => setPopup(false)}>
              <div className="text-center">
                <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Beer className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Verbuchung bestätigen</h3>
                <div className="text-neutral-400 mb-8">
                  Du buchst <strong className="text-white">{quantity}x {selectedDrink.name}</strong><br />
                  für <strong className="text-white">{euro(totalPrice)}</strong>.
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setPopup(false)} className="flex-1 py-3 bg-neutral-800 rounded-xl font-medium text-neutral-300 hover:bg-neutral-700">Abbrechen</button>
                  <button onClick={() => handlePaidBooking(selectedDrink, quantity)} className="flex-1 py-3 bg-white text-black rounded-xl font-bold hover:bg-gray-200">Bestätigen</button>
                </div>
              </div>
            </GlassPopup>
          )}

          {/* Free Choice Popup */}
          {freeChoiceDrink && (
            <GlassPopup onClose={() => setFreeChoiceDrink(null)}>
              <div className="text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-purple-900/50">
                  <Gift className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-1">Freibier verfügbar!</h3>
                <p className="text-neutral-400 text-sm mb-6">Es sind noch {freePool} Getränke im Pool.</p>

                <div className="space-y-3">
                  <button onClick={() => handleFreeBooking(freeChoiceDrink, pendingQty)} className="w-full py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-xl font-bold text-white shadow-lg hover:brightness-110 active:scale-[0.98] transition-all">
                    🎁 Als Freibier ({pendingQty}x)
                  </button>
                  <button onClick={() => handlePaidBooking(freeChoiceDrink, pendingQty)} className="w-full py-3 bg-neutral-800 rounded-xl font-medium text-neutral-300 hover:bg-neutral-700">
                    💰 Selbst bezahlen
                  </button>
                </div>
              </div>
            </GlassPopup>
          )}

          {/* Spend Round Popup */}
          {freePopup && (
            <GlassPopup onClose={() => setFreePopup(false)}>
              <div className="text-center">
                <h3 className="text-xl font-bold text-white mb-2">Runde spendieren?</h3>
                <p className="text-neutral-400 mb-6 text-sm">
                  Du stellst <strong>{BOTTLES_PER_CRATE} Freigetränke</strong> zur Verfügung.<br />
                  Dafür werden dir <strong>{euro(bierPrice)}</strong> berechnet.
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setFreePopup(false)} className="flex-1 py-3 bg-neutral-800 rounded-xl font-medium text-neutral-300 hover:bg-neutral-700">Abbrechen</button>
                  <button onClick={handleProvideFreeDrinks} className="flex-1 py-3 bg-white text-black rounded-xl font-bold hover:bg-gray-200">Kostenpflichtig buchen</button>
                </div>
              </div>
            </GlassPopup>
          )}

          {/* Partial Free Info */}
          {partialPopup && (
            <GlassPopup onClose={() => setPartialPopup(null)}>
              <div className="text-center">
                <h3 className="text-lg font-bold text-white mb-4">Teilweise Freibier</h3>
                <p className="mb-6 text-neutral-300">
                  Nur <strong>{partialPopup.free}</strong> sind noch frei.<br />
                  Der Rest (<strong>{partialPopup.pay}</strong>) wird normal berechnet.
                </p>
                <button onClick={confirmPartialFreeBooking} className="w-full py-3 bg-white text-black rounded-xl font-bold">Alles klar, buchen</button>
              </div>
            </GlassPopup>
          )}

        </AnimatePresence>

        {/* Toast Container */}
        <div className="fixed bottom-6 right-0 left-0 flex justify-center pointer-events-none z-[60]">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.9 }}
                className={`mx-4 mb-2 px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-md border border-white/10 flex items-center gap-3 pointer-events-auto
                        ${t.type === 'error' ? 'bg-red-500/90 text-white' : 'bg-emerald-600/90 text-white'}`}
              >
                {t.type === 'error' ? <X size={18} /> : <Check size={18} />}
                <span className="font-medium">{t.text}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

      </div>
    </>
  )
}


// --- Components ---

function StatCard({ icon, accent, label, value, sub, href, isHighlight }: any) {
  const Component = href ? Link : 'div'
  return (
    // @ts-ignore
    <Component href={href || '#'} className={`relative overflow-hidden rounded-3xl bg-neutral-900 border ${isHighlight ? 'border-rose-900/50' : 'border-neutral-800'} p-5 shadow-lg group`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-100`} />
      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-3 text-neutral-400">
          <div className={`p-2 rounded-xl bg-neutral-950/50 border border-white/5 shadow-inner ${isHighlight ? 'text-rose-400' : ''}`}>
            {icon}
          </div>
          <span className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</span>
        </div>
        <div>
          <div className={`text-2xl font-bold ${isHighlight ? 'text-rose-400' : 'text-neutral-100'}`}>{value}</div>
          {sub && <div className="text-[10px] text-neutral-500 font-medium mt-1">{sub}</div>}
        </div>
      </div>
    </Component>
  )
}

function GlassPopup({ children, onClose }: { children: React.ReactNode, onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.9, y: 20, opacity: 0 }}
        className="bg-neutral-900 rounded-3xl border border-neutral-800 shadow-2xl w-full max-w-sm overflow-hidden"
      >
        <div className="p-6">
          {children}
        </div>
      </motion.div>
      {/* Backdrop Click to close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </motion.div>
  )
}

function ArrowUpRightSmall() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17l9.2-9.2M17 17V7H7" />
    </svg>
  )
}
