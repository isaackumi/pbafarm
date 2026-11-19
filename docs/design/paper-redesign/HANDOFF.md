# PBA Farm redesign: build handoff

The source of truth is the Paper file **"PBA Farm — Redesign"**, file id `01M7RD5Z2VX87M2KSRH9YKX8XA`.
- Page **Desktop** (`p-1-0`) holds the app screens.
- Page **Website** (`p-2-0`) holds the marketing landing page.

The animated workflow prototype is in `automation-flow.html`, next to this file. Paper cannot animate, so use it as the motion reference for the automations canvas.

## 1. How to build from the design exactly

Never eyeball a screenshot. Read the design through the Paper MCP server; Paper Desktop must be open with the file loaded.

1. Call `get_screenshot` on the artboard id, with `scale: 2` for detail. This is the visual target.
2. Call `get_jsx` on the artboard or a child node. It returns exact structure and inline styles: flex direction, gaps, padding, radii, colours and font sizes. Translate it to Tailwind and React. Don't invent spacing.
3. Use `get_tree_summary` or `get_children` to find child node ids for sections, then `get_computed_styles` on any node whose values are unclear.
4. Call `get_tokens` for the design tokens (listed below).
5. After building a screen, screenshot the running page at 1440px wide and compare it side by side with the Paper screenshot. Fix differences above about 4px or any colour or weight mismatch.

## 2. Design tokens

Add these as CSS variables in `styles/theme.css` and Tailwind theme keys. The app becomes dark-first.

| Token | Value | Use |
|---|---|---|
| bg | `#0A0B0C` | page |
| surface | `#111315` | cards, inputs |
| surface-2 | `#181A1D` | hover, selected rows, active nav |
| line | `#1F2226` | dividers, card borders |
| line-strong | `#2A2E33` | input borders, outline pills |
| text | `#F2F3F4` | primary text |
| muted | `#8B9097` | secondary text |
| faint | `#5C6168` | tertiary, axis labels |
| pink | `#E8A6C8` | brand accent A |
| cyan | `#9FE3E6` | brand accent B, links, focus |
| good | `#4ADE80` | ok / in range |
| warn | `#FBBF24` | due / watch |
| alert | `#F87171` | overdue / out of range |
| button-light | `#E4E6E8` | primary button fill, active nav pill |

- **Type:** Inter. Page title 32/600, tracking −0.03em. Hero numbers 48–64/600. Card title 15/600. Body 14. Meta 12–13 muted.
- **Shapes:** cards use radius 20 with a 1px `line` border on `surface`. Pills and buttons use radius 999. Inputs use radius 14.
- **Signature element:** the gradient-outline pill. Wrap the pill in a 1.5px padding box with `linear-gradient(120deg, pink, cyan)`, and give the inner element a `surface` background. The primary variant uses a `button-light` fill with dark text.
- **Charts:** use recharts. Lines are 2px with no dots, grid lines use `line`, there are no axes boxes, and series use cyan and pink.
- **Icons:** lucide-react, 18px, stroke 2.

## 3. Screen to route map

| Artboard | Node | Route(s) to rebuild |
|---|---|---|
| _Shell (sidebar + top bar) | 7Z-0 | `components/Layout.js`, `Sidebar.js`, `Header.js` (build this first) |
| 01 Home | 1-0 | `/dashboard` |
| 02 Cages | IH-0 | `/cages`, `/units` |
| 03 Cage detail | QW-0 | `/cages/[id]`, `/units/[id]/*` |
| 04 Daily entry | 125-0 | `/daily-entry`, `/daily-data`, `/water-entry` |
| 05 Sampling & growth | 192-0 | `/biweekly-entry`, `/biweekly-records`, `/cages/analytics/growth` |
| 06 Stocking & transfers | 1GY-0 | `/stocking`, `/stocking-management`, `/fish-transfers`, `/topup` |
| 07 Health & water | 1SF-0 | `/health`, `/water-quality` |
| 08 Harvest | 209-0 | `/harvest`, `/harvest-sampling`, `/cages/analytics/harvest` |
| 09 Feed & inventory | 27R-0 | `/feed-management/*`, `/inventory/overview`, `/stock-levels` |
| 10 Finance P&L | 2FB-0 | `/pnl` |
| 11 Reports | 2QB-0 | `/reports`, `/report` |
| 12 My tasks | 2X7-0 | `/tasks` |
| 13 Hatchery | 332-0 | `/hatchery/*` |
| 14 Settings: Team | 38C-0 | `/users`, `/teams` (use the settings sub-nav from 22/23) |
| 15 / 15b Sign in | 50X-0 / 54F-0 | `/login` (email and phone-OTP states) |
| 16 Onboarding | 4U7-0 | `/register-company` and first-run setup |
| 17 Ask PBA | 3UX-0 | `components/AiAssistant.js` (full page) |
| 18 Calendar | 40N-0 | new `/calendar` (tasks, schedules, withdrawal ends) |
| 19 Cost accounting | 48S-0 | `/expenses`, `/accounting-export` |
| 20 Projects | 4HK-0 | new (tasks grouped by cycle) |
| 21 Workflow automations | 4O7-0 | `/automations` (motion: `automation-flow.html`) |
| 22 Roles & permissions | 57B-0 | `RolesPanel.js` / roles settings |
| 23 Member access | 5OB-0 | `MembersPanel.js` member detail |
| 24 Sales & invoices | 98M-0 | `/sales`, `/invoices/[id]` |
| 25 Approvals | 8V6-0 | `/approvals`, `/pending-approval` (Expenses and Access-request tabs are proposals, not in code yet) |
| 26 Lot traceability | 91T-0 | `/trace`, `/trace/[lotId]` |
| 27 Compliance & biosecurity | 9GK-0 | `/compliance` (logs, findings, withdrawal holds, checklist templates) |
| 28 Sensors & IoT | 9OW-0 | `/sensors` (live tiles, devices, alert rules) |
| 29 Procurement | 9XM-0 | `/procurement`, `/feed-purchases`, `/feed-suppliers` |
| 30 Notifications | A4K-0 | `/notifications` and delivery preferences |
| 31 Account & security | ACU-0 | `/account` (passkeys, TOTP, sessions, export, delete) |
| 32 Customization | AJU-0 | `/customization` (form layouts, custom fields, terminology) |
| Website: Landing 1440 | 3I0-0 | `/` (`pages/index.js`) |

