import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Hostname routing.
 *
 * One deployment serves two audiences, so the separation has to be enforced at
 * the edge rather than by convention:
 *
 *   admin.abbiewealthsusu.com  -> the console only. /m/* is 404 here.
 *   my.abbiewealthsusu.com     -> the member portal only. /admin/* is 404 here.
 *
 * Without this, members would sign in on the administrator's domain — which
 * is exactly the single-door problem we set out to avoid. Localhost and
 * *.vercel.app keep both, so preview builds stay testable.
 */
const ADMIN_HOSTS  = ['admin.']
const MEMBER_HOSTS = ['my.', 'portal.']

function audience(host: string): 'admin' | 'member' | 'both' {
  if (host.startsWith('localhost') || host.includes('vercel.app')) return 'both'
  if (ADMIN_HOSTS.some(h => host.startsWith(h)))  return 'admin'
  if (MEMBER_HOSTS.some(h => host.startsWith(h))) return 'member'
  return 'both'
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host') ?? ''
  const who  = audience(host)

  // Keep each audience on its own hostname
  if (who === 'admin' && pathname.startsWith('/m')) {
    return new NextResponse('Not found', { status: 404 })
  }
  if (who === 'member') {
    // The member host has no console, and its root is the member sign-in
    if (pathname.startsWith('/admin')) return new NextResponse('Not found', { status: 404 })
    if (pathname === '/') return NextResponse.redirect(new URL('/m/login', request.url))
  }

  // Auth
  if (pathname.startsWith('/admin') && !request.cookies.get('admin_token')?.value) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  if (pathname.startsWith('/m/portal') && !request.cookies.get('member_token')?.value) {
    return NextResponse.redirect(new URL('/m/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/admin/:path*', '/m/:path*'],
}
