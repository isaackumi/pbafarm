import { useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { Pencil } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { EmptyState, Field, GhostButton, GradientButton, IfPermitted, Input, KpiStrip, Modal, Select } from '../../../components/ui'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { errorMessage } from '../../../lib/errorMessage'
import { formatDate } from '../../../lib/format'
import { useLocale, useT } from '../../../lib/i18n/context'
import { HatcheryNav, PaperCard, Pill, STATUS_LABEL, fmt, label, num, statusTone } from '../../../components/hatchery/common'

export default function BroodstockDetailPage() {
  return (
    <ProtectedRoute>
      <BroodstockDetail />
    </ProtectedRoute>
  )
}

function EditModal({ b, units, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const update = useMutation(api.hatchery.updateBroodstock)
  const [edit, setEdit] = useState({ status: b.status, weightG: b.weight_g ?? '', unitId: b.unit_id ?? '', count: String(b.count) })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setEdit((p) => ({ ...p, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await update({
        id: b.id,
        status: edit.status,
        weightG: num(edit.weightG),
        unitId: edit.unitId || undefined,
        count: b.kind === 'group' ? num(edit.count) : undefined,
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
      onSubmit={save}
      noValidate
      onClose={onClose}
      showClose
      title={t('hatcheryPage.brood.editTitle', { code: b.code })}
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
        <Field label={t('hatcheryPage.brood.status')} htmlFor="e-status">
          <Select id="e-status" value={edit.status} onChange={set('status')}>
            {Object.keys(STATUS_LABEL).map((k) => (
              <option key={k} value={k}>{label(t, 'status', k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('hatcheryPage.brood.weight')} htmlFor="e-w">
          <Input id="e-w" type="number" inputMode="decimal" value={edit.weightG} onChange={set('weightG')} />
        </Field>
        {b.kind === 'group' && (
          <Field label={t('hatcheryPage.brood.fishInGroup')} htmlFor="e-c">
            <Input id="e-c" type="number" inputMode="numeric" value={edit.count} onChange={set('count')} />
          </Field>
        )}
        <Field label={t('hatcheryPage.brood.tank')} htmlFor="e-u">
          <Select id="e-u" value={edit.unitId} onChange={set('unitId')}>
            <option value="">{t('hatcheryPage.brood.notAssigned')}</option>
            {(units || []).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

function BroodstockDetail() {
  const t = useT()
  const { locale } = useLocale()
  const { query } = useRouter()
  const { user } = useAuth()
  const id = typeof query.id === 'string' ? query.id : null
  const b = useQuery(api.hatchery.getBroodstock, user && id ? { id } : 'skip')
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const [editing, setEditing] = useState(false)
  const d = (iso) => formatDate(iso, { locale })

  if (b === undefined || b === null) {
    return (
      <Layout title={t('hatcheryPage.brood.title')} eyebrow={t('hatcheryPage.brood.eyebrow')}>
        <div className="flex flex-col gap-[28px]">
          <HatcheryNav />
          {b === undefined ? (
            <p className="text-[14px] leading-[18px] text-muted">{t('ui.loading')}</p>
          ) : (
            <EmptyState
              title={t('hatcheryPage.brood.notFound')}
              action={<GhostButton href="/hatchery/broodstock">{t('hatcheryPage.brood.back')}</GhostButton>}
            />
          )}
        </div>
      </Layout>
    )
  }

  const group = b.kind === 'group'
  return (
    <Layout
      title={b.code}
      eyebrow={[
        group ? t('hatcheryPage.brood.groupOf', { n: fmt(b.count) }) : t('hatcheryPage.brood.individual'),
        label(t, 'sex', b.sex),
        b.species,
        b.strain,
        label(t, 'origin', b.origin) + (b.origin_note ? ` (${b.origin_note})` : ''),
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        <IfPermitted permission="hatchery.broodstock.manage">
          <GradientButton icon={Pencil} onClick={() => setEditing(true)}>
            {t('common.edit')}
          </GradientButton>
        </IfPermitted>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <HatcheryNav />

        <KpiStrip
          items={[
            {
              key: 'status',
              label: t('hatcheryPage.brood.status'),
              value: label(t, 'status', b.status),
              valueTone: statusTone(b.status) === 'good' ? 'good' : statusTone(b.status) === 'warn' ? 'alert' : undefined,
            },
            {
              key: 'weight',
              label: group ? t('hatcheryPage.brood.meanWeight') : t('hatcheryPage.brood.weight'),
              value: fmt(b.weight_g),
              suffix: b.total_kg ? t('hatcheryPage.brood.totalKg', { kg: fmt(b.total_kg, 2) }) : undefined,
            },
            { key: 'spawnings', label: t('hatcheryPage.brood.spawnings'), value: fmt(b.spawn_count), suffix: b.last_spawned_on ? t('hatcheryPage.brood.lastOn', { date: d(b.last_spawned_on) }) : undefined },
            {
              key: 'tank',
              label: t('hatcheryPage.brood.tank'),
              value: b.unit_name || '—',
              suffix: b.conditioning_started_on ? t('hatcheryPage.brood.conditioningSince', { date: d(b.conditioning_started_on) }) : undefined,
            },
          ]}
        />

        <PaperCard title={t('hatcheryPage.brood.history')} meta={b.spawnings.length}>
          {b.spawnings.length === 0 ? (
            <p className="border-t border-line py-[11px] text-[13px] leading-[18px] text-muted">{t('hatcheryPage.brood.noSpawnings')}</p>
          ) : (
            <ul className="flex flex-col">
              {b.spawnings.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-t border-line py-[11px]">
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    <span className="text-[14px] leading-[18px] text-text">
                      {d(s.spawn_date)} · {s.female_codes.join(', ')}
                      {s.male_codes.length ? ` × ${s.male_codes.join(', ')}` : ''}
                    </span>
                    <span className="text-xs leading-4 text-muted">
                      {[
                        s.hormone ? `${s.hormone}${s.hormone_dose ? ` ${s.hormone_dose}` : ''}` : label(t, 'method', s.method),
                        s.eggs_collected != null ? t('hatcheryPage.eggsN', { n: fmt(s.eggs_collected) }) : null,
                        s.larvae ? t('hatcheryPage.larvaeN', { n: fmt(s.larvae) }) : null,
                        s.fry_per_kg_female != null ? t('hatcheryPage.fryPerKg', { n: fmt(s.fry_per_kg_female) }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <Pill tone={statusTone(s.status)}>{label(t, 'status', s.status)}</Pill>
                </li>
              ))}
            </ul>
          )}
        </PaperCard>
        {b.notes && (
          <PaperCard title={t('common.notes')}>
            <p className="text-[14px] leading-[20px] text-muted">{b.notes}</p>
          </PaperCard>
        )}

        {editing && <EditModal b={b} units={units} onClose={() => setEditing(false)} />}
      </div>
    </Layout>
  )
}
