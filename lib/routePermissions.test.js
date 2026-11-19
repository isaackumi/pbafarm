import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CREATE_PERMISSIONS, ROUTE_PERMISSIONS, routePermission } from './routePermissions'
import { DEFAULT_SHORTCUTS, MENU_SECTIONS, NAV_ITEMS } from './navigation'

const root = join(__dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

function pageFiles(dir = join(root, 'pages')) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === 'api' ? [] : pageFiles(full)
    return /\.(js|jsx|tsx?)$/.test(name) && !name.startsWith('_') ? [full] : []
  })
}

function routeOf(file) {
  const path = '/' + relative(join(root, 'pages'), file).replace(/\.(js|jsx|tsx?)$/, '')
  return path.replace(/\/index$/, '') || '/'
}

describe('ROUTE_PERMISSIONS', () => {
  it('matches the permission on every drawer entry', () => {
    const entries = Object.values(MENU_SECTIONS).flatMap((section) => section.items)
    expect(entries.length).toBeGreaterThan(10)
    for (const { path, permission } of entries) {
      expect([path, ROUTE_PERMISSIONS[path] ?? null]).toEqual([path, permission ?? null])
    }
  })

  it('offers only drawer destinations as phone tab bar defaults', () => {
    const paths = new Set(NAV_ITEMS.map((item) => item.path))
    for (const path of DEFAULT_SHORTCUTS) expect(paths.has(path)).toBe(true)
  })

  it('matches every page guarded with ProtectedRoute permission', () => {
    let checked = 0
    for (const file of pageFiles()) {
      const match = readFileSync(file, 'utf8').match(/<ProtectedRoute[^>]*\spermission="([^"]+)"/)
      if (!match || /\[/.test(file)) continue
      const route = routeOf(file)
      expect([route, ROUTE_PERMISSIONS[route]]).toEqual([route, match[1]])
      checked += 1
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('covers each quick-create kind', () => {
    expect(Object.keys(CREATE_PERMISSIONS).sort()).toEqual(['cage', 'feedType', 'purchase', 'stocking'])
  })
})

describe('routePermission', () => {
  it('ignores query, hash and trailing slash', () => {
    expect(routePermission('/inventory/adjust?item=1#top')).toBe('inventory.adjust')
    expect(routePermission('/users/')).toBe('org.members.manage')
  })

  it('returns null for open, unknown or external links', () => {
    expect(routePermission('/tasks')).toBeNull()
    expect(routePermission('https://example.com/users')).toBeNull()
    expect(routePermission(undefined)).toBeNull()
  })
})
