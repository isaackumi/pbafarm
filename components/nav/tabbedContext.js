import { createContext, useContext } from 'react'

/**
 * Set by TabbedGroupPage around the page body it shows as a tab. A Layout
 * rendered inside it draws no second shell: it hands its header actions to
 * `slot` (the tabbed page's header) and renders only its content.
 * { slot: HTMLElement | null, groupKey: string, tabKey: string }
 */
export const TabbedPageContext = createContext(null)

export function useTabbedPage() {
  return useContext(TabbedPageContext)
}

/** The tab key when rendered as a tab of a joined page, else null. */
export function useGroupTab() {
  return useContext(TabbedPageContext)?.tabKey ?? null
}
