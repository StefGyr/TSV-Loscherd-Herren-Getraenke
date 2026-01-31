'use client'

import { useEffect, useState } from 'react'
import TopNav from '@/components/TopNav'
import AdminNav from '@/components/AdminNav'
import { supabase } from '@/lib/supabase-browser'

type Profile = {
  id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  open_balance_cents: number | null
}

type Payment = {
  user_id: string
  amount_cents: number
  verified: boolean
  created_at: string
}

type PaymentSummary = {
  lastPaymentAt: string | null
  lastPaymentAmountCents: number | null
  totalPaidCents: number
}

type ConsumptionEntry = {
  id: number
  quantity: number
  unit_price_cents: number | null
  source: string | null
  created_at: string
  drinks: {
    name: string | null
  } | null
}

export default function OpenBalancesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  // 🔹 Detail-Ansicht für einen ausgewählten Nutzer
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
  const [userConsumptions, setUserConsumptions] = useState<ConsumptionEntry[]>([])
  const [detailsLoading, setDetailsLoading] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)

      const [{ data: profData }, { data: payData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, name, first_name, last_name, open_balance_cents')
          .order('name', { ascending: true }),
        supabase
          .from('payments')
          .select('user_id, amount_cents, verified, created_at')
          .eq('verified', true)
          .order('created_at', { ascending: false }),
      ])

      setProfiles(profData || [])
      setPayments(payData || [])
      setLoading(false)
    }

    fetchData()
  }, [])

  // 🔹 Nur Nutzer mit Saldo ≠ 0 anzeigen
  const profilesWithBalance = profiles.filter(
    (p) => (p.open_balance_cents || 0) !== 0
  )

  // 🔹 Payment-Summaries pro User berechnen
  const paymentSummaryMap: Record<string, PaymentSummary> = {}

  for (const p of payments) {
    if (!paymentSummaryMap[p.user_id]) {
      paymentSummaryMap[p.user_id] = {
        lastPaymentAt: p.created_at,
        lastPaymentAmountCents: p.amount_cents,
        totalPaidCents: p.amount_cents,
      }
    } else {
      const current = paymentSummaryMap[p.user_id]
      current.totalPaidCents += p.amount_cents
    }
  }

  // 🔹 Gesamtsummen für oben
  const totalOpenCents = profilesWithBalance
    .filter((p) => (p.open_balance_cents || 0) > 0)
    .reduce((acc, p) => acc + (p.open_balance_cents || 0), 0)

  const totalCreditCents = profilesWithBalance
    .filter((p) => (p.open_balance_cents || 0) < 0)
    .reduce((acc, p) => acc + (p.open_balance_cents || 0), 0)

  const totalSaldoCents = profilesWithBalance
    .reduce((acc, p) => acc + (p.open_balance_cents || 0), 0)

  const formatEuro = (cents: number | null | undefined) =>
    ((cents || 0) / 100).toFixed(2) + ' €'

  const getRowColor = (value: number) => {
    if (value < 0) return 'text-green-400'
    if (value === 0) return 'text-gray-300'
    if (value <= 5000) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getStatus = (value: number) => {
    if (value > 0) return 'Schuldet noch'
    if (value < 0) return 'Guthaben'
    return 'Ausgeglichen'
  }

  const getDisplayName = (p: Profile) =>
    p.name ||
    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
    'Unbekannt'

  // 🔹 Details eines Nutzers laden (letzte Buchungen)
  const loadUserDetails = async (profile: Profile) => {
    setSelectedUser(profile)
    setDetailsLoading(true)
    setUserConsumptions([])

    const { data: consData } = await supabase
      .from('consumptions')
      .select('id, quantity, unit_price_cents, source, created_at, drinks(name)')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(25)

    setUserConsumptions((consData as any as ConsumptionEntry[]) || [])
    setDetailsLoading(false)
  }

  // 🔹 Summen für die Detailansicht
  const selectedSaldo = selectedUser?.open_balance_cents || 0
  const selectedPaymentInfo = selectedUser ? paymentSummaryMap[selectedUser.id] : undefined

  const totalConsumedCents = userConsumptions.reduce(
    (acc, c) => acc + ((c.unit_price_cents || 0) * (c.quantity || 0)),
    0
  )

  return (
    <>
      <TopNav />
      <AdminNav />
      <div className="pt-20 max-w-6xl mx-auto p-4 text-white space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Offene Posten – Detailansicht</h1>
            <p className="text-sm text-gray-400">
              Übersicht aller Nutzer mit offenem Saldo oder Guthaben.
            </p>
          </div>
        </div>

        {/* 🔹 Zusammenfassung oben */}
        <section className="bg-gray-900/70 border border-gray-700 rounded-xl p-4 grid gap-4 md:grid-cols-3 text-sm">
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wide">
              Offene Posten (nur Schulden)
            </div>
            <div className="mt-1 text-lg font-semibold text-red-400">
              {formatEuro(totalOpenCents)}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wide">
              Gutschriften / Guthaben
            </div>
            <div className="mt-1 text-lg font-semibold text-green-400">
              {formatEuro(totalCreditCents)}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wide">
              Gesamt-Saldo (System)
            </div>
            <div className="mt-1 text-lg font-semibold">
              {formatEuro(totalSaldoCents)}
            </div>
          </div>
        </section>

        {/* 🔹 Tabelle: Nutzer mit Saldo */}
        <section>
          <h2 className="text-xl font-semibold mb-2">
            Nutzer mit offenen Posten / Guthaben
          </h2>

          {loading ? (
            <p className="text-gray-400 text-sm">Lade Daten…</p>
          ) : profilesWithBalance.length === 0 ? (
            <p className="text-gray-400 text-sm">
              Aktuell keine offenen Posten oder Guthaben vorhanden.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 text-gray-300">
                    <th className="p-2 text-left">Name</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-right">Saldo</th>
                    <th className="p-2 text-right">Letzte Zahlung</th>
                    <th className="p-2 text-right">Summe Zahlungen</th>
                    <th className="p-2 text-right">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {profilesWithBalance.map((p) => {
                    const saldo = p.open_balance_cents || 0
                    const payInfo = paymentSummaryMap[p.id]

                    return (
                      <tr
                        key={p.id}
                        className="border-t border-gray-800 hover:bg-gray-900/60"
                      >
                        <td className="p-2">{getDisplayName(p)}</td>
                        <td className="p-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-800 border border-gray-700">
                            {getStatus(saldo)}
                          </span>
                        </td>
                        <td className={`p-2 text-right font-semibold ${getRowColor(saldo)}`}>
                          {formatEuro(saldo)}
                        </td>
                        <td className="p-2 text-right text-gray-300">
                          {payInfo?.lastPaymentAt ? (
                            <>
                              <div>
                                {new Date(
                                  payInfo.lastPaymentAt
                                ).toLocaleDateString()}
                              </div>
                              <div className="text-xs text-green-400">
                                {formatEuro(payInfo.lastPaymentAmountCents)}
                              </div>
                            </>
                          ) : (
                            <span className="text-gray-500 text-xs">
                              Keine verifizierte Zahlung
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right text-gray-300">
                          {payInfo ? (
                            formatEuro(payInfo.totalPaidCents)
                          ) : (
                            <span className="text-gray-500 text-xs">–</span>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          <button
                            onClick={() => loadUserDetails(p)}
                            className="px-3 py-1 text-xs rounded bg-blue-700 hover:bg-blue-800"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 🔹 Detailansicht für ausgewählten Nutzer */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Detailansicht Nutzer</h2>

          {!selectedUser ? (
            <p className="text-gray-400 text-sm">
              Wähle oben einen Nutzer über „Details“ aus, um die letzten Buchungen zu sehen.
            </p>
          ) : (
            <div className="bg-gray-900/70 border border-gray-700 rounded-xl p-4 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div>
                  <div className="text-sm text-gray-400">Nutzer</div>
                  <div className="text-lg font-semibold">
                    {getDisplayName(selectedUser)}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-gray-400 text-xs uppercase tracking-wide">
                    Aktueller Saldo
                  </div>
                  <div className={`text-lg font-semibold ${getRowColor(selectedSaldo)}`}>
                    {formatEuro(selectedSaldo)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3 text-sm">
                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide">
                    Letzte verifizierte Zahlung
                  </div>
                  {selectedPaymentInfo?.lastPaymentAt ? (
                    <div className="mt-1">
                      <div>
                        {new Date(
                          selectedPaymentInfo.lastPaymentAt
                        ).toLocaleDateString()}
                      </div>
                      <div className="text-green-400">
                        {formatEuro(selectedPaymentInfo.lastPaymentAmountCents)}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-gray-500 text-xs">
                      Keine verifizierte Zahlung
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide">
                    Summe verifizierte Zahlungen
                  </div>
                  <div className="mt-1">
                    {selectedPaymentInfo
                      ? formatEuro(selectedPaymentInfo.totalPaidCents)
                      : '–'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs uppercase tracking-wide">
                    Summe der letzten Buchungen (bezahlt / berechnet)
                  </div>
                  <div className="mt-1">
                    {formatEuro(totalConsumedCents)}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-800">
                <h3 className="text-lg font-semibold mb-2">
                  Letzte Buchungen (consumptions)
                </h3>

                {detailsLoading ? (
                  <p className="text-gray-400 text-sm">Lade Buchungen…</p>
                ) : userConsumptions.length === 0 ? (
                  <p className="text-gray-400 text-sm">
                    Keine Buchungen gefunden.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs md:text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-800 text-gray-300">
                          <th className="p-2 text-left">Datum</th>
                          <th className="p-2 text-left">Getränk</th>
                          <th className="p-2 text-right">Menge</th>
                          <th className="p-2 text-right">Preis/Einheit</th>
                          <th className="p-2 text-right">Gesamt</th>
                          <th className="p-2 text-left">Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {userConsumptions.map((c) => {
                          const unit = c.unit_price_cents || 0
                          const total = unit * (c.quantity || 0)
                          const isFree = unit === 0

                          return (
                            <tr
                              key={c.id}
                              className="border-t border-gray-800 hover:bg-gray-900/60"
                            >
                              <td className="p-2">
                                {new Date(c.created_at).toLocaleString()}
                              </td>
                              <td className="p-2">
                                {c.drinks?.name || 'Unbekannt'}
                              </td>
                              <td className="p-2 text-right">{c.quantity}</td>
                              <td className="p-2 text-right">
                                {formatEuro(unit)}
                              </td>
                              <td className="p-2 text-right">
                                {formatEuro(total)}
                              </td>
                              <td className="p-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] md:text-xs bg-gray-800 border border-gray-700">
                                  {isFree
                                    ? 'Freibier / kostenlos'
                                    : c.source === 'crate'
                                    ? 'Kiste'
                                    : 'Einzelbuchung'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <p className="text-xs text-gray-500">
          Hinweis: Die Salden basieren auf <code>open_balance_cents</code> in den
          Profilen. Zahlungen werden nur berücksichtigt, wenn sie als
          verifiziert markiert sind.
        </p>
      </div>
    </>
  )
}
