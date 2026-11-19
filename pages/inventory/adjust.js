import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import {
  Button,
  Segmented,
  Table,
  FormCard,
  Field,
  Input,
  Textarea,
} from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import FarmLocationSelect from '../../components/FarmLocationSelect'
import FeedTypeField from '../../components/FeedTypeField'
import NavTabs from '../../components/ui/NavTabs'
import { inventoryTabs } from '../../lib/sectionTabs'
import { formatDate, formatNumber } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

export default function InventoryAdjustPage() {
  return (
    <ProtectedRoute permission="inventory.adjust">
      <InventoryAdjust />
    </ProtectedRoute>
  )
}

function InventoryAdjust() {
  const t = useT()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { locations: farmLocations, activeLocationId, activeLocation } =
    useLocation()
  const feedTypes = useQuery(api.feed.listFeedTypes, user ? {} : 'skip')
  const lots = useQuery(api.inventory.listLots, user ? {} : 'skip')
  const createAdjustment = useMutation(api.inventory.createAdjustment)
  const createTransfer = useMutation(api.inventory.createTransfer)

  const [mode, setMode] = useState('adjust')
  const [feedTypeId, setFeedTypeId] = useState('')
  const [quantityKg, setQuantityKg] = useState('')
  const [notes, setNotes] = useState('')
  const [locationId, setLocationId] = useState('')
  const [fromLocationId, setFromLocationId] = useState('')
  const [toLocationId, setToLocationId] = useState('')
  const [batchNumber, setBatchNumber] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!activeLocationId) return
    setLocationId((prev) => prev || activeLocationId)
    setFromLocationId((prev) => prev || activeLocationId)
  }, [activeLocationId])

  const locationName = (id) =>
    (farmLocations || []).find((l) => (l.id || l._id) === id)?.name ||
    activeLocation?.name ||
    undefined

  const relevantLots = (lots || []).filter(
    (lot) => !feedTypeId || lot.feed_type_id === feedTypeId,
  )

  const submit = async (e) => {
    e.preventDefault()
    if (!feedTypeId) {
      showToast('error', 'Select a feed type')
      return
    }
    const qty = Number(quantityKg)
    if (!Number.isFinite(qty) || qty === 0) {
      showToast('error', 'Enter a non-zero quantity (kg)')
      return
    }

    setBusy(true)
    try {
      if (mode === 'adjust') {
        if (!notes.trim()) throw new Error('Reason is required')
        const locId = locationId || activeLocationId
        await createAdjustment({
          feedTypeId,
          quantityKg: qty,
          notes: notes.trim(),
          location: locationName(locId),
          locationId: locId || undefined,
          batchNumber: batchNumber || undefined,
        })
        showToast('success', 'Stock adjusted')
      } else {
        if (qty < 0) throw new Error('Transfer quantity must be positive')
        if (!fromLocationId || !toLocationId) {
          throw new Error('Select from and to farm locations')
        }
        await createTransfer({
          feedTypeId,
          quantityKg: Math.abs(qty),
          fromLocationId,
          toLocationId,
          notes: notes.trim() || undefined,
          batchNumber: batchNumber || undefined,
        })
        showToast('success', 'Stock transferred between locations')
      }
      setQuantityKg('')
      setNotes('')
      setBatchNumber('')
    } catch (err) {
      showToast('error', err.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title={t('ops.inventory.title')} eyebrow={t('ops.adjust.eyebrow')}>
      <div className="flex flex-col gap-[28px]">
      <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
      <p className="max-w-2xl text-sm text-muted">{t('ops.adjust.intro')}</p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <FormCard title="Stock action">
          <form onSubmit={submit} className="space-y-4">
            <Segmented
              label={t('ops.adjust.mode')}
              options={[
                { value: 'adjust', label: t('ops.adjust.adjustment') },
                { value: 'transfer', label: t('ops.adjust.transfer') },
              ]}
              value={mode}
              onChange={setMode}
            />

            <FeedTypeField
              id="adjust-feed-type"
              value={feedTypeId}
              onChange={(e) => setFeedTypeId(e.target.value)}
              feedTypes={(feedTypes || []).filter((ft) => ft.active !== false)}
              ready={feedTypes !== undefined}
              required
              hint="Stock lot to adjust or transfer. Create a type first if the catalog is empty."
              emptyMessage="Add a feed type before adjusting inventory."
              onCreated={(result) => {
                if (result?.id) setFeedTypeId(result.id)
              }}
            />

            <Field
              label={
                mode === 'adjust'
                  ? 'Quantity kg (+ in / − out)'
                  : 'Quantity kg to move'
              }
            >
              <Input
                type="number"
                step="any"
                className="font-data"
                value={quantityKg}
                onChange={(e) => setQuantityKg(e.target.value)}
                required
              />
            </Field>

            {mode === 'adjust' ? (
              <Field
                label="Farm location"
                hint="Defaults to header location"
              >
                <FarmLocationSelect
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                  allowEmpty={false}
                  locked
                />
              </Field>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="From farm location"
                  required
                  hint="Defaults to header"
                >
                  <FarmLocationSelect
                    value={fromLocationId}
                    onChange={(e) => setFromLocationId(e.target.value)}
                    required
                    allowEmpty={false}
                    locked
                  />
                </Field>
                <Field label="To farm location" required>
                  <FarmLocationSelect
                    value={toLocationId}
                    onChange={(e) => setToLocationId(e.target.value)}
                    required
                    allowEmpty={false}
                    syncWithHeader={false}
                  />
                </Field>
              </div>
            )}

            <Field label="Batch (optional)">
              <Input
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
              />
            </Field>

            <Field label={mode === 'adjust' ? 'Reason *' : 'Notes'}>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                required={mode === 'adjust'}
              />
            </Field>

            <Button type="submit" disabled={busy}>
              {busy
                ? 'Saving…'
                : mode === 'adjust'
                  ? 'Apply adjustment'
                  : 'Transfer'}
            </Button>
          </form>
        </FormCard>

        <FormCard title={t('ops.adjust.lotsTitle')} subtitle={t('ops.adjust.lotsSub')}>
          <Table
            columns={[
              { key: 'feed', header: t('ops.col.feedType'), render: (lot) => lot.feed_type_name, sub: (lot) => lot.location },
              { key: 'batch', header: t('ops.lots.batch'), width: 110, render: (lot) => <span className="font-data text-muted">{lot.batch_number || '—'}</span> },
              { key: 'expiry', header: t('ops.lots.expires'), width: 120, render: (lot) => (lot.expiry_date ? formatDate(lot.expiry_date) : '—') },
              { key: 'qty', header: t('ops.col.kg'), width: 90, align: 'right', render: (lot) => formatNumber(lot.quantity_kg, { decimals: 1 }) },
            ]}
            rows={relevantLots}
            empty={lots === undefined ? t('ops.common.loading') : t('ops.adjust.noLots')}
          />
          <p className="mt-3 text-sm">
            <Link
              href="/inventory/lots"
              className="rounded-sm text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
            >
              {t('ops.adjust.allLots')}
            </Link>
          </p>
        </FormCard>
      </div>
      </div>
    </Layout>
  )
}
