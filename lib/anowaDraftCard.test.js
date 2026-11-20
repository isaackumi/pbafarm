import { describe, expect, test } from 'vitest'
import {
  canUndo,
  cardState,
  editHref,
  fishAfter,
  hoursLeft,
  itemKind,
  orderBar,
  queryDate,
  queryNumber,
  rowNumber,
  splitItems,
  undoMinutesLeft,
} from './anowaDraftCard'
import { isActionRequest, isAutomationRequest } from './anowaIntent'

const now = 1_000_000_000_000
const mort = { id: 'a', status: 'pending', problem: null, date: '2026-11-20', siteId: 's1', payload: { kind: 'daily_entry', cageId: 'c2', cageName: 'C-02', feedKg: 0, mortality: 3, mortalityCause: 'unknown', fishBefore: 11845 } }
const po = {
  id: 'b', status: 'pending', problem: 'Your role cannot create purchase orders.', date: '2026-11-20', siteId: 's1',
  payload: { kind: 'purchase_order', feedTypeId: 'f1', supplierId: 'sup', quantityKg: 1250, bags: 50, bagKg: 25, pricePerKg: 15, needKg: 1690, stockKg: 440, days: 14, units: 9 },
}

describe('draft card helpers', () => {
  test('state follows the items', () => {
    expect(cardState(null)).toBe('missing')
    expect(cardState({ expiresAt: now + 1, items: [mort] }, now)).toBe('pending')
    expect(cardState({ expiresAt: now - 1, items: [mort] }, now)).toBe('expired')
    expect(cardState({ expiresAt: now, items: [{ ...mort, status: 'committed' }, { ...po, status: 'cancelled' }] }, now)).toBe('saved')
    expect(cardState({ expiresAt: now, items: [{ ...mort, status: 'undone' }] }, now)).toBe('undone')
    expect(cardState({ expiresAt: now, items: [{ ...mort, status: 'cancelled' }] }, now)).toBe('cancelled')
  })

  test('refused items are split out of Confirm', () => {
    const { allowed, refused } = splitItems({ items: [mort, po] })
    expect(allowed.map((i) => i.id)).toEqual(['a'])
    expect(refused.map((i) => i.id)).toEqual(['b'])
  })

  test('numbers, timers, fish after and the order bar', () => {
    expect(rowNumber(0)).toBe('01')
    expect(hoursLeft(now + 24 * 3_600_000, now)).toBe(24)
    expect(hoursLeft(now + 10, now)).toBe(1)
    expect(undoMinutesLeft(now + 9.5 * 60_000, now)).toBe(10)
    expect(undoMinutesLeft(now - 1, now)).toBe(0)
    expect(fishAfter(mort.payload)).toEqual({ before: 11845, after: 11842 })
    expect(fishAfter(po.payload)).toBeNull()
    // 440 on hand of 1690 needed: about a quarter of the bar.
    expect(orderBar(po.payload)).toEqual({ stockPct: 26, orderPct: 74 })
    expect(orderBar({})).toEqual({ stockPct: 0, orderPct: 100 })
    expect(itemKind(mort.payload)).toBe('mortality')
    expect(itemKind({ kind: 'daily_entry', feedKg: 4 })).toBe('daily')
    expect(itemKind(po.payload)).toBe('order')
    expect(itemKind({ kind: 'project_create' })).toBe('projectNew')
    expect(itemKind({ kind: 'project_milestone' })).toBe('projectMilestone')
    expect(itemKind({ kind: 'project_cost' })).toBe('projectCost')
    expect(itemKind({ kind: 'sampling' })).toBe('sampling')
    expect(itemKind({ kind: 'approval_decision', decision: 'reject' })).toBe('reject')
    expect(itemKind({ kind: 'approval_decision', decision: 'approve' })).toBe('approve')
    expect(itemKind({ kind: 'cycle_plan' })).toBe('plan')
    expect(editHref({ payload: { kind: 'project_cost', projectId: 'p1' } })).toBe('/projects/p1')
  })

  test('Edit opens the normal form prefilled', () => {
    expect(editHref(mort)).toBe('/daily-entry?cage=c2&date=2026-11-20&mortality=3&cause=unknown')
    expect(editHref(po)).toBe('/procurement?newPo=1&supplier=sup&feedType=f1&qty=1250&price=15&site=s1')
    expect(editHref({ payload: { kind: 'task', title: 'Water check & DO', dueDate: '2026-11-21' } })).toBe(
      '/teams?taskTitle=Water%20check%20%26%20DO&taskDue=2026-11-21',
    )
    expect(editHref({ date: '2026-11-20', payload: { kind: 'feed_issue', feedTypeId: 'f', quantityKg: 40 } })).toBe(
      '/feed-issue?feedType=f&qty=40&date=2026-11-20',
    )
  })

  test('query prefill values are validated', () => {
    expect(queryNumber({ qty: '1250' }, 'qty')).toBe('1250')
    expect(queryNumber({ qty: '-3' }, 'qty')).toBe('')
    expect(queryNumber({ qty: 'abc' }, 'qty')).toBe('')
    expect(queryDate({ d: '2026-11-20' }, 'd')).toBe('2026-11-20')
    expect(queryDate({ d: '20/11/2026' }, 'd')).toBe('')
  })
})

describe('farm draft cards', () => {
  test('a card with a farm record has no Undo', () => {
    const harvest = { ...mort, status: 'committed', payload: { kind: 'harvest', cageId: 'c2', cageName: 'C-02' } }
    expect(canUndo({ items: [{ ...mort, status: 'committed' }] })).toBe(true)
    expect(canUndo({ items: [{ ...mort, status: 'committed' }, harvest] })).toBe(false)
  })
})

describe('isActionRequest', () => {
  test.each([
    "Record 3 dead in C-02 and order feed so we don't run out next week",
    '3 dead in A1 this morning',
    'Order feed for next week',
    'C-04 fed 12 kg today',
    'Assign a water check to Kwame tomorrow',
    'Enregistre 3 morts dans C-02',
    "Commande de l'aliment pour la semaine prochaine",
    'Sample C-07: 50 fish at 312 g',
    'Log DO 3.8 in B-02',
    'Harvest 1.2 t from A-04 with lot L-22',
    'Approve the stocking in B-04',
    'Email the weekly report every Monday at 07:00',
    'When will C-07 reach 400 g?',
    'Which cages reach target in 8 weeks?',
    'What is waiting for my approval?',
    'Outstanding invoices to follow up',
    'Profit and loss for this month',
    'Any low-oxygen events this week?',
    'Quand C-07 atteindra-t-elle 400 g ?',
    "Qu'est-ce qui attend mon approbation ?",
  ])('acts on "%s"', (text) => {
    expect(isActionRequest(text)).toBe(true)
  })

  test.each([
    'Why is FCR on Row C worse?',
    'How many fish died last week?',
    'What is our feed stock?',
    'Alert me when oxygen drops below 4 mg/L',
    'Pourquoi la mortalité augmente ?',
  ])('answers "%s" instead', (text) => {
    expect(isActionRequest(text)).toBe(false)
  })

  test('a report schedule is a draft, not an automation', () => {
    expect(isAutomationRequest('Email the weekly report every Monday at 07:00')).toBe(false)
  })

  test('automations keep their own route', () => {
    expect(isAutomationRequest('Every morning create a feeding check task')).toBe(true)
    expect(isActionRequest('Every morning create a feeding check task')).toBe(false)
  })
})
