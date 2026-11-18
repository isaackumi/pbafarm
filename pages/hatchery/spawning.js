import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  Button,
  EmptyState,
  Field,
  FormCard,
  FormSection,
  Input,
  PageHeader,
  Select,
  StickyActions,
  Textarea,
} from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { newClientMutationId } from '../../lib/offlineOutbox'
import { HatcheryNav, METHOD_LABEL, SEX_LABEL, fmt, num, today } from '../../components/hatchery/common'

const STEPS = ['Broodstock', 'Spawning', 'Eggs', 'Incubation']

export default function SpawningPage() {
  return (
    <ProtectedRoute>
      <Layout title="New spawning">
        <SpawningWizard />
      </Layout>
    </ProtectedRoute>
  )
}

function SpawningWizard() {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const broodstock = useQuery(api.hatchery.listBroodstock, user ? {} : 'skip')
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const recordSpawning = useMutation(api.hatchery.recordSpawning)
  const startIncubation = useMutation(api.hatchery.startIncubation)
  const [step, setStep] = useState(0)
  const [females, setFemales] = useState([])
  const [males, setMales] = useState([])
  const [form, setForm] = useState({
    spawnDate: today(),
    method: 'natural',
    hormone: '',
    hormoneDose: '',
    unitId: '',
    eggsCollected: '',
    eggWeightG: '',
    fertilizationPct: '',
    notes: '',
  })
  const [lots, setLots] = useState([{ unitId: '', eggs: '', temperatureC: '' }])
  const [saving, setSaving] = useState(false)
  // One replay key per attempt so a retried submit after a lost response writes once.
  const [keys] = useState(() => ({ spawning: newClientMutationId(), lots: [] }))
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  const available = useMemo(
    () => (broodstock || []).filter((b) => b.status !== 'dead' && b.status !== 'retired'),
    [broodstock],
  )
  const incubators = (units || []).filter((u) => ['incubator', 'hatchery_tank', 'tank'].includes(u.unit_type))
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const eggsInLots = lots.reduce((t, l) => t + (num(l.eggs) || 0), 0)

  const canNext =
    step === 0 ? females.length > 0 : step === 1 ? !!form.spawnDate && (form.method !== 'induced' || form.hormone.trim()) : true

  const submit = async () => {
    setSaving(true)
    try {
      const spawningEventId = await recordSpawning({
        spawnDate: form.spawnDate,
        method: form.method,
        hormone: form.hormone || undefined,
        hormoneDose: form.hormoneDose || undefined,
        femaleIds: females,
        maleIds: males,
        unitId: form.unitId || undefined,
        eggsCollected: num(form.eggsCollected),
        eggWeightG: num(form.eggWeightG),
        fertilizationPct: num(form.fertilizationPct),
        notes: form.notes || undefined,
        clientMutationId: keys.spawning,
      })
      const toIncubate = lots.filter((l) => l.unitId && num(l.eggs) > 0)
      for (const [i, l] of toIncubate.entries()) {
        keys.lots[i] = keys.lots[i] || newClientMutationId()
        await startIncubation({
          spawningEventId,
          unitId: l.unitId,
          startedOn: form.spawnDate,
          eggs: num(l.eggs),
          temperatureC: num(l.temperatureC),
          clientMutationId: keys.lots[i],
        })
      }
      showToast(
        'success',
        toIncubate.length ? `Spawning saved; ${toIncubate.length} incubation lot(s) started` : 'Spawning saved',
      )
      router.push('/hatchery')
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save the spawning'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="New spawning"
        description="Pick the broodstock, record how they spawned and the eggs collected, then put the eggs in incubators."
      />
      <HatcheryNav />

      <ol className="flex flex-wrap gap-2 mb-6" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={`inline-flex items-center gap-2 rounded-lg px-3 min-h-11 text-sm border ${
                i === step
                  ? 'border-lake text-chart-ink font-medium'
                  : i < step
                    ? 'border-foam-deep text-chart-ink'
                    : 'border-foam-deep text-muted'
              }`}
            >
              <span className="tabular-nums">{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      <FormCard>
        {step === 0 && (
          <FormSection title="Broodstock" description="Choose the females and the males or male groups that spawned.">
            {broodstock === undefined ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : available.length === 0 ? (
              <EmptyState
                title="No broodstock"
                description="Add broodstock first."
                action={<Button href="/hatchery/broodstock" variant="secondary">Add broodstock</Button>}
              />
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {[
                  ['Females', females, setFemales, (b) => b.sex !== 'male'],
                  ['Males', males, setMales, (b) => b.sex !== 'female'],
                ].map(([label, list, setList, fits]) => (
                  <fieldset key={label}>
                    <legend className="text-sm font-semibold text-chart-ink mb-2">
                      {label} <span className="font-normal text-muted">({list.length} chosen)</span>
                    </legend>
                    <ul className="space-y-1 max-h-80 overflow-y-auto">
                      {available.filter(fits).map((b) => {
                        const other = label === 'Females' ? males : females
                        return (
                          <li key={b.id}>
                            <label className="flex items-center gap-3 min-h-11 px-2 rounded-lg hover:bg-foam cursor-pointer">
                              <input
                                type="checkbox"
                                className="size-4"
                                checked={list.includes(b.id)}
                                disabled={other.includes(b.id)}
                                onChange={() => toggle(list, setList, b.id)}
                              />
                              <span className="font-data text-chart-ink">{b.code}</span>
                              <span className="text-sm text-muted">
                                {[SEX_LABEL[b.sex], b.kind === 'group' ? `${fmt(b.count)} fish` : null, b.weight_g ? `${fmt(b.weight_g)} g` : null, b.status]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </fieldset>
                ))}
              </div>
            )}
          </FormSection>
        )}

        {step === 1 && (
          <FormSection title="Spawning">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Field label="Date" htmlFor="s-date" required>
                <Input id="s-date" type="date" value={form.spawnDate} onChange={set('spawnDate')} />
              </Field>
              <Field label="Method" htmlFor="s-method">
                <Select id="s-method" value={form.method} onChange={set('method')}>
                  {Object.entries(METHOD_LABEL).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.method !== 'natural' && (
                <>
                  <Field label="Hormone" htmlFor="s-h" required={form.method === 'induced'} hint="Ovaprim, hCG, carp pituitary…">
                    <Input id="s-h" value={form.hormone} onChange={set('hormone')} />
                  </Field>
                  <Field label="Dose" htmlFor="s-d" hint="For example 0.5 ml/kg">
                    <Input id="s-d" value={form.hormoneDose} onChange={set('hormoneDose')} />
                  </Field>
                </>
              )}
              <Field label="Spawning tank" htmlFor="s-u">
                <Select id="s-u" value={form.unitId} onChange={set('unitId')}>
                  <option value="">Not recorded</option>
                  {(units || []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notes" htmlFor="s-n" className="md:col-span-2">
                <Textarea id="s-n" rows={2} value={form.notes} onChange={set('notes')} />
              </Field>
            </div>
          </FormSection>
        )}

        {step === 2 && (
          <FormSection title="Egg collection" description="Leave blank if the eggs are counted later.">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <Field label="Eggs collected" htmlFor="s-e">
                <Input id="s-e" type="number" inputMode="numeric" value={form.eggsCollected} onChange={set('eggsCollected')} className="tabular-nums" />
              </Field>
              <Field label="Egg weight (g)" htmlFor="s-ew">
                <Input id="s-ew" type="number" inputMode="decimal" value={form.eggWeightG} onChange={set('eggWeightG')} className="tabular-nums" />
              </Field>
              <Field label="Fertilization (%)" htmlFor="s-f">
                <Input id="s-f" type="number" inputMode="decimal" value={form.fertilizationPct} onChange={set('fertilizationPct')} className="tabular-nums" />
              </Field>
            </div>
          </FormSection>
        )}

        {step === 3 && (
          <FormSection
            title="Incubation"
            description={
              num(form.eggsCollected)
                ? `${fmt(eggsInLots)} of ${fmt(num(form.eggsCollected))} eggs placed.`
                : 'Put the eggs in one or more incubators, or skip and do it from the overview later.'
            }
          >
            <div className="space-y-4">
              {lots.map((l, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <Field label="Incubator" htmlFor={`l-u-${i}`}>
                    <Select
                      id={`l-u-${i}`}
                      value={l.unitId}
                      onChange={(e) => setLots((p) => p.map((x, j) => (j === i ? { ...x, unitId: e.target.value } : x)))}
                    >
                      <option value="">Choose…</option>
                      {incubators.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Eggs" htmlFor={`l-e-${i}`}>
                    <Input
                      id={`l-e-${i}`}
                      type="number"
                      inputMode="numeric"
                      value={l.eggs}
                      onChange={(e) => setLots((p) => p.map((x, j) => (j === i ? { ...x, eggs: e.target.value } : x)))}
                      className="tabular-nums"
                    />
                  </Field>
                  <Field label="Water °C" htmlFor={`l-t-${i}`}>
                    <Input
                      id={`l-t-${i}`}
                      type="number"
                      inputMode="decimal"
                      value={l.temperatureC}
                      onChange={(e) => setLots((p) => p.map((x, j) => (j === i ? { ...x, temperatureC: e.target.value } : x)))}
                    />
                  </Field>
                </div>
              ))}
              {lots.length < 10 && (
                <Button variant="ghost" size="sm" onClick={() => setLots((p) => [...p, { unitId: '', eggs: '', temperatureC: '' }])}>
                  Add incubator
                </Button>
              )}
            </div>
          </FormSection>
        )}

        <StickyActions>
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canNext}>
              Next
            </Button>
          ) : (
            <Button onClick={submit} disabled={saving || !females.length}>
              {saving ? 'Saving…' : 'Save spawning'}
            </Button>
          )}
        </StickyActions>
      </FormCard>
    </div>
  )
}
