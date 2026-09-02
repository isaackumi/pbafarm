# Farm Company Settings Implementation Plan

> **For agentic workers:** Implement task-by-task. Checkboxes track progress.

**Goal:** Expand `/company-settings` into draft→preview→publish farm settings with live theme/branding and rule enforcement, plus close core CRUD gaps.

**Architecture:** Extend `companies.settings` + `companySettingsDrafts`; `convex/lib/farmRules.ts` merges defaults and asserts stocking/top-up; client `CompanySettingsProvider` applies published accent/theme; tabbed settings UI.

**Tech Stack:** Next.js Pages, Convex, existing UI kit (`TabBar`, `PageHeader`, `FormCard`).

## Global Constraints

- Backward compatible defaults (stocking/top-up still require approval if unset)
- Harvest DOC/ABW = warn only in v1
- Admin+ for draft/publish; members can read effective settings
- Accent remaps `--lagoon-*`, not kelp green

---

### Task 1: Schema + farmRules + Convex draft/publish
- [ ] Extend `companies` fields + settings object; add `companySettingsDrafts`
- [ ] Add `convex/lib/farmRules.ts` with defaults + assert helpers
- [ ] Add getEffectiveSettings / getSettingsDraft / saveSettingsDraft / publishSettings / logo mutations

### Task 2: Company Settings UI
- [ ] Rewrite `pages/company-settings.js` with tabs + preview + draft/publish
- [ ] Update `lib/companyService.js` bridge methods

### Task 3: Theme + provider
- [ ] Dark tokens in `theme.css`; apply accent vars
- [ ] `CompanySettingsProvider` + wire ThemeContext

### Task 4: Enforce rules
- [ ] Wire stocking/top-up/daily/harvest mutations
- [ ] Soft warnings in forms

### Task 5: CRUD gaps
- [ ] Harvest remove; user invite/deactivate; logo storage
