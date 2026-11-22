import { NextResponse } from 'next/server'
import { parseConsoleHosts, routeForHost, DEFAULT_CONSOLE_HOSTS } from './lib/platformHost'

const consoleHosts = parseConsoleHosts(process.env.NEXT_PUBLIC_PLATFORM_CONSOLE_HOST || DEFAULT_CONSOLE_HOSTS)

/** Platform console host routing (PLAT-101); authorization is enforced by Convex, not here. */
export function middleware(request) {
  const { pathname } = request.nextUrl
  if (request.nextUrl.hostname === 'pbafarm.vercel.app' && pathname === '/') {
    return NextResponse.rewrite(new URL('/pba-moved.html', request.url))
  }
  const route = routeForHost({ host: request.headers.get('host'), pathname, consoleHosts })
  if (route.action === 'redirect') {
    const url = request.nextUrl.clone()
    url.pathname = route.to
    url.search = ''
    return NextResponse.redirect(url)
  }
  if (route.action === 'not_found') {
    const url = request.nextUrl.clone()
    url.pathname = '/404'
    url.search = ''
    return NextResponse.rewrite(url, { status: 404 })
  }
  return NextResponse.next()
}

export const config = {
  // Static build output never needs routing.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
