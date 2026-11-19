import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery } from 'convex/react'
import { Plus } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { Field, GhostButton, GradientButton, IfPermitted, Input, KpiStrip, Modal, Select, Table, Textarea } from '../../../components/ui'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../components/Toast'
import { errorMessage } from '../../../lib/errorMessage'
import { formatDate } from '../../../lib/format'
import { useLocale, useT } from '../../../lib/i18n/context'
import {
  HatcheryNav,
  ORIGIN_LABEL,
  Pill,
  SEX_LABEL,
  STATUS_LABEL,
  fmt,
  label,
  num,
  statusTone,
} from '../../../components/hatchery/common'

const EMPTY = {
  kind: 'individual',
  code: '',
  pitTag: '',
  sex: 'female',
  count: '',
  weightG: '',
  lengthCm: '',
  speciesCode: '',
  strain: '',
  origin: 'farm',
  originNote: '',
  unitId: '',
  acquiredOn: '',
  conditioning: false,
  notes: '',
}

export default function BroodstockPage() {
  return (
    <ProtectedRoute>
      <Broodstock />
    </ProtectedRoute>
  )
}

function AddBroodstockModal({ units, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const create = useMutation(api.hatchery.createBroodstock)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const group = form.kind === 'group'

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await create({
        kind: form.kind,
        code: form.code,
        pitTag: form.pitTag || undefined,
        sex: form.sex,
        count: group ? num(form.count) : undefined,
        weightG: num(form.weightG),
        lengthCm: num(form.lengthCm),
        speciesCode: form.speciesCode || undefined,
        strain: form.strain || undefined,
        origin: form.origin,
        originNote: form.originNote || undefined,
        unitId: form.unitId || undefined,
        acquiredOn: form.acquiredOn || undefined,
        status: form.conditioning ? 'conditioning' : undefined,
        conditioningStartedOn: form.conditioning ? new Date().toISOString().slice(0, 10) : undefined,
        notes: form.notes || undefined,
      })
      showToast('success', t('hatcheryPage.brood.added', { code: form.code }))
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('hatcheryPage.brood.addFailed')))
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
      size="lg"
      title={t('hatcheryPage.brood.newTitle')}
      description={t('hatcheryPage.brood.newHint')}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>{t('common.cancel')}</GhostButton>
          <GradientButton type="submit" variant="solid" size="sm" disabled={saving}>
            {saving ? t('common.saving') : t('hatcheryPage.brood.add')}
          </GradientButton>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('hatcheryPage.brood.record')} htmlFor="b-kind">
          <Select id="b-kind" value={form.kind} onChange={set('kind')}>
            <option value="individual">{t('hatcheryPage.brood.individual')}</option>
            <option value="group">{t('hatcheryPage.brood.group')}</option>
          </Select>
        </Field>
        <Field label={group ? t('hatcheryPage.brood.groupName') : t('hatcheryPage.brood.tag')} htmlFor="b-code" required>
          <Input id="b-code" value={form.code} onChange={set('code')} placeholder={group ? 'F-GROUP-A' : 'F-001'} />
        </Field>
        <Field label={t('hatcheryPage.brood.sex')} htmlFor="b-sex">
          <Select id="b-sex" value={form.sex} onChange={set('sex')}>
            {Object.keys(SEX_LABEL)
              .filter((k) => group || k !== 'mixed')
              .map((k) => (
                <option key={k} value={k}>{label(t, 'sex', k)}</option>
              ))}
          </Select>
        </Field>
        {group ? (
          <Field label={t('hatcheryPage.brood.fishInGroup')} htmlFor="b-count" required>
            <Input id="b-count" type="number" inputMode="numeric" value={form.count} onChange={set('count')} />
          </Field>
        ) : (
          <Field label={t('hatcheryPage.brood.pitTag')} htmlFor="b-pit">
            <Input id="b-pit" value={form.pitTag} onChange={set('pitTag')} />
          </Field>
        )}
        <Field label={group ? t('hatcheryPage.brood.meanWeight') : t('hatcheryPage.brood.weight')} htmlFor="b-w">
          <Input id="b-w" type="number" inputMode="decimal" value={form.weightG} onChange={set('weightG')} />
        </Field>
        <Field label={t('hatcheryPage.brood.length')} htmlFor="b-l">
          <Input id="b-l" type="number" inputMode="decimal" value={form.lengthCm} onChange={set('lengthCm')} />
        </Field>
        <Field label={t('hatcheryPage.brood.species')} htmlFor="b-sp">
          <Input id="b-sp" value={form.speciesCode} onChange={set('speciesCode')} placeholder="tilapia" />
        </Field>
        <Field label={t('hatcheryPage.brood.strain')} htmlFor="b-st">
          <Input id="b-st" value={form.strain} onChange={set('strain')} />
        </Field>
        <Field label={t('hatcheryPage.brood.origin')} htmlFor="b-o">
          <Select id="b-o" value={form.origin} onChange={set('origin')}>
            {Object.keys(ORIGIN_LABEL).map((k) => (
              <option key={k} value={k}>{label(t, 'origin', k)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('hatcheryPage.brood.source')} htmlFor="b-on" hint={t('hatcheryPage.brood.sourceHint')}>
          <Input id="b-on" value={form.originNote} onChange={set('originNote')} />
        </Field>
        <Field label={t('hatcheryPage.brood.tank')} htmlFor="b-u">
          <Select id="b-u" value={form.unitId} onChange={set('unitId')}>
            <option value="">{t('hatcheryPage.brood.notAssigned')}</option>
            {(units || []).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('hatcheryPage.brood.acquiredOn')} htmlFor="b-a">
          <Input id="b-a" type="date" value={form.acquiredOn} onChange={set('acquiredOn')} />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-[14px] leading-[18px] text-text sm:col-span-2">
          <input type="checkbox" checked={form.conditioning} onChange={set('conditioning')} className="size-4 accent-[var(--cyan)]" />
          {t('hatcheryPage.brood.conditionToday')}
        </label>
        <Field label={t('common.notes')} htmlFor="b-n" className="sm:col-span-2">
          <Textarea id="b-n" rows={2} value={form.notes} onChange={set('notes')} />
        </Field>
      </div>
    </Modal>
  )
}

function Broodstock() {
  const t = useT()
  const { locale } = useLocale()
  const router = useRouter()
  const { user } = useAuth()
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const rows = useQuery(api.hatchery.listBroodstock, user ? (status ? { status } : {}) : 'skip')
  const units = useQuery(api.nursery.nurseryUnits, user ? {} : 'skip')
  const [showForm, setShowForm] = useState(false)

  const list = rows || []
  const q = search.trim().toLowerCase()
  const shown = q ? list.filter((b) => [b.code, b.unit_name, b.strain].some((v) => v && String(v).toLowerCase().includes(q))) : list
  const count = (st) => list.filter((b) => b.status === st).reduce((s, b) => s + b.count, 0)

  return (
    <Layout
      title={t('hatcheryPage.brood.title')}
      eyebrow={t('hatcheryPage.brood.eyebrow')}
      actions={
        <IfPermitted permission="hatchery.broodstock.manage">
          <GradientButton icon={Plus} onClick={() => setShowForm(true)}>
            {t('hatcheryPage.brood.add')}
          </GradientButton>
        </IfPermitted>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <HatcheryNav />

        <KpiStrip
          items={[
            { key: 'fish', label: t('hatcheryPage.brood.kpiFish'), value: fmt(list.reduce((s, b) => s + b.count, 0)), suffix: t('hatcheryPage.brood.records', { count: list.length }) },
            { key: 'ready', label: label(t, 'status', 'ready'), value: fmt(count('ready')), valueTone: 'good' },
            { key: 'conditioning', label: label(t, 'status', 'conditioning'), value: fmt(count('conditioning')) },
            { key: 'resting', label: label(t, 'status', 'resting'), value: fmt(count('resting')) },
          ]}
        />

        <Table
          title={t('hatcheryPage.brood.listTitle')}
          tabsLabel={t('hatcheryPage.brood.statusFilter')}
          tabs={[{ value: '', label: t('hatcheryPage.all') }, ...Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: label(t, 'status', k) }))]}
          tab={status}
          onTabChange={setStatus}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('hatcheryPage.brood.search')}
          rows={shown}
          rowKey={(b) => b.id}
          onRowClick={(b) => router.push(`/hatchery/broodstock/${b.id}`)}
          empty={rows === undefined ? t('hatcheryPage.brood.loading') : t('hatcheryPage.brood.empty')}
          columns={[
            {
              key: 'code',
              header: t('hatcheryPage.brood.tag'),
              render: (b) => (
                <Link href={`/hatchery/broodstock/${b.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-text hover:text-pearl-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                  {b.code}
                </Link>
              ),
              sub: (b) => (b.kind === 'group' ? t('hatcheryPage.brood.group') : b.pit_tag || null),
            },
            { key: 'sex', header: t('hatcheryPage.brood.sex'), render: (b) => label(t, 'sex', b.sex) },
            { key: 'count', header: t('hatcheryPage.brood.fish'), align: 'right', render: (b) => fmt(b.count) },
            { key: 'weight', header: t('hatcheryPage.brood.weight'), align: 'right', render: (b) => (b.weight_g ? fmt(b.weight_g) : '—') },
            { key: 'tank', header: t('hatcheryPage.brood.tank'), render: (b) => b.unit_name || '—' },
            {
              key: 'spawned',
              header: t('hatcheryPage.brood.lastSpawned'),
              render: (b) => (b.last_spawned_on ? formatDate(b.last_spawned_on, { locale }) : <span className="text-muted">{t('hatcheryPage.brood.notSpawned')}</span>),
            },
            { key: 'status', header: t('hatcheryPage.brood.status'), render: (b) => <Pill tone={statusTone(b.status)}>{label(t, 'status', b.status)}</Pill> },
          ]}
        />

        {showForm && <AddBroodstockModal units={units} onClose={() => setShowForm(false)} />}
      </div>
    </Layout>
  )
}
