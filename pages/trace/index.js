import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Field, GhostButton, GradientButton, IfPermitted, Input, KpiStrip, Modal, Pill, Select, Table, Textarea } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { formatDate, formatNumber } from '../../lib/format'
import { useLocale, useT } from '../../lib/i18n/context'

const EMPTY = { harvestId: '', weightKg: '', fishCount: '', grade: '', destination: '', lotCode: '', notes: '' }
const TABS = ['all', 'open', 'dispatched']

export default function HarvestLotsPage() {
  return (
    <ProtectedRoute>
      <HarvestLots />
    </ProtectedRoute>
  )
}

function NewLotModal({ open, onClose }) {
  const t = useT()
  const { locale } = useLocale()
  const { showToast } = useToast()
  const createLot = useMutation(api.traceability.createLot)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const selected = open.find((h) => h.id === form.harvestId) || null
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const kg = (v) => formatNumber(v, { locale, decimals: 1 })

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (!form.harvestId) throw new Error(t('tracePage.newLot.pickHarvest'))
      const weightKg = Number(form.weightKg || selected?.left)
      if (!(weightKg > 0)) throw new Error(t('tracePage.newLot.enterWeight'))
      const res = await createLot({
        harvestId: form.harvestId,
        weightKg,
        fishCount: form.fishCount ? Number(form.fishCount) : undefined,
        grade: form.grade.trim() || undefined,
        destination: form.destination.trim() || undefined,
        lotCode: form.lotCode.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })
      showToast('success', t('tracePage.newLot.created', { code: res.lotCode }))
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('tracePage.newLot.failed')))
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
      title={t('tracePage.newLot.title')}
      description={t('tracePage.newLot.description')}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('tracePage.newLot.submit')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('tracePage.newLot.harvest')} htmlFor="lot-harvest" required className="sm:col-span-2">
          <Select id="lot-harvest" value={form.harvestId} onChange={set('harvestId')}>
            <option value="">{t('tracePage.newLot.selectHarvest')}</option>
            {open.map((h) => (
              <option key={h.id} value={h.id}>
                {t('tracePage.newLot.harvestOption', { date: formatDate(h.harvest_date, { locale }), cage: h.cage?.name || '—', kg: kg(h.left) })}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('tracePage.newLot.weight')} htmlFor="lot-weight" required hint={selected ? t('tracePage.newLot.upTo', { kg: kg(selected.left) }) : undefined}>
          <Input
            id="lot-weight"
            type="number"
            step="0.1"
            inputMode="decimal"
            value={form.weightKg}
            placeholder={selected ? String(Math.round(selected.left * 10) / 10) : ''}
            onChange={set('weightKg')}
            className="tabular-nums"
          />
        </Field>
        <Field label={t('tracePage.newLot.fishCount')} htmlFor="lot-count">
          <Input id="lot-count" type="number" inputMode="numeric" value={form.fishCount} onChange={set('fishCount')} className="tabular-nums" />
        </Field>
        <Field label={t('tracePage.newLot.grade')} htmlFor="lot-grade" hint={t('tracePage.newLot.gradeHint')}>
          <Input id="lot-grade" value={form.grade} onChange={set('grade')} />
        </Field>
        <Field label={t('tracePage.newLot.destination')} htmlFor="lot-destination" hint={t('tracePage.newLot.destinationHint')}>
          <Input id="lot-destination" value={form.destination} onChange={set('destination')} />
        </Field>
        <Field label={t('tracePage.newLot.code')} htmlFor="lot-code" hint={t('tracePage.newLot.codeHint')}>
          <Input id="lot-code" value={form.lotCode} onChange={set('lotCode')} placeholder={t('tracePage.newLot.automatic')} />
        </Field>
        <Field label={t('common.notes')} htmlFor="lot-notes" className="sm:col-span-2">
          <Textarea id="lot-notes" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

function HarvestLots() {
  const t = useT()
  const { locale } = useLocale()
  const router = useRouter()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const lots = useQuery(api.traceability.listLots, user ? {} : 'skip')
  const harvests = useQuery(api.harvest.list, user ? locationArgs : 'skip')
  const [showForm, setShowForm] = useState(false)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')

  // Weight of each harvest already put into lots.
  const lotted = useMemo(() => {
    const m = new Map()
    for (const l of lots || []) m.set(l.harvest_id, (m.get(l.harvest_id) || 0) + l.weight_kg)
    return m
  }, [lots])
  const open = useMemo(
    () =>
      (harvests || [])
        .filter((h) => h.source !== 'sampling_page')
        .map((h) => ({ ...h, left: Math.max(0, h.total_weight - (lotted.get(h.id) || 0)) }))
        .filter((h) => h.left > 0.05)
        .slice(0, 100),
    [harvests, lotted],
  )

  const all = lots || []
  const inStock = all.reduce((s, l) => s + l.remaining_kg, 0)
  const sent = all.reduce((s, l) => s + l.dispatched_kg, 0)
  const openCount = all.filter((l) => l.remaining_kg > 0).length
  const q = search.trim().toLowerCase()
  const rows = all.filter(
    (l) =>
      (tab === 'all' || (tab === 'open' ? l.remaining_kg > 0 : l.remaining_kg <= 0)) &&
      (!q || [l.lot_code, l.cage_name, l.grade, l.destination].some((v) => v && v.toLowerCase().includes(q))),
  )
  const kg = (v) => `${formatNumber(v, { locale, decimals: 1 })} kg`

  return (
    <Layout
      title={t('tracePage.lotsTitle')}
      eyebrow={t('tracePage.eyebrowLots')}
      actions={
        <IfPermitted permission="production.harvest.record">
          <GradientButton icon={Plus} onClick={() => setShowForm(true)} disabled={!open.length}>
            {t('tracePage.newLot.action')}
          </GradientButton>
        </IfPermitted>
      }
    >
      <KpiStrip
        items={[
          { key: 'lots', label: t('tracePage.kpi.lots'), value: formatNumber(all.length, { locale }), suffix: t('tracePage.openCount', { count: openCount }) },
          { key: 'stock', label: t('tracePage.kpi.notDispatched'), value: kg(inStock) },
          { key: 'sent', label: t('tracePage.kpi.dispatched'), value: kg(sent) },
          { key: 'harvests', label: t('tracePage.kpi.unlotted'), value: formatNumber(open.length, { locale }), suffix: t('tracePage.harvestsSuffix') },
        ]}
      />

      <Table
        title={t('tracePage.lotsTable')}
        tabsLabel={t('tracePage.filter')}
        tabs={TABS.map((k) => ({ value: k, label: t(`tracePage.tab.${k}`) }))}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('tracePage.search')}
        rowKey={(l) => l.id}
        rows={rows}
        onRowClick={(l) => router.push(`/trace/${l.id}`)}
        empty={
          lots === undefined
            ? t('tracePage.loadingLots')
            : all.length === 0
              ? t('tracePage.emptyLots')
              : t('tracePage.noMatch')
        }
        columns={[
          {
            key: 'code',
            header: t('tracePage.col.lot'),
            render: (l) => (
              <Link href={`/trace/${l.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-text hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                {l.lot_code}
              </Link>
            ),
            sub: (l) => [l.grade && t('tracePage.grade', { grade: l.grade }), l.destination].filter(Boolean).join(' · ') || null,
          },
          { key: 'date', header: t('tracePage.col.harvested'), render: (l) => formatDate(l.harvest_date, { locale }) },
          { key: 'cage', header: t('tracePage.col.cage'), render: (l) => l.cage_name || '—' },
          { key: 'weight', header: t('tracePage.col.weight'), align: 'right', render: (l) => kg(l.weight_kg) },
          { key: 'dispatched', header: t('tracePage.col.dispatched'), align: 'right', render: (l) => kg(l.dispatched_kg) },
          {
            key: 'status',
            header: t('tracePage.col.status'),
            render: (l) =>
              l.remaining_kg > 0 ? (
                <Pill tone={l.dispatched_kg > 0 ? 'amber' : 'cyan'}>{l.dispatched_kg > 0 ? t('tracePage.status.partial') : t('tracePage.status.open')}</Pill>
              ) : (
                <Pill tone="green">{t('tracePage.status.dispatched')}</Pill>
              ),
          },
        ]}
      />

      {showForm && <NewLotModal open={open} onClose={() => setShowForm(false)} />}
    </Layout>
  )
}
