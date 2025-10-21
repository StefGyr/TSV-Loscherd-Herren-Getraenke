'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase-browser'
import { LogOut } from 'lucide-react'

export default function TopNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)

  // 🔹 Aktuell eingeloggten User prüfen
  useEffect(() => {
    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      setUser(user)
    }
    loadUser()
  }, [])

  // 🔹 Logout-Funktion
  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  // 🔹 Navigationspunkte (ohne Terminal)
  const links = [
    { href: '/', label: 'Start' },
    { href: '/admin', label: 'Admin' },
    { href: '/profile', label: 'Profil' },
  ]

  return (
    <nav className="fixed top-0 left-0 right-0 h-14 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 z-50">
      {/* 🔹 Link-Bereich */}
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold tracking-tight">
          TSV Herren Getränke
        </h1>
        <div className="flex gap-4 text-sm text-neutral-400">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`hover:text-white transition ${
                pathname === link.href ? 'text-white font-medium' : ''
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {/* 🔹 Logout-Button rechts */}
      {user && (
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-neutral-800 rounded-full transition"
          title="Logout"
        >
          <LogOut className="w-5 h-5 text-neutral-300" />
        </button>
      )}
    </nav>
  )
}
