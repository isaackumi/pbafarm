/**
 * Retired model ids. Providers shut old models down ("models/gemini-2.0-flash
 * is no longer available"), but the ids live on in saved org credentials,
 * the browser's saved settings and env vars. Every call maps them to the
 * current model here, at the last step before the request, so nothing saved
 * has to be migrated.
 */
export const GEMINI_CURRENT = 'gemini-3.8-flash'

const RETIRED_GEMINI = /^(models\/)?gemini-(1\.0|1\.5|2\.0|2\.5)(-[a-z0-9.-]+)?$/i

/** The model to actually call for `providerId`: `model`, or its replacement when retired. */
export function currentModel(providerId: string, model: string): string {
  const m = typeof model === 'string' ? model.trim() : ''
  if (providerId === 'gemini' && RETIRED_GEMINI.test(m)) return GEMINI_CURRENT
  return m
}
