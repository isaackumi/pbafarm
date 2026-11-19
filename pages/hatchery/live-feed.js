import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { EmptyState, Field, GhostButton, GradientButton, IfPermitted, Input, KpiStrip, Modal, Select } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { formatDate } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'
import { HatcheryNav, LIVE_FEED_LABEL, LIVE_FEED_UNIT, PaperCard, Pill, fmt, label, num, today } from '../../components/hatchery/common'

const MOVEMENTS = ['produced', 'used', 'discarded']
const MOVEMENT_TONE = { produced: 'good', used: 'accent', discarded: 'warn' }

export default function LiveFeedPage() {
  return (
    <ProtectedRoute>
      <LiveFeed />
    </ProtectedRoute>
  )
}

function EntryModal({ onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const record = useMutation(api.nursery.recordLiveFeed)
  const [form, setForm] = useState({
    date: today(),
    kind: 'artemia',
    movement: 'produced',
    quantity: '',
    unit: 'million',
    culture: '',
    inputNote: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await record({
        date: form.date,
        kind: form.kind,
        movement: form.movement,
        quantity: num(form.quantity),
        unit: form.unit,
        culture: form.culture || undefined,
        inputNote: form.inputNote || undefined,
      })
      showToast('success', t('hatcheryPage.saved'))
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      as="form"
      onSubmit={submit}
      noValidate
      onClose={onClose}
      showClose
      title={t('hatcheryPage.feed.newTitle')}
      description={t('hatcheryPage.feed.newHint')}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('hatcheryPage.date')} htmlFor="lf-date">
          <Input id="lf-date" type="date" value={form.date} onChange={set('date')} />
        </Field>
        <Field label={t('hatcheryPage.feed.feed')} htmlFor="lf-kind">
          <Select id="lf-kind" value={form.kind} onChange={set('kind')}>
            {Object.keys(LIVE_FEED_LABEL).map((k) => (
              <option key={k} value={k}>{label(t, 'liveFeed', k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('hatcheryPage.feed.entry')} htmlFor="lf-mv">
          <Select id="lf-mv" value={form.movement} onChange={set('movement')}>
            {MOVEMENTS.map((k) => (
              <option key={k} value={k}>{t(`hatcheryPage.feed.mv.${k}`)}</option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label={t('hatcheryPage.larval.amount')} htmlFor="lf-q">
            <Input id="lf-q" type="number" inputMode="decimal" step="any" value={form.quantity} onChange={set('quantity')} />
          </Field>
          <Select aria-label={t('hatcheryPage.larval.unit')} value={form.unit} onChange={set('unit')} className="w-28">
            {Object.keys(LIVE_FEED_UNIT).map((k) => (
              <option key={k} value={k}>{label(t, 'unit', k)}</option>
            ))}
          </Select>
        </div>
        <Field label={t('hatcheryPage.feed.culture')} htmlFor="lf-c" hint={t('hatcheryPage.feed.cultureHint')}>
          <Input id="lf-c" value={form.culture} onChange={set('culture')} />
        </Field>
        <Field label={t('hatcheryPage.feed.inputs')} htmlFor="lf-i" hint={t('hatcheryPage.feed.inputsHint')}>
          <Input id="lf-i" value={form.inputNote} onChange={set('inputNote')} />
        </Field>
      </div>
    </Modal>
  )
}

function LiveFeed() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const { showToast } = useToast()
  const data = useQuery(api.nursery.liveFeed, user ? {} : 'skip')
  const remove = useMutation(api.nursery.removeLiveFeed)
  const [adding, setAdding] = useState(false)

  const del = async (id) => {
    try {
      await remove({ id })
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.feed.removeFailed')))
    }
  }

  return (
    <Layout
      title={t('hatcheryPage.feed.title')}
      eyebrow={t('hatcheryPage.feed.eyebrow')}
      actions={
        <IfPermitted permission="hatchery.larval.record">
          <GradientButton icon={Plus} onClick={() => setAdding(true)}>
            {t('hatcheryPage.feed.add')}
          </GradientButton>
        </IfPermitted>
      }
    >
      <HatcheryNav />

      {data?.balances?.length > 0 && (
        <KpiStrip
          items={data.balances.map((b) => ({
            key: `${b.kind}-${b.unit}`,
            label: t('hatcheryPage.feed.onHand', { feed: label(t, 'liveFeed', b.kind) }),
            value: fmt(b.on_hand, 2),
            valueTone: b.on_hand < 0 ? 'alert' : undefined,
            suffix: `${label(t, 'unit', b.unit)} · ${t('hatcheryPage.feed.producedUsed', { produced: fmt(b.produced, 2), used: fmt(b.used, 2) })}`,
          }))}
        />
      )}

      <PaperCard title={t('hatcheryPage.feed.entries')} meta={data ? data.entries.length : undefined}>
        {data === undefined ? (
          <p className="text-[13px] leading-[18px] text-muted">{t('ui.loading')}</p>
        ) : data.entries.length === 0 ? (
          <EmptyState title={t('hatcheryPage.feed.empty')} description={t('hatcheryPage.feed.emptyHint')} />
        ) : (
          <ul className="flex flex-col">
            {data.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-[11px]">
                <div className="flex min-w-0 flex-col gap-[2px]">
                  <span className="text-[14px] leading-[18px] text-text">
                    {formatDate(e.date, { locale })} · {fmt(e.quantity, 2)} {label(t, 'unit', e.unit)} {label(t, 'liveFeed', e.kind)}
                  </span>
                  <span className="text-xs leading-4 text-muted">
                    {[e.culture, e.input_note, e.from_larval_log ? t('hatcheryPage.feed.fromLog') : null].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Pill tone={MOVEMENT_TONE[e.movement]}>{t(`hatcheryPage.feed.mv.${e.movement}`)}</Pill>
                  {!e.from_larval_log && (
                    <IfPermitted permission="hatchery.larval.record">
                      <GhostButton size="sm" tone="danger" onClick={() => del(e.id)}>
                        {t('hatcheryPage.feed.remove')}
                      </GhostButton>
                    </IfPermitted>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </PaperCard>

      {adding && <EntryModal onClose={() => setAdding(false)} />}
    </Layout>
  )
}
