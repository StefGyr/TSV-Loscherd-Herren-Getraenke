'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/admin', label: 'Übersicht' },
  { href: '/admin/stock', label: 'Bestandspflege' },
  { href: '/admin/users', label: 'Nutzer & Guthaben' },
  { href: '/admin/activity', label: 'Aktivität' },
  { href: '/admin/inventory', label: 'Bestand & Finanzen' },

  { href: '/admin/platzbelegung', label: 'Platzbelegung' },
]


export default function AdminNav() {
  const pathname = usePathname()

  return (
    <div className="sticky top-14 z-40 bg-neutral-950 border-b border-gray-800">
      <div className="max-w-6xl mx-auto flex items-center gap-4 px-4 py-3 text-sm font-medium text-gray-400">
        {navItems.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-3 py-1.5 rounded-md transition ${active
                ? 'bg-green-700 text-white border border-green-600 shadow-sm'
                : 'hover:text-white hover:bg-gray-800'
                }`}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
