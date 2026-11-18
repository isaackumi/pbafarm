# Architecture 06 — Customization Engine Design

Status: proposed. Binding decision D-007: one engine — `customFieldDefs` (entity, key, type, validation, required, defaults, conditions, location scope) plus values stored on records in an optional `custom` object validated server-side against the definitions; `terminology` overrides; form layouts and dashboard layouts as configuration documents; no per-module custom-field code. Related: D-012 (species, grades, units, formatting), D-005 (`customization.manage` permission). Addresses MASTER-PROMPT PART 10-D and PART 17 ("avoid uncontrolled dynamic fields", "avoid hardcoded organization-specific assumptions"); retires TD-119 (configuration part), TD-110/TD-113 (navigation and threshold parts).

## 1. Current state

| Capability | As built | Evidence |
|---|---|---|
| Organization settings | `companies.settings` — branding (`displayName`, `accentHex`, `themeMode`), `farmRules`, `stockingRules`, `feedRules`, `locale.currency`, `aiAssistantEnabled`; edited as a draft (`companySettingsDrafts.draft: v.any()`) and published by `companies.publishSettings` with `validateSettingsForPublish`; defaults merged by `lib/farmRules.mergeSettings` | doc 04 §3.2–3.3; doc 14 row 56 |
| Rule enforcement | Server-side in `convex/lib/farmRules.ts` (`assertStockingAllowed`, `assertTopupAllowed`, `harvestWarnings`, mortality thresholds) | doc 08 §12 |
| Custom fields | None. Org-specific extras go into `notes` | doc 14 §3 |
| Terminology | Hard-coded English ("Cage", "Bi-weekly"); `Layout.js` title table | doc 10 §14 |
| Forms | Hand-written per screen; 5 validation styles; duplicate create flows | doc 10 §7–§8 |
| Dashboards | One hard-coded `components/Dashboard.js` with client-side health score | doc 10 §9 |
| Navigation | Hard-coded `Sidebar.js` (41 items, `adminOnly` flags) and `MobileTabBar.js` (4 fixed tabs) | doc 03 §3 |
| Domain lists | Species (`lib/fishSpecies.js`), harvest grades (`HarvestForm.SIZE_CATEGORIES`), bag presets, mortality causes (comment in schema) | doc 10 §14; doc 04 §3.11 |
| User preferences | `SettingsContext` in `localStorage` (`dateFormat` saved but never applied) | doc 10 §12 |

What to keep: the draft → publish pattern and server-side validation of settings are the right shape; the engine generalizes them.

## 2. Scope and boundaries

| In the engine | Not in the engine |
|---|---|
| Extra fields on a fixed list of entities, with typed validation and conditions | New entities or tables per organization |
| Labels (terminology) for built-in concepts | Per-organization code or scripts |
| Which core and custom fields a form shows, order, defaults, sections | Changing the meaning of core fields the engine or ledgers read (counts, dates, units, feed kg) |
| Dashboard widget selection and arrangement from a widget catalog | Arbitrary queries |
| Navigation visibility and phone tab bar selection | Custom workflows — those are automation rules (`07`) |
| Per-user preferences | — |

Typed configuration that the production engine or rules read (species defaults, size grades, unit types, thresholds) stays in typed tables and settings (`04`), not in custom fields, so engine code never depends on an organization's custom keys.

## 3. Schema

`convex/customization/tables.ts`:

