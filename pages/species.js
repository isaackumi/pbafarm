import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Button,
  EmptyState,
  Field,
  FormActions,
  GhostButton,
  GradientButton,
  Input,
  Pill,
} from '../components/ui'
import FarmSetupNav from '../components/units/FarmSetupNav'
import { useToast } from '../components/Toast'
import { api } from '../convex/_generated/api'
import { errorMessage } from '../lib/errorMessage'
import { MAX_HARVEST_GRADES } from '../convex/lib/species'
import { useT } from '../lib/i18n/context'

const blankGrade = () => ({ key: '', label: '', minG: '', maxG: '' })
const optNum = (v) => (v === '' || v == null ? undefined : Number(v))
const str = (v) => (v == null ? '' : String(v))

function toForm(s) {
  return {
    id: s?.id,
    key: s?.key || '',
    name: s?.name || '',
    scientificName: s?.scientificName || '',
    targetHarvestAbwG: str(s?.targetHarvestAbwG),
    targetFcr: str(s?.targetFcr),
    expectedDailyGrowthG: str(s?.expectedDailyGrowthG),
    harvestGrades: (s?.harvestGrades || []).map((g) => ({
      key: g.key,
      label: g.label,
      minG: str(g.minG),
      maxG: str(g.maxG),
    })),
  }
}

