/**
 * React binding for organization words (CUSTOM-003, D-007). The pure helpers
 * live in lib/terminology.js; this hook re-renders when the company's words
 * change. See also lib/format.unitLabel, which reads the same words for
 * non-component callers.
 */
import { useMemo } from 'react'
import { useCompanySettings } from '../contexts/CompanySettingsContext'
import { makeTerm } from '../lib/terminology'

/** `term(key, fallback)`, `term.text(label)`, `term.unit(unitOrType, { plural })`. */
export function useTerm() {
  const { terminology } = useCompanySettings()
  return useMemo(() => makeTerm(terminology), [terminology])
}

export { TERM_GROUPS, applyTerms } from '../lib/terminology'