```ts
export const customEntity = v.union(
  v.literal('cages'), v.literal('farmLocations'), v.literal('batches'),
  v.literal('dailyRecords'), v.literal('biweeklyRecords'), v.literal('harvestRecords'),
  v.literal('stockingHistory'), v.literal('fishTransfers'), v.literal('healthTreatments'),
  v.literal('feedPurchases'), v.literal('feedSuppliers'), v.literal('customers'), v.literal('sales'),
)

export const customScalar = v.union(v.string(), v.number(), v.boolean(), v.null())
/** Stored on records. Keys are field keys (^[a-z][a-z0-9_]{0,39}$). */
export const customValues = v.record(v.string(), v.union(customScalar, v.array(v.string())))

const condition = v.object({
  field: v.string(),                 // 'core:mortality' | 'custom:net_condition' | 'context:unitType'
  op: v.union(v.literal('eq'), v.literal('neq'), v.literal('gt'), v.literal('gte'),
              v.literal('lt'), v.literal('lte'), v.literal('in'),
              v.literal('is_set'), v.literal('is_not_set')),
  value: v.optional(v.union(customScalar, v.array(v.string()))),
})

customFieldDefs: defineTable({
  companyId: v.id('companies'),
  entity: customEntity,
  key: v.string(),
  label: v.string(),
  helpText: v.optional(v.string()),
  type: v.union(v.literal('text'), v.literal('long_text'), v.literal('number'), v.literal('integer'),
                v.literal('boolean'), v.literal('date'), v.literal('select'), v.literal('multi_select'),
                v.literal('user')),
  measure: v.optional(v.string()),   // 'mass_kg' | 'mass_g' | 'length_cm' | 'temp_c' | 'conc_mg_l' | 'percent' — drives unit conversion (D-012)
  options: v.optional(v.array(v.object({ value: v.string(), label: v.string(), archived: v.optional(v.boolean()) }))), // ≤ 100
  validation: v.optional(v.object({
    min: v.optional(v.number()), max: v.optional(v.number()),
    decimals: v.optional(v.number()), maxLength: v.optional(v.number()),
    pattern: v.optional(v.string()),  // anchored, length-limited, checked for catastrophic backtracking at save
  })),
  required: v.boolean(),
  requiredWhen: v.optional(v.array(condition)),   // all must hold
  visibleWhen: v.optional(v.array(condition)),
  defaultValue: v.optional(customScalar),
  appliesTo: v.optional(v.object({                // scope (D-007 locationScope)
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    unitTypes: v.optional(v.array(unitType)),
    speciesCodes: v.optional(v.array(v.string())),
  })),
  filterable: v.boolean(),                        // see §6.3
  status: v.union(v.literal('active'), v.literal('archived')),
  sortOrder: v.number(),
  version: v.number(),
  updatedBy: v.id('users'),
  updatedAt: v.number(),
})
  .index('by_companyId_and_entity_and_status', ['companyId', 'entity', 'status'])
  .index('by_companyId_and_entity_and_key', ['companyId', 'entity', 'key']),

terminology: defineTable({
  companyId: v.id('companies'),
  locale: v.string(),                              // 'en' until i18n lands (D-012)
  entries: v.record(v.string(), v.string()),       // ≤ 300 keys, e.g. 'unit.cage.singular' → 'Pen'
  version: v.number(),
  updatedBy: v.id('users'),
  updatedAt: v.number(),
}).index('by_companyId_and_locale', ['companyId', 'locale']),

formLayouts: defineTable({
  companyId: v.id('companies'),
  formKey: v.string(),                             // 'production.daily' | 'production.harvest' | 'production.stocking' | …
  status: v.union(v.literal('draft'), v.literal('published')),
  version: v.number(),
  sections: v.array(v.object({                     // ≤ 12 sections, ≤ 40 fields each
    key: v.string(),
    title: v.optional(v.string()),                 // terminology key or literal
    fields: v.array(v.object({
      ref: v.string(),                             // 'core:feedAmount' | 'custom:net_condition'
      width: v.optional(v.union(v.literal('full'), v.literal('half'))),
      hidden: v.optional(v.boolean()),             // refused for required core fields
      defaultValue: v.optional(customScalar),
      readOnly: v.optional(v.boolean()),
    })),
  })),
  updatedBy: v.id('users'),
  updatedAt: v.number(),
}).index('by_companyId_and_formKey_and_status', ['companyId', 'formKey', 'status']),

dashboardLayouts: defineTable({
  companyId: v.id('companies'),
  ownerUserId: v.optional(v.id('users')),          // undefined = organization default
  key: v.string(),                                 // 'home' | 'site' | 'unit'
  widgets: v.array(v.object({                      // ≤ 30
    widgetKey: v.string(),                         // from the code catalog, e.g. 'kpi.mortality_7d'
    params: v.optional(v.record(v.string(), customScalar)),
    x: v.number(), y: v.number(), w: v.number(), h: v.number(),
  })),
  updatedAt: v.number(),
}).index('by_companyId_and_ownerUserId_and_key', ['companyId', 'ownerUserId', 'key']),

userPreferences: defineTable({
  userId: v.id('users'),
  companyId: v.optional(v.id('companies')),
  theme: v.optional(v.union(v.literal('light'), v.literal('dark'), v.literal('system'), v.literal('outdoor'))),
  language: v.optional(v.string()),
  defaultLocationId: v.optional(v.id('farmLocations')),
  dateFormat: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_userId_and_companyId', ['userId', 'companyId']),
```

Entity tables listed in `customEntity` each get `custom: v.optional(customValues)` (additive).

Navigation configuration lives in `companies.settings.navigation` (published through the existing draft flow):

```ts
navigation: v.optional(v.object({
  hiddenItems: v.optional(v.array(v.string())),   // nav item keys from the code catalog
  phoneTabs: v.optional(v.array(v.string())),     // ≤ 5 keys
})),
```

