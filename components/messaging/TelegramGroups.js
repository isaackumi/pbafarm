import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { GhostButton, Pill, Skeleton } from '../ui'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import { CardNote, SettingsCard, SettingsRow } from '../settings'
import { SkyToggle } from '../paperTones'
import { useT } from '../../lib/i18n/context'

const CAPS = ['ask', 'log', 'alerts', 'money', 'buyers']

/**
 * Settings › Messaging › Telegram groups (VFQ-1). Lists the organization's linked
 * Telegram group chats with their site scope and capabilities. No Paper artboard
 * exists for this card; it follows the other messaging settings cards.
 */
export default function TelegramGroups() {
  const t = useT()
  const data = useQuery(api.bot.chatGroups.list, {})
  if (data === undefined) return <Skeleton className="h-32" />
  return (
    <SettingsCard id="telegram-groups" title={t('settingsUi.msg.groups.title')}>
      <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">
        {t('settingsUi.msg.groups.sub', { bot: data.botUsername ? `@${data.botUsername}` : t('settingsUi.msg.groups.theBot') })}
      </p>
      {data.groups.length === 0 ? (
        <CardNote>{t('settingsUi.msg.groups.empty')}</CardNote>
      ) : (
        data.groups.map((g) => <GroupRow key={g._id} group={g} sites={data.sites} canAll={data.canAll} />)
      )}
    </SettingsCard>
  )
}

function GroupRow({ group, sites, canAll }) {
  const t = useT()
  const { showToast } = useToast()
  const update = useMutation(api.bot.chatGroups.update)
  const unlink = useMutation(api.bot.chatGroups.unlink)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const active = group.status === 'active'
  const siteName = (id) => sites.find((s) => s._id === id)?.name ?? t('settingsUi.msg.groups.otherSite')

  const run = async (fn, ok) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', ok)
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const save = (patch) => run(() => update({ groupId: group._id, ...patch }), t('settingsUi.msg.saved'))
  const toggleSite = (id) => {
    const next = group.siteIds.includes(id) ? group.siteIds.filter((s) => s !== id) : [...group.siteIds, id]
    if (!next.length) return showToast('error', t('settingsUi.msg.groups.pickOne'))
    save({ siteIds: next })
  }

  const scope = group.allSites
    ? t('settingsUi.msg.groups.allLocations')
    : group.siteIds.map(siteName).join(', ')

  return (
    <div className="border-t border-line py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] leading-[18px] text-text">{group.title}</span>
          <span className="text-[12px] leading-4 text-muted">
            {active
              ? t('settingsUi.msg.groups.linkedBy', { name: group.linkedByName || '—', scope })
              : t('settingsUi.msg.groups.revoked', { reason: group.revokedReason || '—' })}
          </span>
        </div>
        <Pill size="sm" tone={active ? 'green' : 'neutral'}>
          {active ? t('settingsUi.msg.groups.active') : t('settingsUi.msg.groups.unlinked')}
        </Pill>
        {active && (
          <>
            <GhostButton size="sm" disabled={busy} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? t('settingsUi.msg.groups.close') : t('settingsUi.msg.groups.edit')}
            </GhostButton>
            <GhostButton
              size="sm"
              tone="danger"
              disabled={busy}
              onClick={() => {
                if (typeof window !== 'undefined' && !window.confirm(t('settingsUi.msg.groups.confirmUnlink', { title: group.title }))) return
                run(() => unlink({ groupId: group._id }), t('settingsUi.msg.groups.unlinkedToast'))
              }}
            >
              {t('settingsUi.msg.groups.unlink')}
            </GhostButton>
          </>
        )}
      </div>
      {active && open && (
        <div className="mt-2 pl-0 sm:pl-3">
          <SettingsRow label={t('settingsUi.msg.groups.allLocations')} helper={canAll ? null : t('settingsUi.msg.groups.allNeedsAll')}>
            <SkyToggle
              checked={group.allSites}
              disabled={busy || (!canAll && !group.allSites)}
              label={t('settingsUi.msg.groups.allLocations')}
              onChange={(v) => (v ? save({ allSites: true }) : save({ siteIds: sites.slice(0, 1).map((s) => s._id) }))}
            />
          </SettingsRow>
          {!group.allSites &&
            sites.map((s) => (
              <SettingsRow key={s._id} label={s.name}>
                <SkyToggle checked={group.siteIds.includes(s._id)} disabled={busy} label={s.name} onChange={() => toggleSite(s._id)} />
              </SettingsRow>
            ))}
          {CAPS.map((c) => (
            <SettingsRow key={c} label={t(`settingsUi.msg.groups.cap.${c}`)} helper={t(`settingsUi.msg.groups.capHelp.${c}`)}>
              <SkyToggle
                checked={group.caps[c]}
                disabled={busy}
                label={t(`settingsUi.msg.groups.cap.${c}`)}
                onChange={(v) => save({ caps: { ...group.caps, [c]: v } })}
              />
            </SettingsRow>
          ))}
          <CardNote>{t('settingsUi.msg.groups.roleNote')}</CardNote>
        </div>
      )}
    </div>
  )
}
