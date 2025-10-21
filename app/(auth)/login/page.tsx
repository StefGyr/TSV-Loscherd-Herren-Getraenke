'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function LoginPage() {
  const [supabase, setSupabase] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    import('@/lib/supabase-browser').then((m) => setSupabase(m.supabase))
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) setError('Login fehlgeschlagen – bitte prüfen.')
    else router.push('/')

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-neutral-900/70 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm shadow-lg"
      >
        <h1 className="text-2xl font-semibold mb-6 text-center">🔐 Login</h1>

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="email"
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:ring-2 focus:ring-green-600"
            required
          />
          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:ring-2 focus:ring-green-600"
            required
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-700 hover:bg-green-800 py-3 rounded-lg font-medium transition disabled:opacity-50"
          >
            {loading ? 'Einloggen...' : 'Einloggen'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-400 space-y-2">
          <p>
            Kein Account?{' '}
            <a href="/register" className="text-green-400 hover:underline">
              Jetzt registrieren
            </a>
          </p>
          <p>
            Passwort vergessen?{' '}
            <a href="/reset" className="text-green-400 hover:underline">
              Passwort zurücksetzen
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
