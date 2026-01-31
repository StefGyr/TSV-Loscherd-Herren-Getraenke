'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'

import { supabase } from '@/lib/supabase-browser'

type PopupData = {
  title: string
  message: string
  onConfirm: () => void
}

type Toast = {
  id: number
  text: string
  type?: 'success' | 'error'
}

export default function AdminPage() {
  const [profiles, setProfiles] = useState<any[]>([])
  const [drinks, setDrinks] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [popup, setPopup] = useState<PopupData | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  // 🔹 Toast Helper
  const addToast = (text: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, text, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500)
  }

  // 🔹 Daten laden
  const fetchData = async () => {
    const [{ data: profData }, { data: drinkData }, { data: payData }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, name, first_name, last_name, open_balance_cents')
        .order('name', { ascending: true }),
      supabase.from('drinks').select('*').order('name', { ascending: true }),
      supabase
        .from('payments')
        .select('id, user_id, amount_cents, method, created_at, verified, profiles(first_name, last_name)')
        .eq('verified', false)
        .order('created_at', { ascending: false }),
    ])

    setProfiles(profData || [])
    setDrinks(drinkData || [])
    setPayments(payData || [])
  }

  useEffect(() => {
    fetchData()
  }, [])

  // 🔹 Farbcode für Offene Beträge
  const getOpenColor = (value: number) => {
    if (value <= 0) return 'text-green-400'
    if (value <= 5000) return 'text-yellow-400'
    return 'text-red-400'
  }

  // 🔹 Manuelle Anpassung
  const handleManualAdjust = (profileId: string, current: number) => {
    const euro = (current / 100).toFixed(2)
    const newVal = prompt(`Neuer Kontostand für diesen Nutzer (aktuell ${euro} €):`)
    if (!newVal) return
    const parsed = parseFloat(newVal.replace(',', '.'))
    if (isNaN(parsed)) return addToast('Ungültiger Betrag', 'error')

    setPopup({
      title: 'Betrag anpassen',
      message: `Soll der offene Betrag wirklich auf ${parsed.toFixed(2)} € gesetzt werden?`,
      onConfirm: async () => {
        const cents = Math.round(parsed * 100)
        const { error } = await supabase
          .from('profiles')
          .update({ open_balance_cents: cents })
          .eq('id', profileId)
        if (error) addToast('Fehler beim Speichern', 'error')
        else {
          addToast('Betrag erfolgreich angepasst', 'success')
          fetchData()
        }
      },
    })
  }

  // 🔹 Neues Getränk hinzufügen
  const handleAddDrink = async () => {
    const name = prompt('Name des neuen Getränks:')
    if (!name) return
    const { error } = await supabase
      .from('drinks')
      .insert([{ name, price_cents: 0, crate_price_cents: 0 }])
    if (error) addToast('Fehler beim Hinzufügen', 'error')
    else {
      addToast('Getränk hinzugefügt', 'success')
      fetchData()
    }
  }

  // 🔹 Preis aktualisieren
  const handlePriceChange = async (
    id: number,
    field: 'price_cents' | 'crate_price_cents',
    value: string
  ) => {
    const parsed = parseFloat(value.replace(',', '.'))
    if (isNaN(parsed)) return
    const cents = Math.round(parsed * 100)
    const { error } = await supabase.from('drinks').update({ [field]: cents }).eq('id', id)
    if (error) addToast('Fehler beim Speichern', 'error')
    else {
      addToast('Preis aktualisiert', 'success')
      setDrinks((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: cents } : d)))
    }
  }

  // 🔹 Zahlung verifizieren
  const handleVerifyPayment = (payment: any) => {
  setPopup({
    title: 'Zahlung verifizieren',
    message: `Zahlung über ${(payment.amount_cents / 100).toFixed(
      2
    )} € von ${payment.profiles?.first_name ?? ''} ${payment.profiles?.last_name ?? ''} wirklich verifizieren?`,
    onConfirm: async () => {
      // 1️⃣ Zahlung auf verified setzen
      const { error: updateError } = await supabase
        .from('payments')
        .update({ verified: true })
        .eq('id', payment.id)

      if (updateError) return addToast('Fehler beim Verifizieren', 'error')

      // 2️⃣ Profil direkt aus DB holen
      const { data: freshProfile, error: profError } = await supabase
        .from('profiles')
        .select('id, open_balance_cents')
        .eq('id', payment.user_id)
        .single()

        console.log('💡 Verifiziere:', payment.user_id, '→ Profil:', freshProfile)


      if (profError || !freshProfile) {
        addToast('Profil konnte nicht geladen werden', 'error')
        return
      }

      // 3️⃣ Kontostand neu berechnen
      const newBalance = (freshProfile.open_balance_cents || 0) - payment.amount_cents

      const { error: balanceError } = await supabase
        .from('profiles')
        .update({ open_balance_cents: newBalance })
        .eq('id', freshProfile.id)

      if (balanceError) {
        addToast('Fehler beim Aktualisieren des Kontostands', 'error')
      } else {
        addToast('Zahlung erfolgreich verifiziert ✅', 'success')
      }

      // 4️⃣ Daten neu laden
      fetchData()
    },
  })
}


  // 🔹 Zahlung ablehnen / löschen
  const handleRejectPayment = (paymentId: string) => {
    setPopup({
      title: 'Zahlung löschen',
      message: 'Soll diese gemeldete Zahlung wirklich gelöscht werden?',
      onConfirm: async () => {
        const { error } = await supabase.from('payments').delete().eq('id', paymentId)
        if (error) addToast('Fehler beim Löschen', 'error')
        else addToast('Zahlung entfernt', 'success')
        fetchData()
      },
    })
  }

  return (
    <>
      <TopNav />
      <AdminNav />
      <div className="pt-20 max-w-6xl mx-auto p-4 text-white space-y-10">
        <h1 className="text-2xl font-bold">Admin-Übersicht</h1>

      


        {/* 💳 Offene Zahlungen */}
        <section className="bg-gray-800/70 p-4 rounded border border-gray-700 space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-3">💳 Offene Zahlungen zur Verifizierung</h2>
            {payments.length === 0 ? (
              <p className="text-gray-400 text-sm">Keine offenen Zahlungen vorhanden.</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700">
                    <th className="text-left py-2">Nutzer</th>
                    <th className="text-right py-2">Betrag (€)</th>
                    <th className="text-right py-2">Methode</th>
                    <th className="text-right py-2">Datum</th>
                    <th className="text-right py-2">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-t border-gray-700">
                      <td className="py-2">
                        {p.profiles?.first_name} {p.profiles?.last_name}
                      </td>
                      <td className="py-2 text-right font-semibold">
                        {(p.amount_cents / 100).toFixed(2)}
                      </td>
                      <td className="py-2 text-right">
                        {p.method === 'paypal' ? 'PayPal' : 'Bar'}
                      </td>
                      <td className="py-2 text-right text-gray-400">
                        {new Date(p.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => handleVerifyPayment(p)}
                          className="bg-green-700 hover:bg-green-800 text-xs px-3 py-1 rounded mr-2"
                        >
                          ✅ Verifizieren
                        </button>
                        <button
                          onClick={() => handleRejectPayment(p.id)}
                          className="bg-red-700 hover:bg-red-800 text-xs px-3 py-1 rounded"
                        >
                          ❌ Löschen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 📜 Letzte verifizierte Zahlungen */}
          <div className="pt-4 border-t border-gray-700">
            <h3 className="text-lg font-semibold mb-2">📜 Letzte verifizierte Zahlungen</h3>
            <VerifiedPaymentsList />
          </div>
        </section>

        {/* 🥤 Getränke */}
        <section className="mb-10">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-semibold">🥤 Getränke & Kistenpreise</h2>
            <button
              onClick={handleAddDrink}
              className="bg-blue-700 hover:bg-blue-800 px-3 py-1 rounded"
            >
              + Neues Getränk
            </button>
          </div>

          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gray-800 text-gray-300">
                <th className="p-2">Name</th>
                <th className="p-2 text-right">Preis (€)</th>
                <th className="p-2 text-right">Kistenpreis (€)</th>
              </tr>
            </thead>
            <tbody>
              {drinks.map((d) => (
                <tr key={d.id} className="border-t border-gray-700">
                  <td className="p-2">{d.name}</td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={(d.price_cents / 100).toFixed(2)}
                      onBlur={(e) => handlePriceChange(d.id, 'price_cents', e.target.value)}
                      className="bg-gray-900 border border-gray-700 rounded text-right w-20 p-1 text-white"
                    />
                  </td>
                  <td className="p-2 text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={(d.crate_price_cents / 100).toFixed(2)}
                      onBlur={(e) => handlePriceChange(d.id, 'crate_price_cents', e.target.value)}
                      className="bg-gray-900 border border-gray-700 rounded text-right w-20 p-1 text-white"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* 👥 Nutzerübersicht */}
        <section>
          <h2 className="text-xl font-semibold mb-2">👥 Nutzer & Offene Posten</h2>
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-gray-800 text-gray-300">
                <th className="p-2">Name</th>
                <th className="p-2 text-right">Offen (€)</th>
                <th className="p-2 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id} className="border-t border-gray-700">
                  <td className="p-2">
                    {p.name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Unbekannt'}
                  </td>
                  <td
                    className={`p-2 text-right font-semibold ${getOpenColor(
                      p.open_balance_cents
                    )}`}
                  >
                    {(p.open_balance_cents / 100).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => handleManualAdjust(p.id, p.open_balance_cents)}
                      className="bg-blue-700 hover:bg-blue-800 text-xs px-3 py-1 rounded"
                    >
                      Betrag ändern
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Zusammenfassungen getrennt anzeigen */}
<div className="mt-6 space-y-2 text-right text-lg">
  {/* 1️⃣ Offene Posten (nur positive Werte) */}
  <div>
    Offene Posten:{' '}
    <span className="text-red-400 font-semibold">
      {(
        profiles
          .filter((p) => (p.open_balance_cents || 0) > 0)
          .reduce((acc, p) => acc + p.open_balance_cents, 0) / 100
      ).toFixed(2)} € 
    </span>
  </div>

  {/* 2️⃣ Gutschriften (nur negative Werte) */}
  <div>
    Gutschriften / Guthaben:{' '}
    <span className="text-green-400 font-semibold">
      {(
        profiles
          .filter((p) => (p.open_balance_cents || 0) < 0)
          .reduce((acc, p) => acc + p.open_balance_cents, 0) / 100
      ).toFixed(2)} € 
    </span>
  </div>

  {/* 3️⃣ Summe aus beiden (optional) */}
  <div className="pt-2 border-t border-gray-700">
    Gesamt (Saldo):{' '}
    <span className="font-semibold">
      {(
        profiles.reduce((acc, p) => acc + (p.open_balance_cents || 0), 0) / 100
      ).toFixed(2)} €
    </span>
  </div>
</div>

        </section>

        {/* Popup */}
        <AnimatePresence>
          {popup && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-gray-800 p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center border border-gray-700"
              >
                <h3 className="text-lg font-semibold mb-2">{popup.title}</h3>
                <p className="text-sm text-gray-300 mb-6">{popup.message}</p>
                <div className="flex justify-center gap-4">
                  <button
                    onClick={() => setPopup(null)}
                    className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={() => {
                      popup.onConfirm()
                      setPopup(null)
                    }}
                    className="px-4 py-2 bg-green-700 rounded hover:bg-green-800"
                  >
                    Bestätigen
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toasts */}
        <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-50">
          <AnimatePresence>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className={`px-4 py-2 rounded-lg text-sm shadow-lg ${
                  t.type === 'error' ? 'bg-red-700/80' : 'bg-green-700/80'
                } text-white`}
              >
                {t.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}

/* 🔹 Unterkomponente: Letzte verifizierte Zahlungen */
function VerifiedPaymentsList() {
  const [verified, setVerified] = useState<any[]>([])

  useEffect(() => {
    const fetchVerified = async () => {
      const { data } = await supabase
        .from('payments')
        .select('amount_cents, method, created_at, profiles(first_name,last_name)')
        .eq('verified', true)
        .order('created_at', { ascending: false })
        .limit(10)
      setVerified(data || [])
    }
    fetchVerified()
  }, [])

  if (verified.length === 0)
    return <p className="text-gray-400 text-sm">Noch keine Zahlungen verifiziert.</p>

  return (
    <ul className="space-y-1 text-sm">
      {verified.map((v, i) => (
        <li key={i} className="flex justify-between border-b border-gray-800 py-1">
          <span>
            {v.profiles?.first_name} {v.profiles?.last_name}{' '}
            <span className="text-gray-400">
              ({v.method === 'paypal' ? 'PayPal' : 'Bar'})
            </span>
          </span>
          <span className="text-right text-green-400 font-semibold">
            {(v.amount_cents / 100).toFixed(2)} €
          </span>
        </li>
      ))}
    </ul>
  )
}
