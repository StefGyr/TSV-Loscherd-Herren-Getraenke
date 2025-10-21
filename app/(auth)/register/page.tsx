'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const [supabase, setSupabase] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()

  useEffect(() => {
    import('@/lib/supabase-browser').then((m) => setSupabase(m.supabase))
  }, [])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setMessage('')

    if (pin.length !== 6 || isNaN(Number(pin))) {
      setMessage('PIN muss 6-stellig und nur aus Zahlen bestehen.')
      return
    }

    const { data: existing } = await supabase.from('profiles').select('id').eq('pin', pin)
    if (existing?.length) {
      setMessage('PIN ist bereits vergeben.')
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setMessage('Fehler bei der Registrierung.')
      return
    }

    await supabase.from('profiles').insert([
      {
        id: data.user?.id,
        email,
        first_name: firstName,
        last_name: lastName,
        pin,
      },
    ])

    setMessage('Registrierung erfolgreich 🎉 Du kannst dich jetzt einloggen.')
    setTimeout(() => router.push('/login'), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-neutral-900/70 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm shadow-lg"
      >
        <h1 className="text-2xl font-semibold mb-6 text-center">📝 Registrieren</h1>

        <form onSubmit={handleRegister} className="space-y-3">
          <input type="text" placeholder="Vorname" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700" required />
          <input type="text" placeholder="Nachname" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700" required />
          <input type="email" placeholder="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700" required />
          <input type="password" placeholder="Passwort" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700" required />
          <input type="text" placeholder="6-stelliger PIN" value={pin} onChange={(e) => setPin(e.target.value)} className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700" required />

          <button type="submit" className="w-full bg-green-700 hover:bg-green-800 py-3 rounded-lg font-medium">
            Registrieren
          </button>
        </form>

        {message && <p className="text-sm text-center mt-4 text-green-400">{message}</p>}

        <p className="text-center text-sm text-gray-400 mt-6">
          Bereits registriert?{' '}
          <a href="/login" className="text-green-400 hover:underline">
            Zum Login
          </a>
        </p>
      </motion.div>
    </div>
  )
}
