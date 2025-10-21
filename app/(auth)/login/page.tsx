'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMsg(null)

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      console.error('Login error:', error.message)
      setMsg('Login fehlgeschlagen: ' + error.message)
      return
    }

    if (data?.session) {
  console.log('Login erfolgreich:', data.session)
  window.location.href = '/' // harter reload, damit Middleware greift
}
 else {
      setMsg('Kein Session-Token erhalten.')
    }
  }

  return (
    <main className="max-w-sm mx-auto pt-24 px-4">
      <h1 className="text-2xl font-semibold mb-6">Login</h1>
      <form onSubmit={onLogin} className="space-y-3">
        <input
          className="w-full px-3 py-2 bg-neutral-800 rounded"
          type="email"
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full px-3 py-2 bg-neutral-800 rounded"
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          disabled={loading}
          className="w-full py-2 rounded bg-white text-black font-medium"
        >
          {loading ? 'Anmeldung läuft…' : 'Login'}
        </button>
      </form>
      {msg && <p className="mt-3 text-red-400">{msg}</p>}
      <div className="mt-6 text-sm flex justify-between">
        <a href="/register" className="underline">
          Registrieren
        </a>
        <a href="/reset" className="underline">
          Passwort vergessen
        </a>
      </div>
    </main>
  )
}
