/** Short reference shown on the error card and sent with the report, e.g. "err_7f2c9a41". */
export function newErrorId() {
  const bytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < 4; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return `err_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/** A safe id for display: Next's error digest or an `err_` id, else null. */
export function displayErrorId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null
}
