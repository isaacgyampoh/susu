import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Console
  if (pathname.startsWith('/admin')) {
    if (!request.cookies.get('admin_token')?.value) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  // Member portal — separate credential, separate path
  if (pathname.startsWith('/m/portal')) {
    if (!request.cookies.get('member_token')?.value) {
      return NextResponse.redirect(new URL('/m/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = { matcher: ['/admin/:path*', '/m/portal/:path*'] }
