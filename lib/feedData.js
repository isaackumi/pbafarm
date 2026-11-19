// Pure shaping for feed screens (UX-002): the same results the old
// imperative feedService returned, now fed by reactive queries.

/** Date window for '7d' | '30d' | '90d' | '1y' (anything else: 30 days). */
export function rangeToDates(timeRange = '30d', now = new Date()) {
  const days = timeRange === '7d' ? 7 : timeRange === '90d' ? 90 : timeRange === '1y' ? 365 : 30
  const end = new Date(now)
  const start = new Date(now)
  start.setDate(end.getDate() - days)
  return {
    dateFrom: start.toISOString().split('T')[0],
    dateTo: end.toISOString().split('T')[0],
  }
}

/** Usage totals by feed type name and cage name. */
export function summarizeUsage(rows, feedTypes, cages) {
  const feedNames = Object.fromEntries((feedTypes || []).map((t) => [t.id || t._id, t.name]))
  const cageNames = Object.fromEntries((cages || []).map((c) => [c.id || c._id, c.name]))
  const list = rows || []
  const byFeedType = {}
  const byCage = {}
  let totalUsage = 0
  for (const u of list) {
    const qty = Number(u.quantity || 0)
    totalUsage += qty
    const ftId = u.feed_type_id || u.feedTypeId
    const cageId = u.cage_id || u.cageId
    const ft = feedNames[ftId] || ftId || 'Unknown'
    byFeedType[ft] = (byFeedType[ft] || 0) + qty
    const cage = cageNames[cageId] || cageId || 'Unassigned'
    byCage[cage] = (byCage[cage] || 0) + qty
  }
  return { totalUsage, byFeedType, byCage, rows: list }
}

/** Spend, kilograms and average price over purchases. */
export function summarizeCosts(purchases) {
  let totalCost = 0
  let totalKg = 0
  for (const p of purchases || []) {
    const qty = Number(p.quantity || 0)
    const price = Number(p.price_per_kg ?? p.pricePerKg ?? 0)
    totalKg += qty
    totalCost += qty * price
  }
  return {
    totalCost,
    totalKg,
    averageCostPerKg: totalKg > 0 ? totalCost / totalKg : 0,
    purchases: purchases || [],
  }
}

/** Low-stock alerts with a name and numeric levels. */
export function normalizeAlerts(data) {
  return (data || []).map((a) => ({
    ...a,
    name: a.name || a.feed_type_name || a.feedTypeName || 'Feed',
    currentStock: a.currentStock ?? a.current_stock ?? 0,
    minimumStock: a.minimumStock ?? a.minimum_stock ?? 0,
  }))
}

const numberOrUndefined = (value) => (value != null && value !== '' ? Number(value) : undefined)

/** Arguments for api.feed.createPurchase. Throws when no supplier is given. */
export function purchaseCreateArgs(purchaseData, activeLocationId) {
  const supplierId = purchaseData.supplier_id || purchaseData.supplierId
  if (!supplierId) throw new Error('Supplier is required')
  return {
    feedTypeId: purchaseData.feed_type_id || purchaseData.feedTypeId,
    quantity: numberOrUndefined(purchaseData.quantity ?? purchaseData.quantityKg),
    bags: numberOrUndefined(purchaseData.bags),
    pricePerKg: Number(purchaseData.price_per_kg ?? purchaseData.pricePerKg),
    purchaseDate: purchaseData.purchase_date || purchaseData.purchaseDate,
    supplierId,
    batchNumber: purchaseData.batch_number || purchaseData.batchNumber || undefined,
    expiryDate: purchaseData.expiry_date || purchaseData.expiryDate || undefined,
    notes: purchaseData.notes || undefined,
    locationId: purchaseData.locationId || purchaseData.location_id || activeLocationId || undefined,
  }
}

/** Arguments for api.feed.updatePurchase. Throws when no supplier is given. */
export function purchaseUpdateArgs(id, purchaseData) {
  const supplierId = purchaseData.supplier_id || purchaseData.supplierId
  if (!supplierId) throw new Error('Supplier is required')
  return {
    id,
    quantity: numberOrUndefined(purchaseData.quantity ?? purchaseData.quantityKg),
    bags: numberOrUndefined(purchaseData.bags),
    pricePerKg:
      purchaseData.price_per_kg != null || purchaseData.pricePerKg != null
        ? Number(purchaseData.price_per_kg ?? purchaseData.pricePerKg)
        : undefined,
    purchaseDate: purchaseData.purchase_date || purchaseData.purchaseDate || undefined,
    supplierId,
    batchNumber: purchaseData.batch_number ?? purchaseData.batchNumber ?? undefined,
    expiryDate: purchaseData.expiry_date ?? purchaseData.expiryDate ?? undefined,
    notes: purchaseData.notes ?? undefined,
  }
}

/** Arguments for api.feed.createFeedType. */
export function feedTypeCreateArgs(form) {
  const args = {
    name: String(form.name || '').trim(),
    currentStock: Number(form.current_stock ?? form.currentStock ?? 0),
    minimumStock: Number(form.minimum_stock ?? form.minimumStock ?? 0),
    pricePerKg: Number(form.price_per_kg ?? form.pricePerKg ?? 0),
    bagSizeKg: Number(form.bag_size_kg ?? form.bagSizeKg ?? 20),
    active: form.active !== false,
  }
  const description = form.description
  if (description) args.description = description
  const supplierId = form.supplier_id || form.supplierId
  if (supplierId) args.supplierId = supplierId
  return args
}

/** Arguments for api.feed.updateFeedType. */
export function feedTypeUpdateArgs(id, form) {
  return {
    id,
    patch: {
      name: form.name,
      description: form.description,
      minimumStock:
        form.minimum_stock != null || form.minimumStock != null
          ? Number(form.minimum_stock ?? form.minimumStock)
          : undefined,
      pricePerKg:
        form.price_per_kg != null || form.pricePerKg != null
          ? Number(form.price_per_kg ?? form.pricePerKg)
          : undefined,
      bagSizeKg:
        form.bag_size_kg != null || form.bagSizeKg != null
          ? Number(form.bag_size_kg ?? form.bagSizeKg)
          : undefined,
      supplierId: form.supplier_id || form.supplierId,
      active: form.active,
    },
  }
}
