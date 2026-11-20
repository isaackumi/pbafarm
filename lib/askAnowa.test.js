import { describe, expect, test } from 'vitest'
import en from '../locales/en.json'
import fr from '../locales/fr.json'
import {
  AUTO,
  TOPICS,
  formatSourceCount,
  hasVisionModel,
  historyFor,
  modelMenu,
  parseDeepLink,
  requestModel,
  resolveChoice,
  topicColumns,
} from './askAnowa'
import { chatScope } from './llmServer'

const catalog = {
  source: 'server',
  defaultProvider: 'gemini',
  providers: [
    {
      id: 'gemini',
      label: 'Gemini',
      defaultModel: 'live-a',
      models: [
        { id: 'live-a', label: 'Live A', vision: false },
        { id: 'live-b', label: 'live-b', vision: true },
      ],
      error: null,
    },
    { id: 'openai', label: 'OpenAI', defaultModel: null, models: [], error: 'list failed' },
  ],
}

describe('model menu (artboard 47b, D-022)', () => {
  test('groups only providers with a live list, with capability hints', () => {
    expect(modelMenu(catalog)).toEqual([
      {
        id: 'gemini',
        label: 'Gemini',
        models: [
          { id: 'live-a', label: 'Live A', vision: false, isDefault: true },
          { id: 'live-b', label: null, vision: true, isDefault: false },
        ],
      },
    ])
    expect(modelMenu(null)).toEqual([])
    expect(hasVisionModel(catalog)).toBe(true)
    expect(hasVisionModel({ providers: [{ ...catalog.providers[0], models: [{ id: 'x', vision: false }] }] })).toBe(false)
  })

  test('a saved model the provider dropped falls back to Auto; Auto sends nothing', () => {
    expect(resolveChoice({ provider: 'gemini', model: 'live-b' }, catalog)).toEqual({ provider: 'gemini', model: 'live-b' })
    expect(resolveChoice({ provider: 'gemini', model: 'retired' }, catalog)).toBe(AUTO)
    expect(resolveChoice({ provider: 'openai', model: 'live-a' }, catalog)).toBe(AUTO)
    expect(requestModel(AUTO)).toEqual({ provider: undefined, model: undefined })
    expect(requestModel({ provider: 'gemini', model: 'live-a' })).toEqual({ provider: 'gemini', model: 'live-a' })
  })
})

describe('chat scope sent to the server', () => {
  test('days clamp to 1..90, site ids must look like Convex ids, deep is opt-in', () => {
    expect(chatScope({})).toEqual({ days: 14, locationId: undefined, deep: false })
    expect(chatScope({ days: 400, locationId: 'k57abc123def456', deep: true })).toEqual({
      days: 90,
      locationId: 'k57abc123def456',
      deep: true,
    })
    expect(chatScope({ days: 0, locationId: '../x', deep: 'yes' })).toEqual({ days: 1, locationId: undefined, deep: false })
  })
})

describe('view helpers', () => {
  test('counts, history and deep links', () => {
    expect(formatSourceCount({ count: 1204, capped: false })).toBe('1,204')
    expect(formatSourceCount({ count: 2000, capped: true })).toBe('2,000+')
    expect(formatSourceCount(null)).toBeNull()
    const msgs = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, pinned: false }))
    expect(historyFor(msgs)).toHaveLength(8)
    expect(historyFor(msgs)[0]).toEqual({ role: 'user', content: 'm4' })
    expect(parseDeepLink({ chat: 'k57abc123def456', view: 'saved' })).toEqual({ chat: 'k57abc123def456', view: 'saved' })
    expect(parseDeepLink({ chat: '<script>' })).toEqual({ chat: null, view: 'ask' })
  })

  test('every topic has 9 questions in English and French', () => {
    for (const topic of TOPICS) {
      for (const key of topicColumns(topic).flat()) {
        const path = key.split('.')
        const get = (cat) => path.reduce((n, p) => n?.[p], cat)
        expect(typeof get(en)).toBe('string')
        expect(typeof get(fr)).toBe('string')
      }
    }
  })
})
