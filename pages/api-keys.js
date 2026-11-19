import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useAction, useMutation, useQuery } from 'convex/react'
import { ArrowRight, CodeXml, Plus } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { GhostButton, GradientButton, Pill, Skeleton } from '../components/ui'
import { FIELD, Notice, SettingsCard, SettingsField } from '../components/settings'
import { CheckTile, IntegrationsShell, SecretOnce, formatTime, scopeTone, useRelativeTime } from '../components/integrations/kit'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const DAY = 86_400_000
const STALE_DAYS = 30
const STATUS_TONE = { active: 'green', revoked: 'red', expired: 'neutral' }

function NewKeyCard({ scopes, sites, onCreated }) {
  const t = useT()
  const { showToast } = useToast()
  const create = useAction(api.apiKeys.create)
  const [name, setName] = useState('')
  const [chosen, setChosen] = useState(['cages:read'])
  const [siteIds, setSiteIds] = useState([])
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await create({
        name,
        scopes: chosen,
        locationIds: siteIds.length ? siteIds : undefined,
        expiresInDays: expiry ? Number(expiry) : undefined,
      })
      onCreated(res)
      setName('')
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard id="new-key" title={t('settingsUi.integ.keys.newTitle')} meta={t('settingsUi.integ.keys.newHint')}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <SettingsField label={t('settingsUi.integ.keys.name')} htmlFor="key-name" hint={t('settingsUi.integ.keys.nameHint')} required>
          <input id="key-name" className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </SettingsField>
        <fieldset>
          <legend className="mb-2 text-[12px] leading-4 text-muted">{t('settingsUi.integ.keys.permissions')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {scopes.map((s) => (
              <CheckTile
                key={s.id}
                id={`scope-${s.id}`}
                checked={chosen.includes(s.id)}
                onChange={() => toggle(chosen, setChosen, s.id)}
                label={s.label}
                sub={s.id}
              />
            ))}
          </div>
        </fieldset>
        {sites.length > 1 && (
          <fieldset>
            <legend className="mb-1 text-[12px] leading-4 text-muted">{t('settingsUi.integ.keys.sites')}</legend>
            <p className="mb-2 text-[13px] leading-4 text-faint">{t('settingsUi.integ.keys.sitesHint')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {sites.map((s) => (
                <CheckTile key={s.id} id={`site-${s.id}`} checked={siteIds.includes(s.id)} onChange={() => toggle(siteIds, setSiteIds, s.id)} label={s.name} />
              ))}
            </div>
          </fieldset>
        )}
        <SettingsField label={t('settingsUi.integ.keys.expires')} htmlFor="key-expiry" className="sm:max-w-xs">
          <select id="key-expiry" className={FIELD} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            <option value="">{t('settingsUi.integ.keys.never')}</option>
            <option value="30">{t('settingsUi.integ.keys.in30')}</option>
            <option value="90">{t('settingsUi.integ.keys.in90')}</option>
            <option value="365">{t('settingsUi.integ.keys.inYear')}</option>
          </select>
        </SettingsField>
        <div>
          <GradientButton type="submit" size="sm" disabled={busy || !name.trim() || !chosen.length}>
            {busy ? t('settingsUi.integ.keys.creating') : t('settingsUi.integ.keys.create')}
          </GradientButton>
        </div>
      </form>
    </SettingsCard>
  )
}

function KeyRow({ k, sitesById, now }) {
  const t = useT()
  const ago = useRelativeTime()
  const { showToast } = useToast()
  const revoke = useMutation(api.apiKeys.revoke)
  const onRevoke = async () => {
    if (!window.confirm(t('settingsUi.integ.keys.revokeConfirm', { name: k.name }))) return
    try {
      await revoke({ keyId: k.id })
      showToast('success', t('settingsUi.integ.keys.revoked'))
    } catch (err) {
      showToast('error', errorMessage(err))
    }
  }
  const active = k.status === 'active'
  const idleDays = Math.floor((now - (k.lastUsedAt || k.createdAt || now)) / DAY)
  const stale = active && idleDays >= STALE_DAYS
  const sites = k.locationIds.length
    ? k.locationIds.map((id) => sitesById[id] || t('settingsUi.integ.keys.removedSite')).join(', ')
    : t('settingsUi.integ.keys.allSites')
  return (
    <li className="grid gap-3 border-t border-line py-[14px] md:grid-cols-[minmax(0,1fr)_230px_120px_84px] md:items-center md:gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] leading-[18px] text-text">{k.name}</span>
          {!active && <Pill tone={STATUS_TONE[k.status] || 'neutral'}>{t(`settingsUi.integ.keys.status.${k.status}`)}</Pill>}
        </div>
        <p className="mt-1 truncate font-mono text-[12px] leading-4 text-muted">{k.prefix}…</p>
        <p className="mt-1 text-[12px] leading-4 text-faint">
          {sites}
          {k.expiresAt ? ` · ${t('settingsUi.integ.keys.expiresOn', { time: formatTime(k.expiresAt) })}` : ''}
          {' · '}
          {k.createdBy
            ? t('settingsUi.integ.keys.createdBy', { time: formatTime(k.createdAt), name: k.createdBy })
            : t('settingsUi.integ.keys.created', { time: formatTime(k.createdAt) })}
        </p>
      </div>
      <ul className="flex flex-wrap gap-[6px]" aria-label={t('settingsUi.integ.keys.permissions')}>
        {k.scopes.map((s) => (
          <li key={s}>
            <Pill tone={scopeTone(s)} size="sm">
              {s}
            </Pill>
          </li>
        ))}
      </ul>
      <span className={`whitespace-nowrap text-[13px] leading-4 ${stale ? 'text-warn' : 'text-muted'}`}>
        {stale
          ? t('settingsUi.integ.keys.unusedDays', { count: idleDays })
          : k.lastUsedAt
            ? t('settingsUi.integ.keys.used', { time: ago(k.lastUsedAt, now) })
            : t('settingsUi.integ.keys.neverUsed')}
      </span>
      <div className="md:justify-self-end">
        {active && (
          <GhostButton onClick={onRevoke}>
            {t('settingsUi.integ.keys.revoke')}
          </GhostButton>
        )}
      </div>
    </li>
  )
}

function OutboundSummary({ now }) {
  const t = useT()
  const ago = useRelativeTime()
  const data = useQuery(api.webhooks.overview)
  return (
    <SettingsCard
      title={t('settingsUi.integ.nav.outbound')}
      action={
        <Link href="/webhooks" className="flex items-center gap-1 rounded text-[13px] leading-4 text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
          <Plus size={14} aria-hidden />
          {t('settingsUi.integ.addEndpoint')}
        </Link>
      }
    >
      {!data ? (
        <Skeleton className="h-24" />
      ) : data.endpoints.length === 0 ? (
        <p className="border-t border-line py-4 text-[13px] leading-4 text-muted">{t('settingsUi.integ.hooks.emptyHint')}</p>
      ) : (
        <ul>
          {data.endpoints.map((ep) => {
            const failing = ep.consecutiveFailures > 0
            const tone = ep.status !== 'active' ? 'neutral' : failing ? 'red' : 'green'
            const label =
              ep.status !== 'active'
                ? t('integ.common.off')
                : failing
                  ? t('settingsUi.integ.hooks.failing', { count: ep.consecutiveFailures })
                  : ep.lastSuccessAt
                    ? t('settingsUi.integ.hooks.deliveredAgo', { time: ago(ep.lastSuccessAt, now) })
                    : t('integ.common.on')
            return (
              <li key={ep.id} className="flex flex-col gap-2 border-t border-line py-[14px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-[13px] leading-4 text-text">{ep.url}</span>
                  <Pill tone={tone} size="sm" className="shrink-0">
                    {label}
                  </Pill>
                </div>
                <p className="truncate text-[12px] leading-4 text-muted">{ep.eventTypes.join(' · ')}</p>
              </li>
            )
          })}
        </ul>
      )}
    </SettingsCard>
  )
}

function InboundSummary({ now }) {
  const t = useT()
  const ago = useRelativeTime()
  const data = useQuery(api.inboundWebhooks.overview, {})
  return (
    <SettingsCard title={t('settingsUi.integ.nav.inbound')} meta={data ? data.webhooks.length : undefined}>
      {!data ? (
        <Skeleton className="h-24" />
      ) : data.webhooks.length === 0 ? (
        <p className="border-t border-line py-4 text-[13px] leading-4 text-muted">{t('integ.inbound.emptyHint')}</p>
      ) : (
        <ul>
          {data.webhooks.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-3 border-t border-line py-3">
              <div className="min-w-0">
                <Link
                  href="/inbound-webhooks"
                  className="rounded text-[14px] leading-[18px] text-text hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
                >
                  {h.name}
                </Link>
                <p className="mt-[2px] truncate text-[12px] leading-4 text-muted">
                  {h.lastReceivedAt ? t('settingsUi.integ.hooks.receivedAgo', { time: ago(h.lastReceivedAt, now) }) : t('integ.inbound.noEvents')}
                  {h.secretHint ? ` · ${t('settingsUi.integ.hooks.secretEnding', { hint: h.secretHint })}` : ''}
                </p>
              </div>
              {h.status !== 'active' && <Pill tone="neutral">{t('integ.common.off')}</Pill>}
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}

function DocsLink() {
  const t = useT()
  return (
    <Link
      href="/api-docs"
      className="flex items-center gap-4 rounded-card border border-line px-5 py-5 hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:px-[26px]"
    >
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--pill-cyan-border)] text-cyan">
        <CodeXml size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium leading-[18px] text-text">{t('settingsUi.integ.docsTitle')}</span>
        <span className="mt-[2px] block text-[12px] leading-4 text-muted">{t('settingsUi.integ.docsHint')}</span>
      </span>
      <ArrowRight size={18} aria-hidden className="shrink-0 text-muted" />
    </Link>
  )
}

function ApiKeysScreen() {
  const t = useT()
  const [now] = useState(() => Date.now())
  const data = useQuery(api.apiKeys.overview, { now })
  const [created, setCreated] = useState(null)
  const { showToast } = useToast()
  const sitesById = useMemo(() => Object.fromEntries((data?.sites || []).map((s) => [s.id, s.name])), [data])
  const activeCount = data ? data.keys.filter((k) => k.status === 'active').length : 0

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key)
      showToast('success', t('settingsUi.integ.keys.copied'))
    } catch {
      showToast('error', t('integ.common.copyFailed'))
    }
  }

  return (
    <IntegrationsShell
      title={t('settingsUi.integ.title')}
      actions={
        <GradientButton href="#new-key" icon={Plus}>
          {t('settingsUi.integ.keys.newTitle')}
        </GradientButton>
      }
    >
      <p className="max-w-3xl text-[14px] leading-[18px] text-muted">{t('settingsUi.integ.keys.description')}</p>
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {created && (
            <SecretOnce
              title={t('settingsUi.integ.keys.copyNowTitle')}
              hint={t('settingsUi.integ.keys.copyNowHint')}
              secret={created.key}
              copyLabel={t('settingsUi.integ.keys.copyKey')}
              onCopy={copy}
              onDone={() => setCreated(null)}
            />
          )}
          <SettingsCard title={t('settingsUi.integ.keys.title')} meta={t('settingsUi.integ.keys.meta', { count: activeCount })}>
            {data.keys.length === 0 ? (
              <Notice tone="cyan">{t('settingsUi.integ.keys.empty')}</Notice>
            ) : (
              <ul>
                {data.keys.map((k) => (
                  <KeyRow key={k.id} k={k} sitesById={sitesById} now={now} />
                ))}
              </ul>
            )}
          </SettingsCard>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <OutboundSummary now={now} />
            <InboundSummary now={now} />
          </div>
          <DocsLink />
          <NewKeyCard scopes={data.scopes} sites={data.sites} onCreated={setCreated} />
        </>
      )}
    </IntegrationsShell>
  )
}

export default function ApiKeysPage() {
  return (
    <ProtectedRoute permission="integrations.manage">
      <ApiKeysScreen />
    </ProtectedRoute>
  )
}
