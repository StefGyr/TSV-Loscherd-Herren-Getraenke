'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function RegisterPage() {
  const router = useRouter()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    setError(null)
    setLoading(true)

    if (pin.length !== 6 || !/^\d+$/.test(pin)) {
      setError('PIN muss genau 6 Ziffern haben.')
      setLoading(false)
      return
    }

    // 1️⃣ Prüfen, ob PIN schon vergeben
    const { data: existingPin } = await supabase.from('profiles').select('id').eq('pin', pin)
    if (existingPin && existingPin.length > 0) {
      setError('Diese PIN ist bereits vergeben – bitte eine andere wählen.')
      setLoading(false)
      return
    }

    // 2️⃣ Benutzer registrieren
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    })

    if (signUpError) {
      setError('Registrierung fehlgeschlagen: ' + signUpError.message)
      setLoading(false)
      return
    }

    const userId = signUpData?.user?.id
    if (!userId) {
      setError('Registrierung unvollständig – bitte erneut versuchen.')
      setLoading(false)
      return
    }

    // 3️⃣ Profil-Daten ergänzen
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName,
        last_name: lastName,
        pin,
        is_admin: false,
      })
      .eq('id', userId)

    if (profileError) {
      console.error(profileError)
      setError('Fehler beim Speichern des Profils.')
      setLoading(false)
      return
    }

    // 4️⃣ Weiterleitung
    router.push('/login')
    setLoading(false)
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-4 bg-gray-900 rounded shadow text-white">
      <h1 className="text-2xl font-bold mb-4 text-center">Registrieren</h1>

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Vorname"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
        />
        <input
          type="text"
          placeholder="Nachname"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
        />
        <input
          type="email"
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
        />
        <input
          type="password"
          placeholder="Passwort"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
        />
        <input
          type="text"
          placeholder="6-stelliger PIN für Terminal"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className="w-full p-2 rounded bg-gray-800 border border-gray-700"
        />
        <p className="text-sm text-gray-400">
          Der PIN ist <strong>6-stellig</strong> und dient nur zur Nutzung am Terminal.
        </p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={handleRegister}
          disabled={loading}
          className="w-full bg-green-700 hover:bg-green-800 p-2 rounded mt-2 font-medium disabled:opacity-50"
        >
          {loading ? 'Registrieren...' : 'Registrieren'}
        </button>
      </div>
    </div>
  )
}
