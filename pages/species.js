import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Plus, Trash2 } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FormActions,
  FormPage,
  Input,
  PageHeader,
} from '../components/ui'
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
        <p className="text-sm font-medium text-chart-ink">{t('species.grades')}</p>
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

  return (
    <FormPage width="lg">
      <PageHeader
        title={t('species.title')}
        description={t('species.description')}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={seed}>
              {t('species.addStandard')}
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden />
              {t('species.add')}
            </Button>
          </>
        }
      />
      <div className="space-y-4">
        {editing === 'new' && (
          <Card>
            <CardHeader title={t('species.new')} />
            <SpeciesEditor initial={null} onDone={() => setEditing(null)} />
          </Card>
        )}
        {list === undefined ? (
          <div className="h-40 rounded-xl bg-foam animate-pulse" />
        ) : list.length === 0 ? (
          <Card>
            <EmptyState
              title={t('species.emptyTitle')}
              description={t('species.emptyDescription')}
              action={<Button onClick={seed}>{t('species.addStandard')}</Button>}
            />
          </Card>
        ) : (
          list.map((s) => (
            <Card key={s.id} className={s.active ? '' : 'opacity-70'}>
              <CardHeader
                title={s.name}
                subtitle={[s.scientificName, s.key, s.active ? null : t('species.archived')].filter(Boolean).join(' · ')}
                action={
                  <div className="flex gap-2">
                    {editing !== s.id && (
                      <Button variant="secondary" size="sm" onClick={() => setEditing(s.id)}>
                        {t('common.edit')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archive({ id: s.id, archived: s.active }).catch((err) => showToast(errorMessage(err), 'error'))}
                    >
                      {s.active ? t('species.archive') : t('species.restore')}
                    </Button>
                  </div>
                }
              />
              {editing === s.id ? (
                <SpeciesEditor initial={s} onDone={() => setEditing(null)} />
              ) : (
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">{t('species.targetAbw')}</dt>
                    <dd className="tabular-nums text-chart-ink">{s.targetHarvestAbwG ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('species.targetFcr')}</dt>
                    <dd className="tabular-nums text-chart-ink">{s.targetFcr ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t('species.grades')}</dt>
                    <dd className="text-chart-ink">
                      {s.harvestGrades.length
                        ? s.harvestGrades.map((g) => `${g.label} (${g.range})`).join(', ')
                        : t('species.noGrades')}
                    </dd>
                  </div>
                </dl>
              )}
            </Card>
          ))
        )}
      </div>
    </FormPage>
  )
}

export default function SpeciesPage() {
  const t = useT()
  return (
    <ProtectedRoute permission="org.settings.manage">
      <Layout title={t('species.title')}>
        <SpeciesSettings />
      </Layout>
    </ProtectedRoute>
  )
}
