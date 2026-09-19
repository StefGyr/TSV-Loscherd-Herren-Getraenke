'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase-browser'

// Throttle interval: at most once every 10 minutes
const PING_INTERVAL_MS = 10 * 60 * 1000
const STORAGE_KEY = 'tsv_last_activity_ping'

export default function ActivityTracker() {
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null

    const pingActivity = async () => {
      try {
        const lastPing = localStorage.getItem(STORAGE_KEY)
        const now = Date.now()

        if (lastPing && now - parseInt(lastPing, 10) < PING_INTERVAL_MS) {
          return
        }

        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) return

        const nowIso = new Date().toISOString()

        // 1. Try direct update
        const { error } = await supabase
          .from('profiles')
          .update({
            last_seen_at: nowIso,
            last_seen_source: 'app',
          })
          .eq('id', user.id)

        // 2. If direct update fails (e.g. restrictive RLS), try RPC if available
        if (error) {
          await supabase.rpc('update_user_last_seen', { source_input: 'app' })
        }

        localStorage.setItem(STORAGE_KEY, String(now))
      } catch {
        // Silently ignore if column does not exist yet or offline
      }
    }

    // Ping on initial mount
    void pingActivity()

    // Ping periodically while tab stays open
    intervalId = setInterval(() => {
      void pingActivity()
    }, PING_INTERVAL_MS)

    // Also ping when returning to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void pingActivity()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}
