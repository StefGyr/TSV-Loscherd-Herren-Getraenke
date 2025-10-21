'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase-browser'

export default function ResetPage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const onReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/login`,
    })
    if (error) return setMsg(error.message)
    setMsg('Wenn die E-Mail existiert, wurde eine Reset-Mail gesendet.')
  }

  return (
    <main className="max-w-sm mx-auto pt-24 px-4">
      <h1 className="text-2xl font-semibold mb-6">Passwort zurücksetzen</h1>
      <form onSubmit={onReset} className="space-y-3">
        <input className="w-full px-3 py-2 bg-neutral-800 rounded" type="email" placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} required />
        <button className="w-full py-2 rounded bg-white text-black font-medium">E-Mail senden</button>
      </form>
      {msg && <p className="mt-3">{msg}</p>}
    </main>
  )
}