/** Edit one species: targets and harvest grades (heaviest first). */
function SpeciesEditor({ initial, onDone }) {
  const t = useT()
  const { showToast } = useToast()
  const upsert = useMutation(api.species.upsert)
  const [form, setForm] = useState(() => toForm(initial))
  const [saving, setSaving] = useState(false)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const setGrade = (i, field, value) =>
    setForm((f) => ({
      ...f,
      harvestGrades: f.harvestGrades.map((g, j) => (j === i ? { ...g, [field]: value } : g)),
    }))
  const prefix = form.id || 'new'

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await upsert({
        ...(form.id ? { id: form.id } : {}),
        key: form.key,
        name: form.name,
        scientificName: form.scientificName || undefined,
        targetHarvestAbwG: optNum(form.targetHarvestAbwG),
        targetFcr: optNum(form.targetFcr),
        expectedDailyGrowthG: optNum(form.expectedDailyGrowthG),
        harvestGrades: form.harvestGrades
          .filter((g) => g.key.trim() || g.label.trim())
          .map((g) => ({ key: g.key, label: g.label || g.key, minG: optNum(g.minG), maxG: optNum(g.maxG) })),
      })
      showToast(t('species.saved'), 'success')
      onDone?.()
    } catch (err) {
      showToast(errorMessage(err, t('species.couldNotSave')), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t('species.name')} htmlFor={`${prefix}-name`} required>
          <Input id={`${prefix}-name`} value={form.name} onChange={set('name')} required />
        </Field>
        <Field label={t('species.code')} htmlFor={`${prefix}-key`} required hint={t('species.codeHint')}>
          <Input id={`${prefix}-key`} value={form.key} onChange={set('key')} disabled={Boolean(form.id)} required />
        </Field>
        <Field label={t('species.scientificName')} htmlFor={`${prefix}-sci`}>
          <Input id={`${prefix}-sci`} value={form.scientificName} onChange={set('scientificName')} />
        </Field>
        <Field label={t('species.targetAbw')} htmlFor={`${prefix}-abw`}>
          <Input id={`${prefix}-abw`} type="number" inputMode="decimal" min="0" step="any" value={form.targetHarvestAbwG} onChange={set('targetHarvestAbwG')} className="tabular-nums" />
        </Field>
        <Field label={t('species.targetFcr')} htmlFor={`${prefix}-fcr`}>
          <Input id={`${prefix}-fcr`} type="number" inputMode="decimal" min="0" step="0.01" value={form.targetFcr} onChange={set('targetFcr')} className="tabular-nums" />
        </Field>
        <Field label={t('species.dailyGrowth')} htmlFor={`${prefix}-adg`}>
          <Input id={`${prefix}-adg`} type="number" inputMode="decimal" min="0" step="any" value={form.expectedDailyGrowthG} onChange={set('expectedDailyGrowthG')} className="tabular-nums" />
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-text">{t('species.grades')}</p>
        <p className="text-xs text-muted">{t('species.gradesHint')}</p>
        {form.harvestGrades.map((g, i) => (
          <div key={i} className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end">
            <Field label={t('species.gradeCode')} htmlFor={`${prefix}-g${i}-key`} className="sm:col-span-2">
              <Input id={`${prefix}-g${i}-key`} value={g.key} onChange={(e) => setGrade(i, 'key', e.target.value)} />
            </Field>
            <Field label={t('species.gradeName')} htmlFor={`${prefix}-g${i}-label`} className="sm:col-span-4">
              <Input id={`${prefix}-g${i}-label`} value={g.label} onChange={(e) => setGrade(i, 'label', e.target.value)} />
            </Field>
            <Field label={t('species.fromG')} htmlFor={`${prefix}-g${i}-min`} className="sm:col-span-2">
              <Input id={`${prefix}-g${i}-min`} type="number" min="0" step="any" value={g.minG} onChange={(e) => setGrade(i, 'minG', e.target.value)} className="tabular-nums" />
            </Field>
            <Field label={t('species.toG')} htmlFor={`${prefix}-g${i}-max`} className="sm:col-span-2">
              <Input id={`${prefix}-g${i}-max`} type="number" min="0" step="any" value={g.maxG} onChange={(e) => setGrade(i, 'maxG', e.target.value)} className="tabular-nums" />
            </Field>
            <div className="sm:col-span-2 flex">
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('species.removeGrade', { code: g.key || i + 1 })}
                onClick={() => setForm((f) => ({ ...f, harvestGrades: f.harvestGrades.filter((_, j) => j !== i) }))}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        {form.harvestGrades.length < MAX_HARVEST_GRADES && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setForm((f) => ({ ...f, harvestGrades: [...f.harvestGrades, blankGrade()] }))}
          >
            <Plus size={14} aria-hidden />
            {t('species.addGrade')}
          </Button>
        )}
      </div>

      <FormActions className="justify-end">
        {onDone && (
          <Button variant="secondary" onClick={onDone}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </FormActions>
    </form>
  )
}

function SpeciesSettings() {
  const t = useT()
  const { showToast } = useToast()
  const list = useQuery(api.species.list, { includeArchived: true })
  const ensureDefaults = useMutation(api.species.ensureDefaults)
  const archive = useMutation(api.species.archive)
  const [editing, setEditing] = useState(null)

  const seed = async () => {
    try {
      const { added } = await ensureDefaults({})
      showToast(added.length ? t('species.seeded', { count: added.length }) : t('species.nothingToSeed'), 'success')
    } catch (err) {
      showToast(errorMessage(err), 'error')
    }
  }

  const card = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
  const h2 = 'text-[17px] font-semibold leading-[22px] text-text'

  return (
    <Layout
      title={t('species.title')}
      eyebrow={t('species.description')}
      actions={
        <>
          <GradientButton onClick={seed}>{t('species.addStandard')}</GradientButton>
          <GradientButton reverse icon={Plus} onClick={() => setEditing('new')}>
            {t('species.add')}
          </GradientButton>
        </>
      }
    >
      <div className="flex flex-col gap-8 md:flex-row">
        <FarmSetupNav />
        <div className="flex min-w-0 max-w-3xl grow flex-col gap-5">
          {editing === 'new' && (
            <section className={`${card} p-6`} aria-labelledby="species-new-title">
              <h2 id="species-new-title" className={`${h2} mb-5`}>{t('species.new')}</h2>
              <SpeciesEditor initial={null} onDone={() => setEditing(null)} />
            </section>
          )}
          {list === undefined ? (
            <div className="h-40 animate-pulse rounded-input bg-surface-2" />
          ) : list.length === 0 ? (
            <section className={card}>
              <EmptyState
                title={t('species.emptyTitle')}
                description={t('species.emptyDescription')}
                action={<GradientButton onClick={seed}>{t('species.addStandard')}</GradientButton>}
              />
            </section>
          ) : (
            list.map((s) => (
              <section key={s.id} aria-label={s.name} className={`${card} ${s.active ? '' : 'opacity-70'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className={h2}>{s.name}</h2>
                    <p className="text-xs text-muted">
                      {[s.scientificName, s.key].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!s.active && <Pill tone="neutral">{t('species.archived')}</Pill>}
                    {editing !== s.id && (
                      <GhostButton size="sm" onClick={() => setEditing(s.id)}>
                        {t('common.edit')}
                      </GhostButton>
                    )}
                    <GhostButton
                      size="sm"
                      tone={s.active ? 'danger' : 'default'}
                      onClick={() => archive({ id: s.id, archived: s.active }).catch((err) => showToast(errorMessage(err), 'error'))}
                    >
                      {s.active ? t('species.archive') : t('species.restore')}
                    </GhostButton>
                  </div>
                </div>
                {editing === s.id ? (
                  <div className="p-6">
                    <SpeciesEditor initial={s} onDone={() => setEditing(null)} />
                  </div>
                ) : (
                  <dl>
                    {[
                      [t('species.targetAbw'), s.targetHarvestAbwG ?? '—'],
                      [t('species.targetFcr'), s.targetFcr ?? '—'],
                      [
                        t('species.grades'),
                        s.harvestGrades.length ? s.harvestGrades.map((g) => `${g.label} (${g.range})`).join(', ') : t('species.noGrades'),
                      ],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-6 border-t border-line px-6 py-[14px] text-[14px] first:border-t-0">
                        <dt className="text-muted">{k}</dt>
                        <dd className="text-right tabular-nums text-text">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            ))
          )}
        </div>
      </div>
    </Layout>
  )
}

export default function SpeciesPage() {
  return (
    <ProtectedRoute permission="org.settings.manage">
      <SpeciesSettings />
    </ProtectedRoute>
  )
}
