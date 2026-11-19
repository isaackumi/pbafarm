/**
 * Form values → Convex mutation arguments for production records. Pure, so
 * forms (useMutation) and the offline outbox senders build the same payload.
 * Forms still send snake_case or camelCase; both are accepted.
 */

/** Convex optional fields reject null: drop null, undefined and ''. */
export function omitNulls(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v
  }
  return out
}

const pick = (o, snake, camel) => (o[snake] !== undefined && o[snake] !== null && o[snake] !== '' ? o[snake] : o[camel])
const numOrUndef = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))

/** api.cages.create from form fields (empty values dropped). */
export function cageCreateArgs(cageData, activeLocationId) {
  return omitNulls({
    name: cageData.name,
    code: cageData.code,
    location: cageData.location,
    size: numOrUndef(cageData.size),
    capacity: numOrUndef(cageData.capacity),
    dimensions: cageData.dimensions,
    material: cageData.material,
    installationDate: pick(cageData, 'installation_date', 'installationDate'),
    stockingDate: pick(cageData, 'stocking_date', 'stockingDate'),
    initialCount: numOrUndef(pick(cageData, 'initial_count', 'initialCount')),
    initialAbw: numOrUndef(pick(cageData, 'initial_abw', 'initialAbw')),
    initialBiomass: numOrUndef(pick(cageData, 'initial_biomass', 'initialBiomass')),
    status: cageData.status,
    notes: cageData.notes,
    unitType: cageData.unitType,
    areaM2: cageData.areaM2,
    depthM: cageData.depthM,
    volumeM3: cageData.volumeM3,
    diameterM: cageData.diameterM,
    unitGroup: cageData.unitGroup,
    custom: cageData.custom,
    locationId: cageData.locationId || cageData.location_id || activeLocationId,
  })
}

/** api.stocking.createStocking. */
export function stockingCreateArgs(s) {
  const fishCount = Number(pick(s, 'fish_count', 'fishCount'))
  const initialAbw = Number(pick(s, 'initial_abw', 'initialAbw'))
  const biomass = pick(s, 'initial_biomass', 'initialBiomass')
  return omitNulls({
    cageId: pick(s, 'cage_id', 'cageId'),
    batchNumber: pick(s, 'batch_number', 'batchNumber'),
    stockingDate: pick(s, 'stocking_date', 'stockingDate'),
    fishCount,
    initialAbw,
    initialBiomass: biomass != null && biomass !== '' ? Number(biomass) : (fishCount * initialAbw) / 1000,
    sourceLocation: pick(s, 'source_location', 'sourceLocation'),
    sourceCage: pick(s, 'source_cage', 'sourceCage'),
    transferSupervisor: pick(s, 'transfer_supervisor', 'transferSupervisor'),
    samplingSupervisor: pick(s, 'sampling_supervisor', 'samplingSupervisor'),
    notes: s.notes,
    species: s.species,
    custom: s.custom,
  })
}

/** api.stocking.updateStocking from snake_case or camelCase form fields. */
export function stockingPatchArgs(stockingId, s) {
  const patch = omitNulls({
    stockingDate: pick(s, 'stocking_date', 'stockingDate'),
    fishCount: numOrUndef(pick(s, 'fish_count', 'fishCount')),
    initialAbw: numOrUndef(pick(s, 'initial_abw', 'initialAbw')),
    initialBiomass: numOrUndef(pick(s, 'initial_biomass', 'initialBiomass')),
    sourceLocation: pick(s, 'source_location', 'sourceLocation'),
    notes: s.notes,
  })
  return { id: stockingId, patch }
}

/** api.stocking.createTopup. */
export function topupCreateArgs(t) {
  return omitNulls({
    stockingId: pick(t, 'stocking_id', 'stockingId'),
    topupDate: pick(t, 'topup_date', 'topupDate'),
    fishCount: Number(pick(t, 'fish_count', 'fishCount')),
    abw: Number(t.abw),
    sourceLocation: pick(t, 'source_location', 'sourceLocation'),
    transferSupervisor: pick(t, 'transfer_supervisor', 'transferSupervisor'),
    notes: t.notes,
  })
}