## 4. Functions

| Function | Kind | Permission | Notes |
|---|---|---|---|
| `customization.fields.list({ entity })` | query | any member | Active + archived defs for the entity; used by forms and the reference cache |
| `customization.fields.upsert({ entity, key, … })` | mutation | `customization.manage` | Validates key format, option uniqueness, regex safety, limit of 50 active defs per entity; type change refused if any record holds a value (archive and create a new key instead); bumps `version`; audit |
| `customization.fields.archive({ id })` | mutation | `customization.manage` | Values remain on records and stay readable |
| `customization.terminology.get({ locale })` / `set({ locale, entries })` | query / mutation | any / `customization.manage` | Keys validated against the catalog in `lib/i18n/en.js` |
| `customization.forms.get({ formKey })` / `saveDraft` / `publish` | query / mutation | any / `customization.manage` | Publish refuses hiding required core fields and refs to unknown fields |
| `customization.dashboards.get({ key })` / `save({ key, widgets, scope: 'org' \| 'me' })` | query / mutation | any / `customization.manage` for org scope | Widget keys validated against the catalog |
| `customization.preferences.get` / `set` | query / mutation | self | Replaces `SettingsContext` local storage |

Kernel helper used by every write path that accepts `custom`:

```ts
// convex/kernel/customFields.ts
export async function validateCustom(
  ctx: MutationCtx,
  m: MemberContext,
  args: {
    entity: CustomEntity
    custom: Record<string, unknown> | undefined      // as received from the client
    previous?: Record<string, unknown>               // stored value on update
    context: {                                       // for appliesTo and conditions
      locationId?: Id<'farmLocations'>
      unitType?: UnitType
      speciesCode?: string
      core: Record<string, string | number | boolean | null | undefined>
    }
    mode: 'create' | 'update'
  },
): Promise<Record<string, CustomValue> | undefined>
```

Rules: unknown keys → `ConvexError('CUSTOM_FIELD_UNKNOWN')`; values for archived fields are kept from `previous` and new values refused; type coercion only for numeric strings from CSV import; numbers checked against `min`/`max`/`decimals` after converting from the display unit (the client always sends canonical units); `required` and `requiredWhen` evaluated only for defs whose `appliesTo` and `visibleWhen` match the context; defaults applied on create. Field-level errors are returned as `details.fieldErrors` so forms and the offline outbox can show them per field.

## 5. Client

- `features/forms/ConfigurableForm.jsx` renders a form from `(formKey, layout, defs, terminology)` with the existing `components/ui` primitives (`Field`, `Input`, `Select`), wiring `htmlFor`, `aria-invalid` and per-field errors (fixes part of TD-111).
- Core field components (unit picker, feed type picker with stock hint, numeric with unit) are registered by `ref` (`core:feedAmount`), so a layout can reorder or hide them but their behaviour stays in code.
- The default layout for each form is generated from code and equals today's form; an organization without a published layout sees exactly today's screen.
- `useTerm(key, { count })` resolves terminology: organization override → English catalog. Unit-type labels (`unit.cage.singular`, `unit.pond.singular` …) feed the Sidebar, page titles (`Layout.js` table) and empty states.
- Dashboards render widgets from `features/analytics/widgets/*`, each bound to one analytics query that reads rollups (`02` §6), so a custom dashboard cannot create an unbounded query.
- Navigation: `features/nav/navConfig.js` lists items with `key`, `permission`, `termKey`; the Sidebar and tab bar filter by permission (`03`) and by `settings.navigation`.

## 6. Design details

### 6.1 Why values live on the record

A `custom` object on the row keeps reads to one document (forms, lists, offline cache, exports), commits atomically with the record, and is covered by the same tenancy checks. A separate EAV table would double writes, need joins on every list, and complicate the outbox. The cost is that custom values are not indexed (6.3).

### 6.2 Limits that keep fields controlled (PART 17)

| Limit | Value | Why |
|---|---|---|
| Active defs per entity per organization | 50 | Document size and validation cost |
| Options per select | 100 | Bounded arrays in documents |
| Text length | 2,000 (`long_text`), 200 (`text`) | Document size (1 MB cap per document) |
| Regex | anchored, ≤ 200 chars, rejected if it fails a backtracking test at save | Avoid ReDoS in mutations |
| Type changes | refused once values exist | Values stay interpretable |
| Deletion | archive only | History stays readable |

### 6.3 Filtering and reporting on custom fields

