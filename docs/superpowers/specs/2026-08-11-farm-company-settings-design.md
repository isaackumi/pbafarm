# Farm Company Settings — Design Spec

**Date:** 2026-08-11  
**Status:** Approved — implementation in progress / shipped (2026-08-11)
**Approach:** Expand `/company-settings` into a tabbed Farm Settings hub (preview → save draft → publish)

---

## 1. Goal

Give farm admins one place to configure global company behavior:

- Branding & theme (name, accent color, light/dark)
- Farm operating rules (harvest ABW/DOC, density, mortality, FCR)
- Stocking rules (approvals, capacity, ABW bounds)
- Company profile (contact, logo, AI assistant)

Changes are edited as a **draft**, **previewed** live in the UI, then **published** so they take effect app-wide (CSS + Convex enforcement). Also close known CRUD gaps so create/read/update/delete work end-to-end for core domains.

---

## 2. Non-goals (this pass)

- Multi-company theme marketplace / white-label per subdomain
- Species-specific rule profiles (tilapia vs salmon packs) — single rule set per company
- Full audit UI for every settings field change history (publish writes one audit row)
- Mobile-native settings screens

---

## 3. Information architecture

**Route:** keep `/company-settings` (admin+). Sidebar label: **Company Settings**.

**Tabs:**

| Tab | Contents |
|---|---|
| Profile | Legal/display name, abbreviation, address, email, phone, logo |
| Branding & theme | Accent color, theme mode (light / dark / system), AI assistant toggle |
| Farm rules | Target harvest ABW, DOC min/max, max density, mortality alerts, FCR targets |
| Stocking rules | Require approval stocking/top-up, enforce cage capacity, min/max initial ABW, allowed cage statuses |

**Sticky footer actions (all tabs share one draft):**

- **Discard** — reset draft to last published
- **Save draft** — persist draft without applying
- **Publish** — validate + copy draft → live settings; apply theme; enforce rules thereafter

**Preview panel (right column on desktop / collapsible on mobile):**

- Mini chrome mock (sidebar chip + primary button) using draft accent
- Theme mode preview (surface/text sample)
- Rule summary bullets (“Stocking requires approval”, “Max density 80 fish/m³”, …)
- Dirty indicator when draft ≠ published

---

## 4. Data model

Extend `companies` in `convex/schema.ts` (backward compatible).

### 4.1 Top-level company fields (new)

- `abbreviation?: string`
- `contactPhone?: string`
- `logoStorageId?: Id<'_storage'>`

### 4.2 `companies.settings` shape

```ts
settings: {
  aiAssistantEnabled: boolean
  branding?: {
    displayName?: string      // optional override of companies.name in chrome
    accentHex?: string        // e.g. "#18181B"
    themeMode?: 'light' | 'dark' | 'system'
  }
  farmRules?: {
    targetHarvestAbwG?: number
    harvestDocMinDays?: number
    harvestDocMaxDays?: number
    maxDensityFishPerM3?: number
    dailyMortalityAlertPct?: number      // of current stock
    cumulativeMortalityAlertPct?: number // of initial stock
    targetFcr?: number
    maxFcrAlert?: number
  }
  stockingRules?: {
    requireApprovalForStocking: boolean
    requireApprovalForTopup: boolean
    enforceCageCapacity: boolean
    minInitialAbwG?: number
    maxInitialAbwG?: number
    allowStockOnlyEmptyStatuses?: string[] // default: empty|fallow|harvested
  }
  updatedAt?: number
  updatedBy?: Id<'users'>
}
```

### 4.3 Draft storage

Add table `companySettingsDrafts`:

- `companyId` (indexed)
- `draft` — same object shape as published settings + profile patch fields (`name`, `abbreviation`, `address`, `contactEmail`, `contactPhone`, `logoStorageId`)
- `updatedAt`, `updatedBy`

One draft row per company. Publish copies draft into `companies` + `companies.settings`, then clears or keeps draft = published snapshot.

### 4.4 Defaults (match today’s behavior)

| Key | Default |
|---|---|
| `requireApprovalForStocking` | `true` |
| `requireApprovalForTopup` | `true` |
| `enforceCageCapacity` | `true` |
| `allowStockOnlyEmptyStatuses` | `['empty','fallow','harvested']` |
| `targetHarvestAbwG` | `600` |
| `harvestDocMinDays` | `150` |
| `harvestDocMaxDays` | `210` |
| `maxDensityFishPerM3` | `80` |
| `dailyMortalityAlertPct` | `0.5` |
| `cumulativeMortalityAlertPct` | `10` |
| `targetFcr` | `1.4` |
| `maxFcrAlert` | `1.8` |
| `minInitialAbwG` | `5` |
| `maxInitialAbwG` | `80` |
| `accentHex` | `#18181B` |
| `themeMode` | `light` |
| `aiAssistantEnabled` | `false` (existing) |

Missing fields resolve via `getEffectiveSettings(company)` helper so old companies keep working.

---

## 5. Convex API

| Function | Access | Behavior |
|---|---|---|
| `companies.getEffectiveSettings` | company member | Live settings merged with defaults |
| `companies.getSettingsDraft` | admin+ | Draft or live-as-draft if none |
| `companies.saveSettingsDraft` | admin+ | Upsert draft; audit `settings_draft` |
| `companies.publishSettings` | admin+ | Validate → write company profile + settings; apply `updatedAt/By`; audit `settings_publish`; sync draft |
| `companies.generateLogoUploadUrl` | admin+ | Convex storage upload URL |
| `companies.setLogo` / `clearLogo` | admin+ | Patch `logoStorageId` |
| `companies.updateSettings` | keep | Thin wrapper or deprecate in favor of draft/publish |

