import { describe, expect, test } from 'vitest'
import { isConsoleHost, parseConsoleHosts, routeForHost } from './platformHost'

const consoleHosts = parseConsoleHosts('console.getanowa.com, Console.Localhost:3000 ,')
const onConsole = (pathname) => routeForHost({ host: 'console.getanowa.com', pathname, consoleHosts })
const onApp = (pathname) => routeForHost({ host: 'app.getanowa.com', pathname, consoleHosts })

describe('platform console host routing (PLAT-101)', () => {
  test('parses the env list and matches hosts with or without a port', () => {
    expect(consoleHosts).toEqual(['console.getanowa.com', 'console.localhost:3000'])
    expect(isConsoleHost('CONSOLE.getanowa.com:443', consoleHosts)).toBe(true)
    expect(isConsoleHost('console.localhost:3000', consoleHosts)).toBe(true)
    expect(isConsoleHost('console.localhost:4000', consoleHosts)).toBe(false)
    expect(isConsoleHost('evilconsole.getanowa.com', consoleHosts)).toBe(false)
    expect(isConsoleHost('', consoleHosts)).toBe(false)
  })

  test('console host serves the console, sign-in pages and static assets only', () => {
    for (const p of ['/platform', '/platform/tenants', '/platform/tenants/abc', '/login', '/verify', '/reset-password', '/account']) {
      expect(onConsole(p)).toEqual({ action: 'next' })
    }
    for (const p of ['/_next/static/chunks/a.js', '/_next/data/build/platform.json', '/favicon.ico', '/manifest.json', '/sw.js', '/icons/icon-192.png']) {
      expect(onConsole(p)).toEqual({ action: 'next' })
    }
    for (const p of ['/', '/dashboard', '/cages/1', '/admin/admin', '/billing', '/signup', '/platformx', '/loginx']) {
      expect(onConsole(p)).toEqual({ action: 'redirect', to: '/platform' })
    }
    expect(onConsole('/api/llm/chat')).toEqual({ action: 'not_found' })
  })

  test('tenant host hides the console and serves everything else', () => {
    expect(onApp('/platform')).toEqual({ action: 'not_found' })
    expect(onApp('/platform/tenants/abc')).toEqual({ action: 'not_found' })
    for (const p of ['/', '/dashboard', '/billing', '/platformx', '/login', '/api/llm/chat']) {
      expect(onApp(p)).toEqual({ action: 'next' })
    }
  })
})
