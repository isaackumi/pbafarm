import { describe, expect, test } from 'vitest'
import {
  CHOOSER_PATH,
  ORG_CHOSEN_KEY,
  documentTitle,
  markOrgChosen,
  orgInitials,
  postSignInPath,
  shouldShowChooser,
  splitOrgs,
} from './activeOrganization'

const org = (name, extra = {}) => ({
  companyId: name.toLowerCase(),
  name,
  companyStatus: 'approved',
  isActive: false,
  ...extra,
})

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v)
    },
    removeItem: (k) => {
      delete data[k]
    },
    data,
  }
}

describe('orgInitials', () => {
  test('first and last word, single word, blanks', () => {
    expect(orgInitials('Lake Volta Farm')).toBe('LF')
    expect(orgInitials('  river  ')).toBe('RI')
    expect(orgInitials('')).toBe('?')
    expect(orgInitials(undefined)).toBe('?')
    expect(orgInitials(null)).toBe('?')
  })
})

describe('splitOrgs', () => {
  test('active, others and isMulti', () => {
    const a = org('A', { isActive: true })
    const b = org('B')
    expect(splitOrgs([a, b])).toEqual({ active: a, others: [b], isMulti: true })
    expect(splitOrgs([a])).toEqual({ active: a, others: [], isMulti: false })
    expect(splitOrgs(undefined)).toEqual({ active: null, others: [], isMulti: false })
  })
})

describe('shouldShowChooser', () => {
  test('only with more than one approved organization', () => {
    expect(shouldShowChooser(undefined)).toBe(false)
    expect(shouldShowChooser([org('A')])).toBe(false)
    expect(shouldShowChooser([org('A'), org('B', { companyStatus: 'pending' })])).toBe(false)
    expect(shouldShowChooser([org('A'), org('B')])).toBe(true)
  })
})

describe('documentTitle', () => {
  test('appends the farm, falls back to Anowa', () => {
    expect(documentTitle('Cages', 'Lake Farm')).toBe('Cages · Lake Farm')
    expect(documentTitle('Cages', null)).toBe('Cages · Anowa')
    expect(documentTitle('Anowa', undefined)).toBe('Anowa')
    expect(documentTitle(undefined, 'Lake Farm')).toBe('Anowa · Lake Farm')
  })
})

describe('postSignInPath', () => {
  test('goes through the chooser once per sign-in, keeping a safe next', () => {
    const session = memoryStorage()
    expect(postSignInPath('/cages?tab=x', { session })).toBe(`${CHOOSER_PATH}?next=${encodeURIComponent('/cages?tab=x')}`)
    expect(postSignInPath('//evil.com', { session })).toBe(`${CHOOSER_PATH}?next=${encodeURIComponent('/dashboard')}`)
    markOrgChosen(session)
    expect(session.data[ORG_CHOSEN_KEY]).toBe('1')
    expect(postSignInPath('/cages', { session })).toBe('/cages')
    expect(postSignInPath(undefined, { session })).toBe('/dashboard')
  })

  test('blocked storage still routes through the chooser', () => {
    const session = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => markOrgChosen(session)).not.toThrow()
    expect(postSignInPath('/x', { session })).toBe(`${CHOOSER_PATH}?next=%2Fx`)
  })
})
