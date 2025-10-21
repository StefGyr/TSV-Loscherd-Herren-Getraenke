'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

export default function ResetPage() {
  const [supabase, setSupabase] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    import('@/lib/supabase-browser').then((m) => setSupabase(m.supabase))
  }, [])

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setMessage('')

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/login`,
    })

    if (error) setMessage('Fehler beim Senden der E-Mail.')
    else setMessage('✅ Passwort-Reset-E-Mail wurde gesendet.')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-neutral-900/70 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm shadow-lg"
      >
        <h1 className="text-2xl font-semibold mb-6 text-center">🔑 Passwort zurücksetzen</h1>

        <form onSubmit={handleReset} className="space-y-4">
          <input type="email" placeholder="E-Mail-Adresse" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:ring-2 focus:ring-green-600" required />
          <button type="submit" className="w-full bg-green-700 hover:bg-green-800 py-3 rounded-lg font-medium">
            Link senden
          </button>
        </form>

        {message && <p className="text-center text-sm mt-4 text-green-400">{message}</p>}

        <p className="text-center text-sm text-gray-400 mt-6">
          Zurück zum{' '}
          <a href="/login" className="text-green-400 hover:underline">
            Login
          </a>
        </p>
      </motion.div>
    </div>
  )
}