/** api.biweeklyRecords.create for one cage's sampling. */
export function biweeklyCreateArgs(r) {
  const samples = (r.samples || []).map((s, i) => ({
    samplingNumber: Number(s.sampling_number ?? s.samplingNumber ?? i + 1),
    fishCount: Number(s.fish_count ?? s.fishCount ?? 0),
    totalWeight: Number(s.total_weight ?? s.totalWeight ?? 0),
    averageBodyWeight: Number(s.average_body_weight ?? s.averageBodyWeight ?? s.abw ?? 0),
  }))
  return omitNulls({
    cageId: pick(r, 'cage_id', 'cageId'),
    date: r.date,
    batchCode: pick(r, 'batch_code', 'batchCode'),
    averageBodyWeight: Number(r.average_body_weight ?? r.averageBodyWeight ?? r.average_weight ?? 0),
    totalFishCount: Number(r.total_fish_count ?? r.totalFishCount ?? 0),
    totalWeight: Number(r.total_weight ?? r.totalWeight ?? 0),
    dissolvedOxygen: numOrUndef(pick(r, 'dissolved_oxygen', 'dissolvedOxygen')),
    temperatureC: numOrUndef(pick(r, 'temperature_c', 'temperatureC')),
    secchiCm: numOrUndef(pick(r, 'secchi_cm', 'secchiCm')),
    samples: samples.length ? samples : undefined,
    custom: r.custom,
  })
}

/** api.dailyRecords.createBatch / api.biweeklyRecords.createBatch: lines saved atomically. */
export function batchArgs({ date, records, allowNegative, overrideReason, clientMutationId }) {
  return {
    date,
    records: (records || []).map((r) => omitNulls(r)),
    ...(allowNegative ? { allowNegative: true } : {}),
    ...(overrideReason ? { overrideReason } : {}),
    ...(clientMutationId ? { clientMutationId } : {}),
  }
}

const HARVEST_FIELDS = {
  cage_id: 'cageId',
  harvest_date: 'harvestDate',
  harvest_type: 'harvestType',
  total_weight: 'totalWeight',
  average_body_weight: 'averageBodyWeight',
  estimated_count: 'estimatedCount',
  fcr: 'fcr',
  size_breakdown: 'sizeBreakdown',
  notes: 'notes',
}

function mapHarvest(data, extra = {}) {
  const fields = { ...HARVEST_FIELDS, ...extra }
  const out = {}
  for (const [snake, camel] of Object.entries(fields)) {
    if (data[snake] !== undefined) out[camel] = data[snake]
    if (data[camel] !== undefined) out[camel] = data[camel]
  }
  if (data.status !== undefined) out.status = data.status
  return out
}

/** api.harvest.create. Throws when a required number is missing. */
export function harvestCreateArgs(data) {
  const args = mapHarvest(data, { withdrawal_override_reason: 'withdrawalOverrideReason', custom: 'custom' })
  if (data.clientMutationId) args.clientMutationId = data.clientMutationId
  // FCR is computed on the server (PROD-009); a typed one is only a fallback.
  if (args.fcr === '' || args.fcr == null || !Number.isFinite(Number(args.fcr))) delete args.fcr
  else args.fcr = Number(args.fcr)
  for (const key of ['totalWeight', 'averageBodyWeight', 'estimatedCount']) {
    const n = Number(args[key])
    if (args[key] === '' || args[key] == null || !Number.isFinite(n)) {
      throw new Error(`Harvest ${key} must be a number`)
    }
    args[key] = key === 'estimatedCount' ? Math.round(n) : n
  }
  if (!args.notes) delete args.notes
  return args
}

/** api.harvest.update patch (cage is not editable; blank numbers are left unchanged). */
export function harvestPatchArgs(updates) {
  const patch = mapHarvest(updates)
  delete patch.cageId
  for (const key of ['totalWeight', 'averageBodyWeight', 'estimatedCount', 'fcr']) {
    if (patch[key] === undefined) continue
    const n = Number(patch[key])
    if (patch[key] === '' || patch[key] == null || !Number.isFinite(n)) delete patch[key]
    else patch[key] = n
  }
  return patch
}
