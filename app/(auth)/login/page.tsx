'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [supabase, setSupabase] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    import('@/lib/supabase-browser').then((m) => setSupabase(m.supabase))
  }, [])

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) return setMsg(error.message)
    if (data.session) window.location.href = '/'
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
        <button className="w-full py-2 rounded bg-white text-black font-medium">
          Login
        </button>
      </form>
      {msg && <p className="mt-3 text-red-400">{msg}</p>}
    </main>
  )
}
