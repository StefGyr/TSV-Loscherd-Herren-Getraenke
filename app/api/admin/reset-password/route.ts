import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: Request) {
    try {
        const { userId, newPassword } = await req.json()

        // 1. Verify Admin Status
        const supabase = await supabaseServer()
        const {
            data: { session },
        } = await supabase.auth.getSession()

        if (!session) {
            return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 })
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('id', session.user.id)
            .single()

        if (!profile?.is_admin) {
            return NextResponse.json({ error: 'Keine Admin-Rechte' }, { status: 403 })
        }

        // 2. Perform Reset using Service Role Key
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(
            userId,
            { password: newPassword }
        )

        if (resetError) {
            console.error('Reset error:', resetError)
            return NextResponse.json({ error: resetError.message }, { status: 500 })
        }

        return NextResponse.json({ message: 'Passwort erfolgreich zurückgesetzt.' })
    } catch (err: any) {
        console.error('Server error:', err)
        return NextResponse.json({ error: 'Server-Fehler: ' + err.message }, { status: 500 })
    }
}
