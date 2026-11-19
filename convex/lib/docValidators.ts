import { v, type PropertyValidators, type VFloat64, type VId, type VObject } from 'convex/values'
import type { Doc, Id, TableNames } from '../_generated/dataModel'
import schema from '../schema'

type Tables = typeof schema.tables

export type DocFields<T extends TableNames> = Tables[T]['validator']['fields'] & {
  _id: VId<Id<T>>
  _creationTime: VFloat64
}

/** Schema fields of `table` plus its system fields, for `v.object({...})` spreads. */
export function docFields<T extends TableNames>(table: T): DocFields<T> {
  return {
    ...schema.tables[table].validator.fields,
    _id: v.id(table),
    _creationTime: v.number(),
  } as DocFields<T>
}

/** Return validator for a full document of `table`, derived from the schema. */
export function docValidator<T extends TableNames>(table: T): VObject<Doc<T>, PropertyValidators> {
  return v.object(docFields(table) as unknown as PropertyValidators) as VObject<Doc<T>, PropertyValidators>
}
