import { describe, expect, test } from 'vitest'
import { traceCsv } from './traceCsv'

describe('traceCsv', () => {
  test('neutralises formula text from customer and driver fields', () => {
    const csv = traceCsv({
      lot: { harvest_date: '2026-11-01', lot_code: 'L-1', grade: 'A', weight_kg: 120 },
      trace: {
        feed: [
          {
            first_fed: '2026-06-01',
            last_fed: '2026-10-01',
            feed_type: 'Grower',
            kg_fed: 900,
            lots: [{ received_on: '2026-05-30', lot_number: '=1+1', supplier: 'Acme', quantity_kg: 500 }],
          },
        ],
      },
      dispatches: [{ dispatch_date: '2026-11-02', customer_name: '=1+1', driver: '@evil', weight_kg: -3 }],
    })
    const lines = csv.split('\n')
    expect(lines[0]).toBe('section,date,item,detail,quantity,unit')
    expect(lines).toContain("feed lot,2026-05-30,'=1+1,Grower / Acme,500,kg")
    expect(lines).toContain("dispatch,2026-11-02,'=1+1,'@evil,-3,kg")
  })
})
