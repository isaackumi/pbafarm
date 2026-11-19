import { describe, expect, it } from 'vitest'
import { registrationArgs } from './companyRegistration'

describe('registrationArgs', () => {
  it('cleans the code and drops blank optional fields', () => {
    expect(
      registrationArgs({ name: ' Lake Farm ', code: ' lf-01! ', contactEmail: ' a@b.co ', contactPhone: '  ', address: '' }),
    ).toEqual({
      name: 'Lake Farm',
      code: 'LF-01',
      address: undefined,
      contactEmail: 'a@b.co',
      contactPhone: undefined,
      abbreviation: undefined,
    })
  })

  it('derives a code from the name and keeps the registration number', () => {
    const args = registrationArgs({ name: 'Volta Fish Co. Ltd', registrationNumber: ' RN-9 ' })
    expect(args.code).toBe('VOLTAFIS')
    expect(args.abbreviation).toBe('RN-9')
  })
})