## 3b. Light theme

Paper page **Light theme** has light versions of 01 Home (6E2-0), 02 Cages (6LO-0), 03 Cage detail (6TL-0), 10 Finance (7R0-0), 15 Sign in (7YE-0), 21 Automations (74T-0) and 22 Roles (7BH-0). Same layout, only the tokens change. Implement it as a `[data-theme="light"]` override of the CSS variables:

| Token | Dark | Light |
|---|---|---|
| bg | #0A0B0C | #F5F6F7 |
| surface | #111315 | #FFFFFF |
| surface-2 | #181A1D | #EEF0F2 |
| line | #1F2226 | #E5E8EB |
| line-strong | #2A2E33 | #D5D9DE |
| text | #F2F3F4 | #0E1012 |
| muted | #8B9097 | #5F656D |
| faint | #5C6168 | #8A9098 |
| button (primary fill) | #E4E6E8 | #0E1012 (white text) |
| pink text / fill | #E8A6C8 | #B83F7E / #D86AA6 |
| cyan text / fill | #9FE3E6 | #12838A / #3BB3BA |
| good / warn / alert | #4ADE80 / #FBBF24 / #F87171 | #15803D / #B45309 / #DC2626 |

Shadows in light: `0 1px 2px #1018281A`. Gradient outlines keep the same stops at lighter fill.

## 4. Not designed yet

Build these with the shell and components from the screens above. Don't invent new visual language.

- **Approvals & governance:**
  - `/audit-logs` (with `AuditChainStatus`).
  - Data export and deletion requests (`convex/governance.ts`).
  - Act-as / impersonation banner (`ActAs.js`).
- **Equipment:** `/maintenance`, `/units/[id]/maintenance` (equipment inspections), `/units/map`.
- **Org structure:**
  - `/organization-structure` and `/units/groups` (business units, site assignment).
  - `/farm-locations`.
  - Company links / group reports (`/group-reports`, `/reports/regions`).
- **Inventory detail:** `/inventory/items|lots|counts|adjust|analytics`, `/inventory-alerts`, `/inventory-transactions`, `/feed-issue`, `/feed-types`, `/feeding-plans`.
- **Production extras:** `/grading`, `/inspection-entry`, `/bulk-upload` (CSV import), `/cages/qr-codes`, `/scan`, `/species`, `/workforce`.
- **Integrations:**
  - `/webhooks`, `/inbound-webhooks`, `/api-keys`, `/api-docs`.
  - `/messaging-settings`, `/outbox` and offline sync (`OutboxSync`).
  - `/ai-settings` (bring your own key, quota).
- **Account & auth states:**
  - `/signup`, `/verify-email`, `/verify`, `/reset-password`, `/invite/[token]`, human check.
- **Platform admin:** `/admin/*`, company registrations, `/global-settings`.
- **System pages:** 404, maintenance, empty, loading and error states.
- **Mobile:** `MobileTabBar` and field-staff entry flows. The designs are desktop 1440 only.

Role model changes behind 22/23 are listed in [ROLES-CLEANUP.md](./ROLES-CLEANUP.md). Build the UI against today's roles first.

## 5. Rules for the build agent

- **UI only.** Keep every Convex query, mutation, permission check and hook as is. Re-skin the components and don't change the data flow.
- Read `convex/_generated/ai/guidelines.md` before touching anything in `convex/`. Ideally, don't touch it at all.
- **Order of work:**
  1. Tokens.
  2. Shell (7Z-0).
  3. Shared primitives: Card, GradientPill/Button, Pill (tones: pink, green, cyan, neutral, amber, red), KpiStrip, Tabs, DataTable, Toggle, Field, SegmentedControl.
  4. Screens, one per PR.
- **Sample data in the designs is illustrative.** Bind to real data. Where the design shows a metric the backend doesn't provide, leave a TODO; don't fake it.
- **Respect permissions.** Hide actions the user can't perform (`convex/lib/permissionCatalog.ts`).
- **Check each screen** with `npm run lint`, `npm test`, and a 1440px screenshot compared against `get_screenshot`.
- **After code changes,** run `graphify update . && npm run graph:convex-edges`.

## 6. Prompt to give the build agent

> You are rebuilding the PBA Farm web UI to match a Paper design exactly. Paper Desktop is open with file `01M7RD5Z2VX87M2KSRH9YKX8XA`, and you have the Paper MCP tools.
>
> Read `docs/design/paper-redesign/HANDOFF.md` first and follow it.
>
> Start with tokens, then the app shell (node 7Z-0), then shared primitives, then screen **[NAME / NODE ID]** mapped to **[ROUTE]**.
>
> For every element, use `get_jsx` and `get_computed_styles` from Paper as the spec. Don't approximate spacing, colours or font sizes.
>
> Keep all existing Convex data hooks and permission checks. This is a visual and UX re-skin only.
>
> When finished:
> - Screenshot the page at 1440px and compare it with Paper `get_screenshot`.
> - List any remaining differences.
> - Run lint and tests.
> - Open one PR per screen.
