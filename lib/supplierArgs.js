/** Mutation args for feed suppliers (api.feed.createSupplier / updateSupplier). */

/** Convex optional args reject null — drop empty values. */
function cleanArgs(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '') continue
    out[k] = v
  }
  return out
}

function contactInfoOf(data) {
  return (
    data.contact_info ||
    data.contactInfo ||
    [data.contact_person, data.phone, data.email, data.address].filter(Boolean).join(' | ') ||
    undefined
  )
}

export function supplierCreateArgs(data) {
  return cleanArgs({
    name: data.name,
    abbreviation: data.abbreviation,
    contactInfo: contactInfoOf(data),
    website: data.website,
  })
}

export function supplierUpdateArgs(id, data) {
  return {
    id,
    patch: cleanArgs({
      name: data.name,
      abbreviation: data.abbreviation,
      contactInfo: contactInfoOf(data),
      website: data.website,
    }),
  }
}
