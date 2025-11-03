'use client'

import { useState } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'

export default function PlatzbelegungAdmin() {
  const [rows, setRows] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // 🔹 CSV einlesen
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse(file, {
      header: true,
      delimiter: ';',
      skipEmptyLines: true,
      complete: (result: Papa.ParseResult<any>) => {
        setRows(result.data)
        setMessage(`${result.data.length} Zeilen geladen ✅`)
      },
    })
  }

  // 🔹 CSV in Supabase speichern (mit automatischem Löschen alter Daten)
  const handleUpload = async () => {
    if (!rows.length) return setMessage('⚠️ Keine Daten geladen')
    setUploading(true)
    setMessage('⏳ Alte Daten werden gelöscht...')

    // 1️⃣ Alte Daten löschen
    const { error: delError } = await supabase.from('platzbelegung').delete().neq('id', 0)
    if (delError) {
      console.error('Fehler beim Löschen:', delError)
      setUploading(false)
      return setMessage(`❌ Fehler beim Löschen: ${delError.message}`)
    }

    // 2️⃣ Neue Daten vorbereiten
    const mapped = rows.map((r) => ({
      date: r['Datum']
        ? r['Datum'].split('.').reverse().join('-') // z. B. 25.10.2025 → 2025-10-25
        : null,
      time: r['Zeit'] || null,
      team_home: r['Heim'] || null,
      team_guest: r['Gast'] || null,
      competition: r['Wettbewerb'] || null,
      section: r['Abschnitt'] || null,
      field: r['Platz'] || null,
      location: r['Spielort'] || null,
    }))

    // 3️⃣ Neue Daten einfügen
    setMessage('📤 Lade neue Daten hoch...')
    const { error: insertError } = await supabase.from('platzbelegung').insert(mapped)
    setUploading(false)

    if (insertError) {
  console.error('Fehler beim Einfügen:', insertError)
  setMessage(`❌ Fehler beim Speichern: ${insertError.message}`)
} else {
  // 🕒 updated_at erzwingen, damit Realtime/Fallback anspringt
  await supabase
    .from('platzbelegung')
    .update({ updated_at: new Date().toISOString() })
    .neq('id', 0)

  setMessage(`✅ ${mapped.length} Einträge erfolgreich importiert!`)
  setRows([]) // CSV-Tabelle zurücksetzen
}

  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <TopNav />
      <div className="max-w-5xl mx-auto pt-20 px-6">
        <h1 className="text-3xl font-semibold mb-8">📅 Platzbelegung – CSV Import</h1>

        <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-900/50">
          <p className="text-neutral-400 mb-4">
            Lade hier die aktuelle Wochenplanung als{' '}
            <strong>CSV (Semikolon-getrennt)</strong> hoch.
          </p>

          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-sm text-neutral-300 bg-neutral-800 rounded-lg border border-neutral-700 p-2 mb-4"
          />

          <button
            onClick={handleUpload}
            disabled={uploading || !rows.length}
            className={`px-6 py-3 rounded-xl ${
              uploading ? 'bg-neutral-700' : 'bg-green-600 hover:bg-green-700'
            } text-white font-medium transition`}
          >
            {uploading ? 'Wird hochgeladen...' : '📤 Daten speichern'}
          </button>

          {message && <p className="mt-4 text-sm text-neutral-400">{message}</p>}
        </div>

        {/* 🔹 Vorschau */}
        {rows.length > 0 && (
          <div className="mt-8 border border-neutral-800 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800 text-neutral-400">
                <tr>
                  <th className="px-3 py-2 text-left">Datum</th>
                  <th className="px-3 py-2 text-left">Zeit</th>
                  <th className="px-3 py-2 text-left">Heim</th>
                  <th className="px-3 py-2 text-left">Gast</th>
                  <th className="px-3 py-2 text-left">Wettbewerb</th>
                  <th className="px-3 py-2 text-left">Abschnitt</th>
                  <th className="px-3 py-2 text-left">Platz</th>
                  <th className="px-3 py-2 text-left">Spielort</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 15).map((r, i) => (
                  <tr
                    key={i}
                    className="border-b border-neutral-800 hover:bg-neutral-800/50"
                  >
                    <td className="px-3 py-2">{r['Datum']}</td>
                    <td className="px-3 py-2">{r['Zeit']}</td>
                    <td className="px-3 py-2">{r['Heim']}</td>
                    <td className="px-3 py-2">{r['Gast']}</td>
                    <td className="px-3 py-2">{r['Wettbewerb']}</td>
                    <td className="px-3 py-2">{r['Abschnitt']}</td>
                    <td className="px-3 py-2">{r['Platz']}</td>
                    <td className="px-3 py-2">{r['Spielort']}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="text-center text-xs text-neutral-500 py-2">
              {rows.length > 15 && `... ${rows.length - 15} weitere Zeilen`}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