**Validation on publish:**

- Hex color `#RGB` / `#RRGGBB`
- Numeric ranges sane (ABW > 0, DOC min ≤ max, % 0–100, FCR > 0)
- Status list ⊆ known cage statuses

**Enforcement helper:** `convex/lib/farmRules.ts`

- `getEffectiveSettings(ctx, companyId)`
- `assertStockingAllowed({ cage, fishCount, abw, rules })`
- `assertTopupAllowed(...)`
- `assertHarvestAllowed({ docDays, abw, rules })` — warn vs hard-fail: **hard-fail only for stocking capacity/ABW/status; harvest DOC/ABW = soft warn via return flags / client toast unless `strictHarvestRules` added later (not in v1)**
- Mortality: after `dailyRecords.create`, if daily or cumulative % exceeds thresholds → `notifications.create`

Wire into:

- `stocking.createStocking` / `createTopup` / `approveStocking` / `approveTopup`
- `harvest.create` / `createFromSampling` (soft warn metadata)
- `dailyRecords.create` (alerts)
- Dashboard/reports optional KPI comparison vs targets (read-only badges)

---

## 6. Frontend

### 6.1 Page

Rewrite `pages/company-settings.js` to tabbed shell using existing `TabBar` / `PageHeader` / `FormCard` / `Button`.

State machine:

1. Load published + draft on mount
2. Local `draft` state; edits mark dirty
3. Preview reads `draft` only (does not mutate `:root` until publish)
4. Save draft → Convex
5. Publish → Convex → then apply published branding to document (`CompanySettingsProvider`)

### 6.2 Theme application

- Extend `ThemeContext` (or new `CompanySettingsProvider`) to:
  - On published settings: set `document.documentElement.dataset.theme` / `classList` for dark
  - Set CSS vars `--accent`, map to `--lagoon-950` / `--lagoon-800` for chrome (preview uses scoped `.settings-preview { --lagoon-950: ... }`)
- Add dark theme token overrides in `styles/theme.css` under `html.dark` / `[data-theme='dark']`
- Header sun/moon toggles **user preference** when company `themeMode === 'system'`; when company forces light/dark, show note “Set by company settings”

### 6.3 Forms that consume rules

- `StockingForm` / `TopUpForm`: client-side checks using `getEffectiveSettings` query for immediate UX; server remains source of truth
- `HarvestForm`: show DOC/ABW outside-window warning
- `DailyUploadPage`: show mortality alert threshold hint

### 6.4 Branding chrome

- Sidebar/Header use `displayName || company.name` and logo URL from Convex storage when present

---

## 7. CRUD completion (same pass)

| Gap | Fix |
|---|---|
| Harvest delete | Add `harvest.remove` mutation + UI action (admin) |
| User invite / deactivate | `users.invite` (create auth user + role + companyId) and `users.deactivate` (soft: role demotion or `active: false` field on users) |
| Company logo | Convex `_storage` upload + `logoStorageId`; remove stub |
| Abbreviation / phone | Persist on company document |
| Theme toggle | Real dark CSS + class application |
| SettingsContext | Wire or remove dead localStorage prefs; prefer company settings for farm scope |

Out of scope if timeboxed after settings publish path: deep invite email delivery (invite creates user with temporary password / magic link depending on Convex Auth capabilities — implement create+assign; document email limitation if Auth doesn’t send mail).

---

## 8. Permissions

- **View published settings:** any authenticated company member (for form validation)
- **Draft / publish / logo:** `admin` or `super_admin`
- Super-admin may publish for any company only if acting in that tenancy context (no cross-tenant publish unless already supported)

---

## 9. Acceptance criteria

1. Admin opens `/company-settings`, edits accent + stocking approval off, sees preview update without changing live chrome.
2. **Save draft** persists; reload restores draft.
3. **Publish** updates sidebar accent/name and stocking no longer forces `pending_approval` when rule is off.
4. Stocking over cage capacity is rejected when `enforceCageCapacity` is on.
5. Daily mortality above threshold creates a notification.
6. Logo upload/delete works and shows in sidebar.
7. Harvest records can be deleted by admin.
8. User management can invite and deactivate users (within Auth limits).
9. Dark mode class applies real dark tokens when selected and published (or user toggle under system mode).
10. Existing companies without new fields behave as today (approvals required).

---

## 10. Implementation order

1. Schema + defaults helper + draft table + get/save/publish mutations  
2. Company Settings UI (tabs + preview + draft/publish)  
3. Theme CSS dark + accent vars + provider  
4. Enforce rules in stocking/top-up/daily/harvest  
5. CRUD gaps: logo, harvest delete, users invite/deactivate  
6. Wire forms to settings query for soft warnings  
7. Smoke-test acceptance list  

---

## 11. Open decisions (defaults locked unless you object)

- Harvest DOC/ABW outside window = **warn only** in v1 (not hard block)
- One draft per company (last-write-wins)
- Accent remaps charcoal chrome tokens (`--lagoon-*`), not success green (`--kelp`)
