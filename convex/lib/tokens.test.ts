import { describe, expect, test } from 'vitest'
import { SHORT_CODE_ALPHABET, formatShortCode, parseShortCode, randomShortCode } from './tokens'
import { linkAttempt } from '../bot/inbound'

describe('Telegram short codes (Paper 43 "K7Q-42P")', () => {
  test('are 6 readable symbols mixing letters and digits', () => {
    for (let i = 0; i < 500; i += 1) {
      const c = randomShortCode()
      expect(c).toHaveLength(6)
      expect([...c].every((ch) => SHORT_CODE_ALPHABET.includes(ch))).toBe(true)
      expect(c).toMatch(/[0-9]/)
      expect(c).toMatch(/[A-Z]/)
    }
    expect(SHORT_CODE_ALPHABET).not.toMatch(/[01ILO]/)
  })

  test('format and parse round-trip, forgiving case, a space or a dash', () => {
    expect(formatShortCode('K7Q42P')).toBe('K7Q-42P')
    for (const typed of ['K7Q-42P', 'k7q-42p', 'K7Q 42P', ' k7q42p ']) expect(parseShortCode(typed)).toBe('K7Q42P')
  })

  test('ordinary words, digits only and lookalike symbols are not codes', () => {
    for (const typed of ['THANKS', 'HELLO!', '123456', '2345678', 'K0Q42P', 'K7Q-42', 'fed 20 kg']) {
      expect(parseShortCode(typed)).toBeNull()
    }
  })
})

describe('linkAttempt', () => {
  const token = 'a'.repeat(64)
  test('WhatsApp reads only LINK <6 digits>', () => {
    expect(linkAttempt('whatsapp', 'LINK 123456', false)).toEqual({ kind: 'code', value: '123456' })
    expect(linkAttempt('whatsapp', 'K7Q-42P', false)).toBeNull()
  })

  test('Telegram: deep-link token, prefixed code, and a bare code only from an unlinked chat', () => {
    expect(linkAttempt('telegram', `/start ${token}`, true)).toEqual({ kind: 'token', value: token })
    expect(linkAttempt('telegram', '/start K7Q-42P', true)).toEqual({ kind: 'short', value: 'K7Q42P' })
    expect(linkAttempt('telegram', 'link k7q42p', true)).toEqual({ kind: 'short', value: 'K7Q42P' })
    expect(linkAttempt('telegram', 'K7Q-42P', false)).toEqual({ kind: 'short', value: 'K7Q42P' })
    // A linked chat's ordinary message is never taken for a code.
    expect(linkAttempt('telegram', 'K7Q-42P', true)).toBeNull()
    expect(linkAttempt('telegram', 'THANKS', false)).toBeNull()
  })
})
