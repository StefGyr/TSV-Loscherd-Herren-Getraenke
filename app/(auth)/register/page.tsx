'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function RegisterPage() {
  const [supabase, setSupabase] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // ✅ Supabase korrekt laden
  useEffect(() => {
    import('@/lib/supabase-browser').then((m) => setSupabase(m.supabase))
  }, [])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setError(null)
    setLoading(true)

    if (pin.length !== 6 || isNaN(Number(pin))) {
      setError('PIN muss aus 6 Ziffern bestehen.')
      setLoading(false)
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    const user = data.user
    if (user) {
      const { error: insertError } = await supabase.from('profiles').insert([
        {
          id: user.id,
          name: `${firstName} ${lastName}`,
          first_name: firstName,
          last_name: lastName,
          pin,
          email,
          is_admin: false,
        },
      ])

      if (insertError) {
        console.error('Profile insert failed:', insertError)
        setError('Fehler beim Anlegen des Profils.')
      }
    }

    setLoading(false)
    router.push('/login')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-neutral-900/70 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm shadow-lg"
      >
        <h1 className="text-2xl font-semibold mb-6 text-center">🧾 Registrierung</h1>

        <form onSubmit={handleRegister} className="space-y-4">
          <input
            type="text"
            placeholder="Vorname"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-green-600"
            required
          />
          <input
            type="text"
            placeholder="Nachname"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-green-600"
            required
          />
          <input
            type="email"
            placeholder="E-Mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-green-600"
            required
          />
          <input
            type="password"
            placeholder="Passwort"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-green-600"
            required
          />
          <input
            type="text"
            placeholder="6-stelliger PIN (für Terminal)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            maxLength={6}
            className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:outline-none focus:ring-2 focus:ring-green-600"
            required
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-700 hover:bg-green-800 py-3 rounded-lg font-medium transition disabled:opacity-50"
          >
            {loading ? 'Registriere...' : 'Registrieren'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-400">
          <p>
            Bereits registriert?{' '}
            <a href="/login" className="text-green-400 hover:underline">
              Zum Login
            </a>
          </p>
        </div>
      </motion.div>
    </div>
  )
}
