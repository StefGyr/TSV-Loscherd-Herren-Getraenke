'use client'

import { useState, useEffect, useCallback } from 'react'
import Papa from 'papaparse'
import { supabase } from '@/lib/supabase-browser'
import TopNav from '@/components/TopNav'
import { FileText, Upload, Table as TableIcon, CheckCircle2, AlertCircle, Loader2, Edit2, Trash2, Plus, X, Save } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function PlatzbelegungAdmin() {
  const [rows, setRows] = useState<any[]>([])
  const [savedEntries, setSavedEntries] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null)

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<any | null>(null)

  const loadSavedEntries = useCallback(async () => {
    setLoadingSaved(true)
    const { data, error } = await supabase
      .from('platzbelegung')
      .select('*')
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (error) {
      console.error('Fehler beim Laden:', error)
    } else {
      setSavedEntries(data || [])
    }
    setLoadingSaved(false)
  }, [])

  useEffect(() => {
    loadSavedEntries()
  }, [loadSavedEntries])

  // 🔹 CSV einlesen
  const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)

    Papa.parse(file, {
      header: true,
      delimiter: ';',
      skipEmptyLines: true,
      complete: (result: Papa.ParseResult<any>) => {
        const mapped = result.data.map((r: any) => ({
          date: r['Datum']?.split('.').reverse().join('-') || null,
          time: r['Zeit'] || null,
          team_home: r['Heim'] || null,
          team_guest: r['Gast'] || null,
          competition: r['Wettbewerb'] || null,
          section: r['Abschnitt'] || null,
          field: r['Platz'] || null,
          location: r['Spielort'] || null,
        }))
        setRows(mapped)
        setParsing(false)
        setMessage({ text: `${mapped.length} Zeilen aus CSV geladen ✅`, type: 'info' })
      },
    })
  }

  // 🔹 PDF einlesen (über API)
  const handlePdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true)
    setMessage(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/admin/parse-spielplan', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setRows(data.matches)
      setMessage({ text: `${data.matches.length} Spiele aus PDF extrahiert ✅`, type: 'info' })
    } catch (err: any) {
      setMessage({ text: `Fehler beim PDF-Parsing: ${err.message}`, type: 'error' })
    } finally {
      setParsing(false)
    }
  }

  // 🔹 Gesamten Import speichern
  const handleUpload = async () => {
    if (!rows.length) return setMessage({ text: '⚠️ Keine Daten geladen', type: 'error' })
    setUploading(true)
    setMessage({ text: '⏳ Alte Daten werden gelöscht...', type: 'info' })

    const { error: delError } = await supabase.from('platzbelegung').delete().neq('id', 0)
    if (delError) {
      setUploading(false)
      return setMessage({ text: `❌ Fehler beim Löschen: ${delError.message}`, type: 'error' })
    }

    setMessage({ text: '📤 Lade neue Daten hoch...', type: 'info' })
    const { error: insertError } = await supabase.from('platzbelegung').insert(rows)
    setUploading(false)

    if (insertError) {
      setMessage({ text: `❌ Fehler beim Speichern: ${insertError.message}`, type: 'error' })
    } else {
      await supabase
        .from('sync_status')
        .upsert({ key: 'platzbelegung', last_update: new Date().toISOString() }, { onConflict: 'key' })

      setMessage({ text: `✅ ${rows.length} Einträge erfolgreich importiert!`, type: 'success' })
      setRows([])
      loadSavedEntries()
    }
  }

  // 🔹 Einzelnen Eintrag löschen
  const handleDelete = async (id: string) => {
    if (!confirm('Diesen Eintrag wirklich löschen?')) return

    const { error } = await supabase.from('platzbelegung').delete().eq('id', id)
    if (error) {
      alert('Fehler beim Löschen: ' + error.message)
    } else {
      loadSavedEntries()
    }
  }

  // 🔹 Einzelnen Eintrag speichern (Neu oder Edit)
  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault()
    setUploading(true)

    const payload = {
      date: editingEntry.date,
      time: editingEntry.time,
      team_home: editingEntry.team_home,
      team_guest: editingEntry.team_guest,
      competition: editingEntry.competition,
      section: editingEntry.section,
      field: editingEntry.field,
      location: editingEntry.location,
    }

    let error
    if (editingEntry.id) {
      // Update
      const { error: err } = await supabase.from('platzbelegung').update(payload).eq('id', editingEntry.id)
      error = err
    } else {
      // Insert
      const { error: err } = await supabase.from('platzbelegung').insert([payload])
      error = err
    }

    setUploading(false)
    if (error) {
      alert('Fehler beim Speichern: ' + error.message)
    } else {
      setIsModalOpen(false)
      loadSavedEntries()
      // Sync signal
      await supabase
        .from('sync_status')
        .upsert({ key: 'platzbelegung', last_update: new Date().toISOString() }, { onConflict: 'key' })
    }
  }

  const openEditModal = (entry: any = null) => {
    setEditingEntry(entry || {
      date: new Date().toISOString().split('T')[0],
      time: '18:00',
      team_home: '',
      team_guest: '',
      competition: 'Meisterschaft',
      section: 'Herren',
      field: '1',
      location: 'Sportanlage Lonnerstadt',
    })
    setIsModalOpen(true)
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <TopNav />
      <div className="max-w-6xl mx-auto pt-24 pb-24 px-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">📅 Platzbelegung Verwalten</h1>
          <div className="flex gap-3">
            <button onClick={() => openEditModal()} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm flex items-center gap-2 font-bold shadow-lg shadow-green-900/20 transition">
              <Plus size={16} /> Neu hinzufügen
            </button>
            <a href="/platzbelegung" className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 rounded-lg border border-neutral-700 text-sm flex items-center gap-2 transition">
              <TableIcon size={16} /> Übersicht & Teilen
            </a>
          </div>
        </div>

        {/* --- Import Sektion --- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* CSV Import */}
          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-900/40 hover:border-neutral-700 transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                <TableIcon size={24} />
              </div>
              <h2 className="text-lg font-semibold">CSV Import</h2>
            </div>
            <p className="text-neutral-400 text-sm mb-6">
              Wochenplanung als CSV hochladen. <strong>Hinweis:</strong> Löscht alle alten Einträge!
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvChange}
              className="block w-full text-xs text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
            />
          </div>

          {/* PDF Import */}
          <div className="border border-neutral-800 rounded-2xl p-6 bg-neutral-900/40 hover:border-neutral-700 transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
                <FileText size={24} />
              </div>
              <h2 className="text-lg font-semibold">BFV PDF Import</h2>
            </div>
            <p className="text-neutral-400 text-sm mb-6">
              Original BFV PDF hochladen. <strong>Hinweis:</strong> Löscht alle alten Einträge!
            </p>
            <input
              type="file"
              accept=".pdf"
              onChange={handlePdfChange}
              className="block w-full text-xs text-neutral-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer"
            />
          </div>
        </div>

        {/* Status Message */}
        {message && (
          <div className={`mb-8 p-4 rounded-xl flex items-center gap-3 border shadow-lg ${message.type === 'success' ? 'bg-emerald-950/30 border-emerald-800 text-emerald-400' :
            message.type === 'error' ? 'bg-rose-950/30 border-rose-800 text-rose-400' :
              'bg-blue-950/30 border-blue-800 text-blue-400'
            }`}>
            {message.type === 'success' ? <CheckCircle2 size={20} /> :
              message.type === 'error' ? <AlertCircle size={20} /> : <Loader2 size={20} className={parsing ? 'animate-spin' : ''} />}
            <p className="text-sm font-medium">{message.text}</p>
          </div>
        )}

        {/* Preview of Parsed Data (Before saving) */}
        {rows.length > 0 && (
          <div className="mb-12 border border-blue-800/50 rounded-2xl overflow-hidden bg-blue-950/10 animate-in fade-in zoom-in-95">
            <div className="p-4 bg-blue-900/20 flex justify-between items-center border-b border-blue-800/40">
              <h3 className="font-semibold text-blue-400 flex items-center gap-2 uppercase tracking-wider text-xs">
                <TableIcon size={16} /> Import-Vorschau ({rows.length})
              </h3>
              <div className="flex gap-2">
                <button onClick={() => setRows([])} className="px-4 py-1.5 rounded-lg text-xs font-semibold text-neutral-400 hover:text-white transition">Abbrechen</button>
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="px-6 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-2"
                >
                  {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  Alles überschreiben & speichern
                </button>
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto">
              <Table entries={rows.slice(0, 10)} readOnly />
              {rows.length > 10 && <div className="p-3 text-center text-[10px] text-neutral-600 italic">... und {rows.length - 10} weitere</div>}
            </div>
          </div>
        )}

        {/* --- Gespeicherte Einträge --- */}
        <div className="border border-neutral-800 rounded-3xl overflow-hidden bg-neutral-900/20 shadow-xl">
          <div className="p-6 border-b border-neutral-800 flex justify-between items-center">
            <div>
              <h3 className="text-xl font-bold">Aktuelle Belegung</h3>
              <p className="text-xs text-neutral-500 mt-1 uppercase tracking-widest font-semibold italic">Daten in der Datenbank</p>
            </div>
            <button
              onClick={loadSavedEntries}
              className="p-2 hover:bg-neutral-800 rounded-lg transition text-neutral-400"
              title="Aktualisieren"
            >
              <RefreshCwIcon size={20} className={loadingSaved ? 'animate-spin' : ''} />
            </button>
          </div>

          {loadingSaved ? (
            <div className="py-20 flex flex-col items-center">
              <Loader2 size={40} className="animate-spin text-green-500 mb-4" />
              <p className="text-neutral-500 text-sm">Lade gespeicherte Daten...</p>
            </div>
          ) : savedEntries.length === 0 ? (
            <div className="py-20 text-center text-neutral-500">
              <TableIcon size={48} className="mx-auto mb-4 opacity-20" />
              <p>Keine gespeicherten Einträge gefunden.</p>
              <p className="text-xs mt-2">Nutze den Import oder füge manuell ein Spiel hinzu.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table
                entries={savedEntries}
                onEdit={openEditModal}
                onDelete={handleDelete}
              />
            </div>
          )}
        </div>
      </div>

      {/* --- Edit/Add Modal --- */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setIsModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-neutral-900 border border-neutral-800 w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-neutral-800 flex justify-between items-center">
                <h3 className="text-xl font-bold">{editingEntry?.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-neutral-800 rounded-full transition">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveManual} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Datum</label>
                    <input
                      type="date" required
                      value={editingEntry.date || ''}
                      onChange={e => setEditingEntry({ ...editingEntry, date: e.target.value })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Uhrzeit</label>
                    <input
                      type="text" placeholder="18:00" required
                      value={editingEntry.time || ''}
                      onChange={e => setEditingEntry({ ...editingEntry, time: e.target.value })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Heimteam</label>
                  <input
                    type="text" required
                    value={editingEntry.team_home || ''}
                    onChange={e => setEditingEntry({ ...editingEntry, team_home: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Gastteam</label>
                  <input
                    type="text" required
                    value={editingEntry.team_guest || ''}
                    onChange={e => setEditingEntry({ ...editingEntry, team_guest: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Abteilung</label>
                    <select
                      value={editingEntry.section || ''}
                      onChange={e => setEditingEntry({ ...editingEntry, section: e.target.value })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                    >
                      <option value="Herren">Herren</option>
                      <option value="Frauen">Frauen</option>
                      <option value="A-Junioren">A-Junioren</option>
                      <option value="B-Junioren">B-Junioren</option>
                      <option value="C-Junioren">C-Junioren</option>
                      <option value="D-Junioren">D-Junioren</option>
                      <option value="E-Junioren">E-Junioren</option>
                      <option value="Juniorinnen">Juniorinnen</option>
                      <option value="AH">AH (Ü32)</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Platz</label>
                    <select
                      value={editingEntry.field || ''}
                      onChange={e => setEditingEntry({ ...editingEntry, field: e.target.value })}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                    >
                      <option value="1">Platz 1</option>
                      <option value="2">Platz 2</option>
                      <option value="3">Platz 3</option>
                      <option value="">Auswärts / Sonstiges</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Wettbewerb / Liga</label>
                  <input
                    type="text"
                    value={editingEntry.competition || ''}
                    onChange={e => setEditingEntry({ ...editingEntry, competition: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                  />
                </div>

                <div className="space-y-1 pb-4">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase ml-1">Spielort (Text)</label>
                  <input
                    type="text"
                    value={editingEntry.location || ''}
                    onChange={e => setEditingEntry({ ...editingEntry, location: e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-green-500/50 outline-none transition"
                  />
                </div>

                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-bold shadow-lg shadow-green-900/30 transition flex items-center justify-center gap-2"
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                  Speichern
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Table({ entries, readOnly = false, onEdit, onDelete }: { entries: any[], readOnly?: boolean, onEdit?: (e: any) => void, onDelete?: (id: string) => void }) {
  return (
    <table className="w-full text-sm text-left">
      <thead className="bg-neutral-800/30 text-neutral-500 uppercase text-[10px] tracking-widest font-black">
        <tr>
          <th className="px-6 py-4">Datum/Uhrzeit</th>
          <th className="px-6 py-4">Partie</th>
          <th className="px-6 py-4">Wettbewerb</th>
          <th className="px-6 py-4">Platz / Ort</th>
          {!readOnly && <th className="px-6 py-4 text-right">Aktion</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-800/50">
        {entries.map((r, i) => (
          <tr key={r.id || i} className="hover:bg-neutral-800/20 transition group">
            <td className="px-6 py-4">
              <div className="font-bold text-white">{r.date?.split('-').reverse().join('.')}</div>
              <div className="text-xs text-neutral-500 font-medium">{r.time} Uhr</div>
            </td>
            <td className="px-6 py-4">
              <div className="font-bold text-neutral-200">{r.team_home}</div>
              <div className="text-xs text-neutral-500 italic">vs. {r.team_guest}</div>
            </td>
            <td className="px-6 py-4">
              <div className="inline-block px-1.5 py-0.5 bg-neutral-800 rounded text-[9px] font-black uppercase text-neutral-400 mb-1 leading-none">{r.section}</div>
              <div className="text-xs text-neutral-500 truncate max-w-[150px]">{r.competition?.replace(/^ME/, '')}</div>
            </td>
            <td className="px-6 py-4">
              <div className={`text-xs font-black uppercase tracking-wider ${r.field === '1' ? 'text-emerald-400' : r.field === '2' ? 'text-blue-400' : 'text-neutral-500'}`}>
                {r.field ? `Platz ${r.field}` : 'Auswärts'}
              </div>
              <div className="text-[10px] text-neutral-600 truncate max-w-[150px] italic">{r.location?.split(',')[0]}</div>
            </td>
            {!readOnly && (
              <td className="px-6 py-4 text-right">
                <div className="flex justify-end gap-1">
                  <button
                    onClick={() => onEdit?.(r)}
                    className="p-2 hover:bg-neutral-800 hover:text-green-400 rounded-lg transition text-neutral-500"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => onDelete?.(r.id)}
                    className="p-2 hover:bg-neutral-800 hover:text-rose-500 rounded-lg transition text-neutral-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RefreshCwIcon({ className, size }: { className?: string, size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size || 24} height={size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}
