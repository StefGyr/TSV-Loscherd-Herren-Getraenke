import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function middleware(req: NextRequest) {
  const supabase = await supabaseServer()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const { pathname } = req.nextUrl
  const publicPaths = ['/login', '/register', '/reset', '/terminal']
  const isPublic = publicPaths.some((path) => pathname.startsWith(path))

  // Nicht eingeloggt → redirect zu Login
  if (!session && !isPublic) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // 🔹 Wenn /admin aufgerufen wird, prüfen ob User Admin ist
  if (pathname.startsWith('/admin')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', session?.user?.id)
      .single()

    if (!profile?.is_admin) {
      // Kein Admin → zurück zur Startseite
      const redirectUrl = req.nextUrl.clone()
      redirectUrl.pathname = '/'
      return NextResponse.redirect(redirectUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
