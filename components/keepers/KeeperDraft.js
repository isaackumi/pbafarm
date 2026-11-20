import { useCallback, useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Modal } from '../ui'
import DraftCard from '../AnowaDraftCard'
import { errorMessage } from '../../lib/errorMessage'
import { newDraftGroup } from '../../lib/keepers'
import { useT } from '../../lib/i18n/context'

/**
 * Every keeper change goes through Ask Anowa's draft card: a brief fix, a
 * drag on the board, a bulk action or the cover sheet calls `propose(input)`,
 * which stores a pending draft (anowa.drafts.draftKeeper) and opens the card.
 * Nothing changes until the manager taps Confirm on it.
 */
export function useKeeperDraft() {
  const t = useT()
  const draftKeeper = useMutation(api.anowa.drafts.draftKeeper)
  const [group, setGroup] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const propose = useCallback(
    async (input, siteId) => {
      setBusy(true)
      setError('')
      try {
        const draftGroup = newDraftGroup()
        const r = await draftKeeper({ draftGroup, input, ...(siteId ? { siteId } : {}) })
        if (!r.ok) {
          setError(r.error)
          return false
        }
        setGroup(draftGroup)
        return true
      } catch (err) {
        setError(errorMessage(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [draftKeeper],
  )

  const close = () => {
    setGroup(null)
    setError('')
  }

  const modal = (
    <Modal
      open={!!group || !!error}
      onClose={close}
      size="2xl"
      showClose
      title={error ? t('keepers.draft.failedTitle') : t('keepers.draft.title')}
      description={error ? undefined : t('keepers.draft.description')}
    >
      {error ? <p className="text-sm leading-5 text-text" role="alert">{error}</p> : <DraftCard draftGroup={group} />}
    </Modal>
  )
  return { propose, busy, modal }
}
