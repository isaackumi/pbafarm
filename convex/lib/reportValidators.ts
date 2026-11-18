import { v } from 'convex/values'
import { CHART_TYPES, DATASET_IDS, DIMENSION_IDS, GRANULARITIES, RANGE_PRESETS } from './reportCatalog'

/** Validators of saved reports, schedules and deliveries (ANLY-001, ANLY-007). */

const literals = <T extends string>(values: readonly T[]) =>
  v.union(...values.map((x) => v.literal(x))) as any as ReturnType<typeof v.literal<T>>

export const datasetId = literals(DATASET_IDS)
export const dimensionId = literals(DIMENSION_IDS)

export const reportDefinition = v.object({
  dataset: datasetId,
  dimensions: v.array(dimensionId),
  granularity: v.optional(literals(GRANULARITIES)),
  measures: v.array(v.string()),
  filters: v.array(v.object({ dimension: dimensionId, values: v.array(v.string()) })),
  range: v.object({
    preset: literals(RANGE_PRESETS),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  }),
  chart: v.object({ type: literals(CHART_TYPES), measure: v.optional(v.string()) }),
  sort: v.optional(v.object({ by: v.string(), dir: v.union(v.literal('asc'), v.literal('desc')) })),
  limit: v.optional(v.number()),
})

export const reportVisibility = v.union(v.literal('private'), v.literal('company'))

export const scheduleFrequency = v.union(v.literal('daily'), v.literal('weekly'), v.literal('monthly'))

export const reportDeliveryStatus = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('retrying'),
  v.literal('succeeded'),
  v.literal('partial'),
  v.literal('failed'),
  v.literal('skipped'),
)

export const reportRecipient = v.object({
  userId: v.id('users'),
  to: v.string(),
  status: v.union(v.literal('pending'), v.literal('sent'), v.literal('failed'), v.literal('skipped')),
  attempts: v.number(),
  error: v.optional(v.string()),
  retryable: v.optional(v.boolean()),
  providerMessageId: v.optional(v.string()),
})
