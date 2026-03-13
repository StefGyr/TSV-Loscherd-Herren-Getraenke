'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'

export default function UpdatePasswordPage() {
    const [supabase, setSupabase] = useState<any>(null)
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    useEffect(() => {
        import('@/lib/supabase-browser').then((m) => setSupabase(m.supabase))
    }, [])

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!supabase) return
        setMessage('')
        setError('')

        if (password !== confirmPassword) {
            setError('Passwörter stimmen nicht überein.')
            return
        }

        if (password.length < 6) {
            setError('Das Passwort muss mindestens 6 Zeichen lang sein.')
            return
        }

        setLoading(true)
        const { error } = await supabase.auth.updateUser({ password })

        if (error) {
            setError('Fehler beim Aktualisieren des Passworts: ' + error.message)
        } else {
            setMessage('✅ Passwort erfolgreich aktualisiert. Du wirst zum Login weitergeleitet...')
            setTimeout(() => {
                router.push('/login')
            }, 3000)
        }
        setLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-white px-6">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-neutral-900/70 border border-neutral-800 p-8 rounded-2xl w-full max-w-sm shadow-lg"
            >
                <h1 className="text-2xl font-semibold mb-6 text-center">🆕 Neues Passwort setzen</h1>

                <form onSubmit={handleUpdate} className="space-y-4">
                    <input
                        type="password"
                        placeholder="Neues Passwort"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:ring-2 focus:ring-green-600 outline-none"
                        required
                    />
                    <input
                        type="password"
                        placeholder="Passwort bestätigen"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full p-3 rounded-lg bg-neutral-800 border border-neutral-700 focus:ring-2 focus:ring-green-600 outline-none"
                        required
                    />

                    {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                    {message && <p className="text-green-400 text-sm text-center">{message}</p>}

                    <button
                        type="submit"
                        disabled={loading || !!message}
                        className="w-full bg-green-700 hover:bg-green-800 py-3 rounded-lg font-medium transition disabled:opacity-50"
                    >
                        {loading ? 'Speichern...' : 'Passwort speichern'}
                    </button>
                </form>

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
