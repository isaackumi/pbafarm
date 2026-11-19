import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { EmptyState, Field, GhostButton, GradientButton, Input, Select, Textarea } from '../../components/ui'
import { useT } from '../../lib/i18n/context'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { newClientMutationId } from '../../lib/offlineOutbox'
import { HatcheryNav, METHOD_LABEL, PaperCard, fmt, label, num, today } from '../../components/hatchery/common'

const STEPS = ['broodstock', 'spawning', 'eggs', 'incubation']

export default function SpawningPage() {
  return (
    <ProtectedRoute permission="hatchery.spawning.record">
      <SpawningWizard />
    </ProtectedRoute>
  )
}

function SpawningWizard() {
  const t = useT()
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
  const eggsInLots = lots.reduce((sum, l) => sum + (num(l.eggs) || 0), 0)

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
        toIncubate.length ? t('hatcheryPage.spawn.savedLots', { count: toIncubate.length }) : t('hatcheryPage.spawn.saved'),
      )
      router.push('/hatchery')
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.spawn.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const setLot = (i, k) => (e) => setLots((p) => p.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))

  return (
    <Layout title={t('hatcheryPage.spawn.title')} eyebrow={t('hatcheryPage.spawn.eyebrow')}>
      <HatcheryNav />

      <ol className="flex flex-wrap gap-2" aria-label={t('hatcheryPage.spawn.steps')}>
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              disabled={i > step}
              className={`inline-flex min-h-11 items-center gap-2 rounded-pill border px-4 text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                i === step
                  ? 'border-pearl-cyan font-semibold text-text'
                  : i < step
                    ? 'border-line-strong text-text'
                    : 'border-line text-faint'
              }`}
            >
              <span className="font-mono tabular-nums">{i + 1}</span> {t(`hatcheryPage.spawn.step.${s}`)}
            </button>
          </li>
        ))}
      </ol>

      <div className="max-w-4xl">
        {step === 0 && (
          <PaperCard title={t('hatcheryPage.spawn.step.broodstock')} meta={t('hatcheryPage.spawn.broodHint')}>
            {broodstock === undefined ? (
              <p className="text-[14px] leading-[18px] text-muted">{t('ui.loading')}</p>
            ) : available.length === 0 ? (
              <EmptyState
                title={t('hatcheryPage.spawn.noBrood')}
                description={t('hatcheryPage.spawn.noBroodHint')}
                action={<GhostButton href="/hatchery/broodstock">{t('hatcheryPage.brood.add')}</GhostButton>}
              />
            ) : (
              <div className="grid gap-6 md:grid-cols-2">
                {[
                  ['females', females, setFemales, (b) => b.sex !== 'male', males],
                  ['males', males, setMales, (b) => b.sex !== 'female', females],
                ].map(([key, list, setList, fits, other]) => (
                  <fieldset key={key}>
                    <legend className="mb-2 text-[13px] font-semibold leading-4 text-text">
                      {t(`hatcheryPage.spawn.${key}`)}{' '}
                      <span className="font-normal text-muted">{t('hatcheryPage.spawn.chosen', { n: list.length })}</span>
                    </legend>
                    <ul className="flex max-h-80 flex-col overflow-y-auto">
                      {available.filter(fits).map((b) => (
                        <li key={b.id} className="border-t border-line">
                          <label className="flex min-h-11 cursor-pointer items-center gap-3 px-1 hover:bg-surface-2">
                            <input
                              type="checkbox"
                              className="size-4 accent-[var(--cyan)]"
                              checked={list.includes(b.id)}
                              disabled={other.includes(b.id)}
                              onChange={() => toggle(list, setList, b.id)}
                            />
                            <span className="font-mono text-[13px] text-text">{b.code}</span>
                            <span className="text-xs leading-4 text-muted">
                              {[
                                label(t, 'sex', b.sex),
                                b.kind === 'group' ? t('hatcheryPage.fishN', { n: fmt(b.count) }) : null,
                                b.weight_g ? `${fmt(b.weight_g)} g` : null,
                                label(t, 'status', b.status),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                ))}
              </div>
            )}
          </PaperCard>
        )}

        {step === 1 && (
          <PaperCard title={t('hatcheryPage.spawn.step.spawning')}>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label={t('hatcheryPage.date')} htmlFor="s-date" required>
                <Input id="s-date" type="date" value={form.spawnDate} onChange={set('spawnDate')} />
              </Field>
              <Field label={t('hatcheryPage.spawn.method')} htmlFor="s-method">
                <Select id="s-method" value={form.method} onChange={set('method')}>
                  {Object.keys(METHOD_LABEL).map((k) => (
                    <option key={k} value={k}>{label(t, 'method', k)}</option>
                  ))}
                </Select>
              </Field>
              {form.method !== 'natural' && (
                <>
                  <Field label={t('hatcheryPage.spawn.hormone')} htmlFor="s-h" required={form.method === 'induced'} hint={t('hatcheryPage.spawn.hormoneHint')}>
                    <Input id="s-h" value={form.hormone} onChange={set('hormone')} />
                  </Field>
                  <Field label={t('hatcheryPage.spawn.dose')} htmlFor="s-d" hint={t('hatcheryPage.spawn.doseHint')}>
                    <Input id="s-d" value={form.hormoneDose} onChange={set('hormoneDose')} />
                  </Field>
                </>
              )}
              <Field label={t('hatcheryPage.spawn.tank')} htmlFor="s-u">
                <Select id="s-u" value={form.unitId} onChange={set('unitId')}>
                  <option value="">{t('hatcheryPage.spawn.notRecorded')}</option>
                  {(units || []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('common.notes')} htmlFor="s-n" className="md:col-span-2">
                <Textarea id="s-n" rows={2} value={form.notes} onChange={set('notes')} />
              </Field>
            </div>
          </PaperCard>
        )}

        {step === 2 && (
          <PaperCard title={t('hatcheryPage.spawn.eggCollection')} meta={t('hatcheryPage.spawn.eggHint')}>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <Field label={t('hatcheryPage.kpi.eggsCollected')} htmlFor="s-e">
                <Input id="s-e" type="number" inputMode="numeric" value={form.eggsCollected} onChange={set('eggsCollected')} className="tabular-nums" />
              </Field>
              <Field label={t('hatcheryPage.spawn.eggWeight')} htmlFor="s-ew">
                <Input id="s-ew" type="number" inputMode="decimal" value={form.eggWeightG} onChange={set('eggWeightG')} className="tabular-nums" />
              </Field>
              <Field label={t('hatcheryPage.spawn.fertilization')} htmlFor="s-f">
                <Input id="s-f" type="number" inputMode="decimal" value={form.fertilizationPct} onChange={set('fertilizationPct')} className="tabular-nums" />
              </Field>
            </div>
          </PaperCard>
        )}

        {step === 3 && (
          <PaperCard
            title={t('hatcheryPage.spawn.step.incubation')}
            meta={
              num(form.eggsCollected)
                ? t('hatcheryPage.spawn.placed', { placed: fmt(eggsInLots), total: fmt(num(form.eggsCollected)) })
                : t('hatcheryPage.spawn.incubationHint')
            }
          >
            <div className="flex flex-col gap-4">
              {lots.map((l, i) => (
                <div key={i} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
                  <Field label={t('hatcheryPage.spawn.incubator')} htmlFor={`l-u-${i}`}>
                    <Select id={`l-u-${i}`} value={l.unitId} onChange={setLot(i, 'unitId')}>
                      <option value="">{t('hatcheryPage.choose')}</option>
                      {incubators.map((u) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('hatcheryPage.spawn.eggs')} htmlFor={`l-e-${i}`}>
                    <Input id={`l-e-${i}`} type="number" inputMode="numeric" value={l.eggs} onChange={setLot(i, 'eggs')} className="tabular-nums" />
                  </Field>
                  <Field label={t('hatcheryPage.spawn.waterC')} htmlFor={`l-t-${i}`}>
                    <Input id={`l-t-${i}`} type="number" inputMode="decimal" value={l.temperatureC} onChange={setLot(i, 'temperatureC')} />
                  </Field>
                </div>
              ))}
              {lots.length < 10 && (
                <div>
                  <GhostButton
                    size="sm"
                    icon={Plus}
                    onClick={() => setLots((p) => [...p, { unitId: '', eggs: '', temperatureC: '' }])}
                  >
                    {t('hatcheryPage.spawn.addIncubator')}
                  </GhostButton>
                </div>
              )}
            </div>
          </PaperCard>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {step > 0 && <GhostButton onClick={() => setStep(step - 1)}>{t('hatcheryPage.spawn.back')}</GhostButton>}
          {step < STEPS.length - 1 ? (
            <GradientButton variant="solid" onClick={() => setStep(step + 1)} disabled={!canNext}>
              {t('hatcheryPage.spawn.next')}
            </GradientButton>
          ) : (
            <GradientButton variant="solid" onClick={submit} disabled={saving || !females.length}>
              {saving ? t('common.saving') : t('hatcheryPage.spawn.save')}
            </GradientButton>
          )}
        </div>
      </div>
    </Layout>
  )
}
