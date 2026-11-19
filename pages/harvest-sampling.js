import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import Link from 'next/link'
import Layout from '../components/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import { Field, GhostButton, GradientButton, Input, KpiStrip, LoadingState, Select } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g+' },
  { category: 'S2', range: '700–800g' },
  { category: 'S1', range: '600–700g' },
  { category: 'Reg', range: '500–600g' },
  { category: 'Eco', range: '400–500g' },
  { category: 'SS', range: '300–400g' },
  { category: 'SB', range: '200–300g' },
  { category: 'Rej', range: '<200g' },
]

const NO_CAGES = []
const emptySizes = () => SIZE_CATEGORIES.reduce((acc, s) => ({ ...acc, [s.category]: '' }), {})
const CARD = 'rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]'

function Section({ title, description, children }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 border-b border-line pb-3">
        <h2 className="text-[15px] font-semibold leading-[18px] text-text">{title}</h2>
        {description && <p className="text-[13px] leading-[18px] text-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function HarvestSampling() {
  const t = useT()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const cagesResult = useQuery(api.cages.getActive, user ? locationArgs : 'skip')
  const cages = cagesResult ?? NO_CAGES
  const loading = cagesResult === undefined
  const createFromSampling = useMutation(api.harvest.createFromSampling)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [form, setForm] = useState({ cageId: '', date: localToday(), weight: '', fishCount: '', sizes: emptySizes() })
  const [doc, setDoc] = useState('')
  const [abw, setAbw] = useState('')

  useEffect(() => {
    const cage = cages.find((c) => (c.id || c._id) === form.cageId)
    if (cage?.stocking_date && form.date) {
      const days = Math.floor((new Date(form.date) - new Date(cage.stocking_date)) / (1000 * 60 * 60 * 24))
      setDoc(String(Math.max(0, days)))
    } else {
      setDoc('')
    }
    const w = parseFloat(form.weight)
    const n = parseInt(form.fishCount, 10)
    // Grams, like every other ABW in the app (weight is in kg).
    if (w > 0 && n > 0) setAbw(((w * 1000) / n).toFixed(1))
    else setAbw('')
  }, [form.cageId, form.date, form.weight, form.fishCount, cages])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved('')
    try {
      const sizes = {}
      for (const [k, v] of Object.entries(form.sizes)) {
        if (v !== '' && v != null) sizes[k] = Number(v)
      }
      await createFromSampling({
        cageId: form.cageId,
        date: form.date,
        weight: Number(form.weight),
        fishCount: Number(form.fishCount),
        sizes,
        doc: doc ? Number(doc) : undefined,
        abw: abw ? Number(abw) : undefined,
      })
      // A sample is not a harvest: stay here so more samples can be entered.
      const cageName = cages.find((c) => (c.id || c._id) === form.cageId)?.name || t('harvestPage.samplingPage.theCage')
      setSaved(t('harvestPage.samplingPage.saved', { cage: cageName }))
      setForm((f) => ({ ...f, weight: '', fishCount: '', sizes: emptySizes() }))
    } catch (err) {
      setError(errorMessage(err, t('harvestPage.samplingPage.failed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex w-full max-w-[960px] flex-col gap-[28px]">
      <p className="max-w-[720px] text-[14px] leading-5 text-muted">{t('harvestPage.samplingPage.intro')}</p>

      {saved && (
        <div role="status" className="rounded-input border border-[var(--pill-green-border)] px-4 py-3 text-[14px] leading-5 text-text">
          {saved}{' '}
          <Link href="/harvest" className="rounded font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
            {t('harvestPage.samplingPage.goToHarvest')}
          </Link>
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-input border border-[var(--pill-red-border)] px-4 py-3 text-[14px] leading-5 text-alert">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingState label={t('harvestPage.samplingPage.loadingCages')} />
      ) : (
        <form onSubmit={handleSubmit} className={`${CARD} flex flex-col gap-8`}>
          <Section title={t('harvestPage.samplingPage.cageAndSample')}>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label={t('harvestPage.samplingPage.cage')} htmlFor="cageId" required>
                <Select id="cageId" required value={form.cageId} onChange={set('cageId')}>
                  <option value="">{t('harvestPage.samplingPage.selectCage')}</option>
                  {cages.map((c) => (
                    <option key={c.id || c._id} value={c.id || c._id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('harvestPage.samplingPage.date')} htmlFor="date" required>
                <Input id="date" type="date" required value={form.date} onChange={set('date')} />
              </Field>
              <Field label={t('harvestPage.samplingPage.weight')} htmlFor="weight" required>
                <Input id="weight" type="number" step="0.01" min="0" inputMode="decimal" required value={form.weight} onChange={set('weight')} />
              </Field>
              <Field label={t('harvestPage.samplingPage.fishCount')} htmlFor="fishCount" required>
                <Input id="fishCount" type="number" min="0" inputMode="numeric" required value={form.fishCount} onChange={set('fishCount')} />
              </Field>
            </div>
            <KpiStrip
              className="rounded-input border border-line px-4 py-3"
              items={[
                { key: 'doc', label: t('harvestPage.samplingPage.doc'), value: doc || '—', suffix: doc ? t('harvestPage.samplingPage.days') : null },
                { key: 'abw', label: t('harvestPage.samplingPage.abw'), value: abw ? `${abw} g` : '—' },
              ]}
            />
          </Section>

          <Section title={t('harvestPage.samplingPage.sizeBreakdown')} description={t('harvestPage.samplingPage.sizeHint')}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {SIZE_CATEGORIES.map((s) => (
                <Field key={s.category} label={s.category} htmlFor={`size-${s.category}`} hint={s.range}>
                  <Input
                    id={`size-${s.category}`}
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={form.sizes[s.category]}
                    onChange={(e) => setForm((f) => ({ ...f, sizes: { ...f.sizes, [s.category]: e.target.value } }))}
                  />
                </Field>
              ))}
            </div>
          </Section>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <GradientButton type="submit" variant="solid" disabled={saving}>
              {saving ? t('common.saving') : t('harvestPage.samplingPage.save')}
            </GradientButton>
            <GhostButton href="/harvest">{t('common.cancel')}</GhostButton>
          </div>
        </form>
      )}
    </div>
  )
}

export default function HarvestSamplingPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout title={t('harvestPage.samplingPage.title')} eyebrow={t('harvestPage.samplingPage.eyebrow')}>
        <HarvestSampling />
      </Layout>
    </ProtectedRoute>
  )
}
