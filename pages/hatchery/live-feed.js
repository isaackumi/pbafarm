import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, StatCard } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { errorMessage } from '../../lib/errorMessage'
import { HatcheryNav, LIVE_FEED_LABEL, LIVE_FEED_UNIT, fmt, num, today } from '../../components/hatchery/common'

const MOVEMENT_LABEL = { produced: 'Produced', used: 'Used', discarded: 'Discarded' }

export default function LiveFeedPage() {
  return (
    <ProtectedRoute>
      <Layout title="Live feed">
        <LiveFeed />
      </Layout>
    </ProtectedRoute>
  )
}

function LiveFeed() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const data = useQuery(api.nursery.liveFeed, user ? {} : 'skip')
  const record = useMutation(api.nursery.recordLiveFeed)
  const remove = useMutation(api.nursery.removeLiveFeed)
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
      showToast('success', 'Saved')
      setForm((p) => ({ ...p, quantity: '', inputNote: '' }))
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const del = async (id) => {
    try {
      await remove({ id })
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not remove'))
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Live feed"
        description="Artemia, rotifer and algae cultures: what was produced, fed and thrown away. Feed recorded on a larval log is counted here."
      />
      <HatcheryNav />

      {data?.balances?.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {data.balances.map((b) => (
            <StatCard
              key={`${b.kind}-${b.unit}`}
              label={`${LIVE_FEED_LABEL[b.kind]} on hand`}
              value={fmt(b.on_hand, 2)}
              unit={LIVE_FEED_UNIT[b.unit]}
              hint={`${fmt(b.produced, 2)} produced · ${fmt(b.used, 2)} used`}
              tone={b.on_hand < 0 ? 'warn' : 'default'}
            />
          ))}
        </div>
      )}

      <Card className="mb-6">
        <form onSubmit={submit} noValidate className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <Field label="Date" htmlFor="lf-date">
            <Input id="lf-date" type="date" value={form.date} onChange={set('date')} />
          </Field>
          <Field label="Feed" htmlFor="lf-kind">
            <Select id="lf-kind" value={form.kind} onChange={set('kind')}>
              {Object.entries(LIVE_FEED_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Entry" htmlFor="lf-mv">
            <Select id="lf-mv" value={form.movement} onChange={set('movement')}>
              {Object.entries(MOVEMENT_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <Field label="Amount" htmlFor="lf-q">
              <Input id="lf-q" type="number" inputMode="decimal" step="any" value={form.quantity} onChange={set('quantity')} />
            </Field>
            <Select aria-label="Unit" value={form.unit} onChange={set('unit')} className="w-24">
              {Object.entries(LIVE_FEED_UNIT).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
          <Field label="Culture" htmlFor="lf-c" hint="Tank or cone">
            <Input id="lf-c" value={form.culture} onChange={set('culture')} />
          </Field>
          <Field label="Inputs" htmlFor="lf-i" hint="Cysts, algae paste, enrichment" className="lg:col-span-2">
            <Input id="lf-i" value={form.inputNote} onChange={set('inputNote')} />
          </Field>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </Card>

      <Card padding={false}>
        <div className="p-5 sm:p-6 pb-0 sm:pb-0">
          <CardHeader title="Entries" />
        </div>
        {data === undefined ? (
          <p className="p-6 text-sm text-muted">Loading…</p>
        ) : data.entries.length === 0 ? (
          <EmptyState title="No live feed entries" description="Record a culture harvest to start the balance." />
        ) : (
          <ul className="divide-y divide-foam-deep">
            {data.entries.map((e) => (
              <li key={e.id} className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-chart-ink">
                    {e.date} · {MOVEMENT_LABEL[e.movement]} {fmt(e.quantity, 2)} {LIVE_FEED_UNIT[e.unit]} {LIVE_FEED_LABEL[e.kind].toLowerCase()}
                  </p>
                  <p className="text-sm text-muted">{[e.culture, e.input_note].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {!e.from_larval_log && (
                  <Button size="sm" variant="ghost" onClick={() => del(e.id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