Lists filter custom values in memory within a page. A def with `filterable: true` (≤ 5 per entity) also writes rows to `customFieldIndex` (`companyId, entity, key, valueString?, valueNumber?, recordId`, indexes `by_companyId_and_entity_and_key_and_valueString` / `…valueNumber`) maintained by `validateCustom` callers, which lets a list or report query by that field through an index. Exports include all custom columns. Built only when the first customer needs filtering (CUSTOM phase), not before.

### 6.4 Interaction with the offline outbox

Definitions, layouts and terminology are part of the reference-data cache (`08`). If definitions change while a device is offline, the server validates against current definitions; a rejected item stays in the outbox with `fieldErrors` and opens the form for correction instead of failing silently.

### 6.5 Settings that stay typed

`farmRules`, `stockingRules`, `feedRules`, `locale`, `navigation`, `approvals` remain typed objects in `companies.settings`, edited through the draft → publish flow. `companySettingsDrafts.draft: v.any()` is replaced by the typed settings validator (TD-132), with `logoStorageId` removed from the draft and handled only by `setLogo` after an ownership check (TD-015).

## 7. Migration

| Step | Phase | Change | Backfill | Compatibility | What could break |
|---|---|---|---|---|---|
| 1 | 2–3 | Move hard-coded lists to typed config: species and size grades (`04`), mortality causes (`settings.lists.mortalityCauses`), bag presets (`feedRules.bagPresetsKg`) | Seed each organization with today's values | Forms fall back to code lists if config missing | Nothing; same values |
| 2 | 8 (CUSTOM) | Tables `customFieldDefs`, `terminology`, `formLayouts`, `dashboardLayouts`, `userPreferences`; `custom` on entity tables | none | Every reader ignores `custom` if absent | — |
| 3 | 8 | `validateCustom` called from every write path of the listed entities (`dailyRecords.createBatch`, `harvest.create`, `stocking.createStocking`, `cages.create/update` …) | — | Clients that do not send `custom` are unaffected; required custom fields apply only to forms that render them and to API writes after an org publishes such a field | Bulk CSV import must map custom columns or the org must not mark fields required for imported entities (validation explains which) |
| 4 | 8 | `ConfigurableForm` for daily entry, sampling, harvest, stocking; navigation from config; terminology in titles | — | Default layouts reproduce today's forms | Form behaviour differences caught by component tests per form |
| 5 | 8 | `userPreferences` replaces `SettingsContext` local storage | Copy local values on first load | — | — |
| 6 | 8/13 | Dashboard layouts; `Dashboard.js` becomes the default org layout of catalog widgets | — | — | KPI definitions change with the engine (`05`), not with this step |

## 8. Proposed changes and impact (Rule 3)

| Change | Exists | Problem | Why | Files | Dependents / break risk | Compatibility |
|---|---|---|---|---|---|---|
| Custom fields engine | `notes` only | Orgs cannot capture their own data; per-module hacks would follow | D-007 | New `convex/customization/*`, `convex/kernel/customFields.ts`; write paths of 13 entities; forms | Write mutations gain an optional arg | Optional everywhere |
| Terminology | Hard-coded labels | Ponds/tanks/pens need different words; future languages | D-007, D-012 | `components/Sidebar.js`, `Layout.js`, page titles | Text only | English catalog default |
| Configurable forms | Hand-written forms | Field order/visibility differs per org | D-007 | `components/DailyUploadPage.js`, `HarvestForm.js`, `StockingForm.js`, `BiweeklyEntryForm.js` | Field-entry UX is critical (doc 11) | Default layout = today; migrate one form at a time with tests |
| Configurable nav | Fixed Sidebar/tab bar | 39-item drawer, fixed tabs (TD-110) | D-007 navigation | `Sidebar.js`, `MobileTabBar.js` | Tours reference `data-tour` attributes on nav items (`lib/tours`) | Tour steps skip hidden items |

## 9. Risks

- Configuration sprawl: limits in §6.2 and the archive-only rule keep it bounded; an org-level "customization report" lists defs, usage counts and last use.
- Performance: `validateCustom` reads at most one index range of defs per entity per mutation; batch writes (`createBatch` with 100 lines) reuse one read.
- Required custom fields can block field entry offline if definitions change; server returns field errors and the outbox keeps the item (`6.4`).
- A layout that hides a field the engine needs: refused at publish (required core fields cannot be hidden).

## 10. Open questions

1. Which entities do current customers actually want custom fields on first (daily records and harvest are assumed)?
2. Should custom fields be scoped per site (`appliesTo.locationIds`) from the start, or organization-wide only at first?
3. Are per-user dashboards needed, or is one organization dashboard per role enough?
4. Should organizations be able to hide the AI assistant and tours via navigation config?
