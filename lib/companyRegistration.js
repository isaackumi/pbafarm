const trimmed = (...values) => (values.find((v) => v) || '').trim() || undefined

/** Arguments for api.companies.register from the registration form. */
export function registrationArgs(companyData) {
  const name = (companyData.name || '').trim()
  let code = (companyData.code || companyData.abbreviation || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
  if (!code && name) {
    code = name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)
  }
  return {
    name,
    code,
    humanTicket: companyData.humanTicket || undefined,
    address: companyData.address?.trim() || undefined,
    contactEmail: trimmed(companyData.contactEmail, companyData.contact_email, companyData.email),
    contactPhone: trimmed(companyData.contactPhone, companyData.contact_phone, companyData.phone),
    abbreviation: trimmed(
      companyData.abbreviation,
      companyData.registrationNumber,
      companyData.registration_number,
    ),
  }
}
