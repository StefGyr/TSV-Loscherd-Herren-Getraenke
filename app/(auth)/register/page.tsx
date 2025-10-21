'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const router = useRouter()

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)

    if (!/^\d{6}$/.test(pin)) return setMsg('PIN muss 6-stellig sein.')

    // Prüfen, ob PIN schon existiert
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('pin', pin)
      .maybeSingle()
    if (existing) return setMsg('PIN ist bereits vergeben.')

    // User anlegen
    const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${location.origin}/login`,
    data: { first_name: firstName, last_name: lastName },
  },
})

    if (error || !data.user) return setMsg(error?.message || 'Fehler bei Registrierung.')

    // Profil anlegen (ersetzt Konflikt auf id)
const { error: profErr } = await supabase.from('profiles').upsert({
  id: data.user.id,
  first_name: firstName,
  last_name: lastName,
  pin,
  open_balance_cents: 0,
})

    if (profErr) return setMsg(profErr.message)

    router.replace('/')
  }

  return (
    <main className="max-w-sm mx-auto pt-24 px-4">
      <h1 className="text-2xl font-semibold mb-6">Registrieren</h1>
      <form onSubmit={onRegister} className="space-y-3">
        <input className="w-full px-3 py-2 bg-neutral-800 rounded" placeholder="Vorname" value={firstName} onChange={e=>setFirstName(e.target.value)} required />
        <input className="w-full px-3 py-2 bg-neutral-800 rounded" placeholder="Nachname" value={lastName} onChange={e=>setLastName(e.target.value)} required />
        <input className="w-full px-3 py-2 bg-neutral-800 rounded" type="email" placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input className="w-full px-3 py-2 bg-neutral-800 rounded" type="password" placeholder="Passwort" value={password} onChange={e=>setPassword(e.target.value)} required />
        <input className="w-full px-3 py-2 bg-neutral-800 rounded" placeholder="6-stelliger PIN (für Terminal)" value={pin} onChange={e=>setPin(e.target.value)} required />
        <button className="w-full py-2 rounded bg-white text-black font-medium">Konto erstellen</button>
      </form>
      {msg && <p className="mt-3 text-red-400">{msg}</p>}
      <div className="mt-6 text-sm">
        <a href="/login" className="underline">Zurück zum Login</a>
      </div>
    </main>
  )
}
