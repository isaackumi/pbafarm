# 11 — Mobile User Experience Audit (field workers)

Discovery stage: PART 8 (Phase Five), mobile half. The design-system/component half is in `10-frontend-and-design-system-audit.md`.
Branch audited: `docs/discovery`. No code was changed and no dev server or build was run. Tap counts are worked out by reading the components, not by using a device, so they carry a confidence rating. Bundle sizes come from a `.next` build output that was already on disk (`BUILD_ID 1Cm1sKbWGGTEzNVrQi_Mk`). It may be slightly older than the working tree.

## Stage header

**Objective.** Decide whether the app can really be used by people recording data beside ponds and cages: cheap Android phones, direct sunlight, weak or no signal, wet or gloved hands, one hand free. Measure how many taps and keystrokes the common records take, check what works offline, and rank the worst friction points with evidence.

**Files inspected.** `components/DailyUploadPage.js` (all of it), `lib/offlineOutbox.js`, `hooks/usePersistedForm.js`, `public/sw.js`, `public/manifest.webmanifest`, `pages/_document.js`, `pages/_app.js`, `contexts/AuthContext.js`, `contexts/LocationContext.js`, `lib/convexBridge.js`, `lib/cageService.js` (`getActiveCages`), `lib/databaseService.js` (`dailyRecordService`), `components/Layout.js`, `components/MobileTabBar.js`, `components/Header.js`, `components/Sidebar.js`, `components/Toast.js`, `components/AiAssistant.js` (position), `components/ui/index.js`, `components/BiweeklyEntryForm.js`, `pages/biweekly-entry.js`, `components/HarvestForm.js`, `pages/harvest.js`, `components/FeedPurchaseModal.js`, `pages/feed-purchases.js` (entry points), `components/FishTransferForm.js`, `pages/fish-transfers.js`, `components/StockingForm.js`, `pages/feed-issue.js`, `pages/cages/qr-codes.js`, `pages/cages/[id].js` (links), `components/QuickCreateModals.js` (`ModalShell`), `styles/theme.css`, `styles/globals.css`, `.next/build-manifest.json` and the chunks it lists. `convex/feed.ts` (`createIssue` → `recordOutboundUsage`, `:609-722`) was opened only to answer a question about the Feed tab.

**Findings.** Sections 1–9. Ranked friction list in section 10.

**Dependencies.** Offline/outbox design feeds `architecture/08-mobile-and-offline-architecture.md` (not written yet). Shared-device data leakage overlaps `07-authentication-and-authorization.md`. Feed stock effects overlap `08-aquaculture-business-logic.md`.

**Risks.** Section 11. **Outstanding questions.** Section 12.

**Completion status.** Complete for code-level analysis. **Not verified on a device**: real keyboard "Next" behaviour, how WebAPK handles links, sunlight readability, and real network timings. These are marked "Unknown – requires verification".

---

## 1. Bottom line

The app is **usable on a phone for one task: daily feed and mortality entry**. That screen (`components/DailyUploadPage.js`) was clearly built for field use. It has a multi-cage batch, a "Same as yesterday" button, 16 px numeric inputs, a draft that survives closing the tab, cage QR codes, and an offline outbox. Everything else (bi-weekly sampling, harvest, purchases, transfers, stocking) is a desktop form squeezed onto a narrow screen. Those forms are reached through a 39-item drawer, have no offline support, and most of them have no draft safety.

The offline story also has a basic gap. The outbox works only if the page was **already loaded and signed in** when the signal dropped. If the app is opened with no signal, it is very likely stuck on the loading skeleton, because the auth gate waits for a Convex server round trip (§5.1). So the main promise of "works beside the pond" is only partly kept.

## 2. Responsive foundation

| Check | Finding | Evidence | Status |
|---|---|---|---|
| Viewport meta | None declared in `_document.js` or any page. Next.js pages router injects a default `width=device-width`. | grep `viewport` → none | Working by default (Medium) |
| Breakpoints | Shell switches at `lg` (1024 px): drawer + bottom tab bar below that. Forms use `grid-cols-1 md:grid-cols-2`. | `Layout.js:101-107`, `MobileTabBar.js:21` | Working |
| Bottom safe area | Tab bar pads `env(safe-area-inset-bottom)`; `<main>` has `pb-24` | `MobileTabBar.js:21`, `Layout.js:107` | Working |
| Input font size | `Input/Select/Textarea` use `text-base` (16 px) and `min-h-11` (44 px) | `components/ui/index.js:251-253` | Working |
| Exceptions | Header location `<select>` is `text-sm h-10` (`Header.js:121-123`); `DataTable` search, some raw inputs in `company-settings.js` | — | Minor (iOS zoom; Android does not zoom) |
| Loading skeleton | Desktop layout (fixed 256 px sidebar) on every cold start | `components/ui/index.js:386-405` | Defective on phones |
| Tables | Horizontal scroll only, no card layout, on every list page | doc 10 §5 | Poor |
| Print | QR sheet has print styles | `pages/cages/qr-codes.js:78` | Working |

## 3. Tap targets, inputs and keyboards

- **Primary buttons**: `Button size="lg"` = 48 px, `md` = 44 px (OK). **`size="sm"` = 36 px**, and it is used for important field actions on daily entry: "Select all open", "Same as yesterday", "Clear all", "Remove" (per line), "Add line", "Apply to all lines", "Send now", "Discard" (`DailyUploadPage.js:479, 494, 566, 651-671, 766-774, 829-836`). The kg/Bags `TabBar` buttons are also 36 px (`ui/index.js:146`).
- **Cage chips** on daily entry: `min-h-11 min-w-[5.5rem]` (44 × 88 px) (`DailyUploadPage.js:627`). OK.
- **Checkboxes** are 16 px (`h-4 w-4`). They sit inside a 44 px `<label>`, so the label is tappable (`:583-592`). OK.
- **Destructive and benign actions side by side**: "Remove" sits in the same card as the qty/mortality inputs (`:765-775`), with no undo. "Clear all" (`:663-667`) wipes every line with no confirmation. "Discard" on a failed outbox batch (`:492-501`) has no confirmation either.
- **Numeric keyboards**: daily entry sets `inputMode="decimal"`/`"numeric"` on every number (`:743, 756, 797, 809`). Only one other component sets `inputMode` (`HarvestForm` grade inputs, `:449`). In total 87 `type="number"` inputs exist, and Android Chrome shows a numeric keypad for `type="number"` anyway. The real costs of `type="number"` are elsewhere: the mouse wheel and trackpad change values, and Samsung keyboards may hide the decimal key without `inputMode="decimal"` (Unknown – requires verification).
- **Keyboard "Next" order on daily entry**: Cage `<select>` → Feed type `<select>` → Feed qty → Mortality → (Cause `<select>`) → DO/Temp → Notes → next line's Cage `<select>`. Every line puts two selects before the two numbers the worker actually types, so "Next" on the keypad is not a fast path. Whether Android IME "Next" skips `<select>` is Unknown – requires verification.
- **No steppers, no voice input, no large-number pad, no barcode/QR scanner inside the app.** Scanning relies on the phone's camera app (§7).

## 4. Task walkthroughs (tap and typing counts)

Assumptions: the user is signed in, a site is selected, and the app is open on the Home tab unless stated. A "tap" is a touch on a control. Choosing from a native `<select>` counts as 2 taps (open + choose). "Keys" are keystrokes for typical values (feed 2–3 digits, ABW 3, counts 4–5, weights 4–5, prices 3–4). Scrolling is listed separately. Confidence: **Medium** (code reading, not timed on a device).

### 4.1 Daily feed + mortality for N cages (`/daily-entry`, `components/DailyUploadPage.js`)

Entry point: the **"Daily entry" bottom tab** (`MobileTabBar.js:7`), or opening the installed PWA directly (`start_url: /daily-entry`, `manifest.webmanifest:5`).

| Step | Taps | Keys | Evidence |
|---|---|---|---|
| Open daily entry | 1 (0 if launched from the PWA icon) | | |
| Default feed type (first use only, then remembered in the local draft) | 2 | | `:548-564`; `resetForm` keeps it, `:385-394` |
| "Select all open" (adds a line per unlogged active cage) | 1 | | `:214, 651-658` |
| Per cage: tap feed qty, type it | N | ~3N | `:740-750` |
| Per cage with deaths (M cages): tap mortality, type, choose cause | 3M | ~1–2M | `:753-790` |
| Save (bottom of form, not sticky) | 1 | | `:902-912` |

- **Path A, typing every cage (N = 20, M = 2):** about **25 taps + ~64 keys**. Each line card on a phone stacks Cage select, Feed type select, Qty + Mortality, a Remove button, and Notes. That is about 400 px per cage, so roughly one cage per screen on a 360 × 640 phone once the header (64 px), tab bar (64 px) and browser chrome are taken off. **20 cages ≈ 8,000 px of lines + ~900 px of header, defaults and chips.** The Save button is only reachable at the end. Estimate, Medium confidence.
- **Path B, "Same as yesterday" (`:247-285`) when amounts did not change:** 1 (tab) + 1 (copy) + 3M (mortality) + 1 (save) = **about 9 taps for 20 cages with 2 mortality lines**, plus scrolling to the bottom. This is the best flow in the app.
- **Path C, QR sticker per cage:** scan opens `/daily-entry?cage=<id>` (`qr-codes.js:27`), which adds that cage to the current draft (`DailyUploadPage.js:189-202`). Doing 20 cages means 20 camera launches, and each scan may open a **new browser tab** with its own copy of the draft. The two copies overwrite each other through `localStorage` (doc 10 §7.2). Whether an installed WebAPK captures these links is Unknown – requires verification.
- **Data-quality traps:** "Leave a field blank for 0" (`:684`). A skipped feed qty is saved as **0 kg fed**, and validation does not warn (`:326-331`). The submit button is disabled whenever stock is short and the user is not an admin (`:904`). A field worker therefore cannot save mortality for any cage while one feed type is short, and has to remove or zero the feed lines first.

### 4.2 Bi-weekly sampling for one cage (`/biweekly-entry`, `pages/biweekly-entry.js` + `components/BiweeklyEntryForm.js`)

| Step | Taps | Keys | Evidence |
|---|---|---|---|
| "More" tab → drawer → "Bi-weekly Entry" (3rd item in Production) | 2 | | `MobileTabBar.js:47-57`, `Sidebar.js:56` |
| Find the cage in a card grid (search/filters optional), tap its card | 1 (+ scrolling; + search 1 tap + ~3 keys) | | `biweekly-entry.js:257-267` |
| Date (pre-filled) and batch code (auto-generated) | 0 | | `BiweeklyEntryForm.js:30-31` |
| Optional water quality: DO, temp, secchi | 0–3 | 0–9 | `:246-275` |
| Per sample S: fish count, total weight (g) | 2S | ~7S | `:313-350` |
| "Add sample" for each extra sample | S−1 | | `:284-286` |
| Save | 1 | | `:360` |

- **One cage, 3 samples:** 2 + 1 + 6 + 2 + 1 = **12 taps + ~21 keys**. After saving, the form returns to the cage grid after 500 ms (`:150-152`), so **20 cages ≈ 2 + 20 × 10 = ~200 taps** and ~420 keys. There is no multi-cage batch like daily entry has.
- `/biweekly-entry?cage=<id>` links from the cage page are **ignored** (`pages/biweekly-entry.js` never reads `router.query`), so the worker always has to pick the cage again. QR codes only go to daily entry.
- **No draft persistence** (`useState` only, `:27-37`). A refresh, back gesture or app switch that reloads the page loses the samples. **No offline support.**

### 4.3 Recording a harvest (`/harvest` → `components/HarvestForm.js`)

| Step | Taps | Keys |
|---|---|---|
| "More" → "Harvest Data" | 2 | |
| Open the harvest form (button on `/harvest`, `pages/harvest.js:59`) | 1 | |
| Cage select | 2 | |
| Date (today, but fixed when the module loaded), type (`complete` default) | 0 | |
| Total weight (kg) | 1 | ~4 |
| ABW (g) | 1 | ~3 |
| Count: auto-derived from total/ABW if blank (`:144-147`) | 0 | |
| FCR: auto-filled from the server calculation if blank (`:148-152`) | 0 | |
| Size grades (5 optional inputs) | 0–5 | 0–20 |
| Save → preview → Confirm | 2 | |

**About 9 taps + ~7 keys** in the simple case. This is reasonable. The weak points: validation errors appear **only as a 5-second toast** at the bottom of the screen (`:173-175`), which can be missed and may sit behind the tab bar (§8). The form uses a session-only draft (`harvest-create`), and there is no offline support.

### 4.4 Recording a feed purchase (`/feed-purchases` → `components/FeedPurchaseModal.js`)

| Step | Taps | Keys |
|---|---|---|
| "More" → expand/scroll to Feed → "Purchases" | 2 (+ scrolling) | |
| "Record purchase" | 1 | |
| Supplier select | 2 | |
| Date (today, pre-filled) | 0 | |
| Feed type select | 2 | |
| Number of bags, price per bag (₵) | 2 | ~6 |
| Bag size preset (10/20/25 kg) if not the default | 0–1 | |
| **"Add entry"** (must be pressed before Save) | 1 | |
| Save | 1 | |

**About 11 taps + ~6 keys** for one line. The trap: if the worker fills in feed type, bags and price and taps Save without "Add entry", they get the toast "Please add at least one feed entry" and nothing is saved (`FeedPurchaseModal.js:132-140`). Each entry is saved with its own `createPurchase` call, so a failure partway leaves a partial purchase. Data lives only in `useState`, so closing the modal loses it. The `/feed-purchases` page that opens the modal is 1,743 lines with recharts (heavy, see §9).

### 4.5 Fish transfer (`/fish-transfers` → `components/FishTransferForm.js`)

| Step | Taps | Keys |
|---|---|---|
| "More" → "Fish Transfers" | 2 | |
| Date (pre-filled) | 0 | |
| ABW | 1 | ~3 |
| Source cage select (active cages with fish only) | 2 | |
| Destination cage select | 2 | |
| Quantity (or tick "full transfer", which copies the source count, `:105, 114`) | 1 | 0–5 |
| Supervisor (optional `PersonPicker`) | 0–2 | |
| Save | 1 | |

**About 9 taps + ~3–8 keys.** None of the 7 `Field`s on this form has `htmlFor`, so tapping a label does not focus its input (doc 10 §7.1). The form has a session draft and no offline support. Because the page uses reactive `useQuery`, a save attempted while offline may hang on "Saving…" rather than fail (doc 10 §13; Medium confidence).

### 4.6 Stocking (`/stocking` → `components/StockingForm.js`)

| Step | Taps | Keys |
|---|---|---|
| "More" → "New Stocking" (last item in Production) | 2 | |
| Cage select | 2 | |
| Batch number (auto-suggested, `:83`), date (pre-filled), species (`nile_tilapia` default) | 0 | |
| Fish count, ABW | 2 | ~8 |
| Source location, transfer/sampling supervisors (optional) | 0–6 | |
| Save | 1 | |

**About 7–13 taps + ~8 keys.** Reasonable. After saving, the stocking may need admin approval before the cage becomes active, and daily entry only lists active cages. The `DependencyEmpty` message explains this (`DailyUploadPage.js:600`).

### 4.7 Summary

| Task | Taps (typical) | Keys | Nav depth | Offline | Draft survives reload |
|---|---|---|---|---|---|
| Daily entry, 20 cages, typed | ~25 | ~64 | tab bar (1) | **Yes (outbox)** | Yes (localStorage) |
| Daily entry, 20 cages, "same as yesterday" | ~9 | ~4 | tab bar (1) | Yes | Yes |
| Bi-weekly, 1 cage × 3 samples | ~12 | ~21 | drawer (2) | No | **No** |
| Bi-weekly, 20 cages | ~200 | ~420 | drawer (2) | No | No |
| Harvest | ~9 | ~7 | drawer (2) + button | No | Session only |
| Feed purchase (1 line) | ~11 | ~6 | drawer (2) + modal | No | **No** |
| Fish transfer | ~9 | ~3–8 | drawer (2) | No (may hang) | Session only |
| Stocking | ~7–13 | ~8 | drawer (2) | No | Session only |

## 5. Offline behaviour

### 5.1 Cold start without signal: very likely blocked

`AuthWrapper` (`pages/_app.js:112-116`) and `ProtectedRoute` show `AppShellSkeleton` while `loading || !initialized`. `loading = isLoading || (isAuthenticated && convexUser === undefined)` (`contexts/AuthContext.js:55-56`). `isLoading` comes from `useConvexAuth()`, and `convexUser` from `useQuery(api.users.current)`. Both need the Convex WebSocket to answer. With no network, the service worker can serve cached HTML and JS (§6), but the page renders the skeleton indefinitely, and `DailyUploadPage` and its outbox never mount. **Status: Implemented but potentially defective. Confidence Medium-High** (based on how Convex auth state works; not run on a device). This is the most important mobile finding.

### 5.2 Signal lost mid-session: works for daily entry only

| Form | Offline handling | Evidence |
|---|---|---|
| `DailyUploadPage` | If `navigator.onLine === false` or the error looks like a network error, the batch goes to the `localStorage` outbox and the form resets. It flushes on the `online` event, on mount, and from a "Send now" button. Server rejections stay in the queue with `lastError` and a "Discard" button. Lookups (cages, feed types) fall back to the last cached copy. | `:425-447, 348-381`; `lib/offlineOutbox.js` |
| All other forms (`BiweeklyEntryForm`, `HarvestForm`, `FeedPurchaseModal`, `FishTransferForm`, `StockingForm`, `TopUpForm`, `SamplingForm`, `harvest-sampling`, `feed-issue`, `health`, `sales`, QuickCreate modals) | None. HTTP-client forms show an error ("Failed to fetch" text cleaned or raw). `useMutation` forms queue the write in memory and wait (lost if the tab closes). | grep `offlineOutbox` → only `DailyUploadPage.js` |

Limits of the outbox:
- **It only flushes while `/daily-entry` is open.** The listeners live in the component (`:364-381`). There is no Background Sync, and the service worker does not touch it (`sw.js:2-3`).
- **It is not scoped to user or company.** There is a single key `pbafarm:outbox:daily-batch` (`offlineOutbox.js:8`). If someone else signs in on the same phone, the queued batches are sent **under the new user's identity**. Nothing clears the outbox on sign-out.
- The payload has no `locationId` and no client id, so a retried batch after a partial success relies on the server's duplicate check ("already logged") rather than an idempotency key. A batch whose response was lost will come back as an error item that the worker has to discard by hand. Medium confidence on server behaviour (see doc 08).
- `localStorage` is size-limited and synchronous, and a failed write is silently ignored (`offlineOutbox.js:26-28`).
- The lookups cache key `pbafarm:daily-entry:lookups` is not scoped by location. After switching site while offline, the previous site's cages can be shown.
- Detection depends on error-message regexes (`isNetworkError`, `:52-58`). A Convex error text that doesn't match (for example a WebSocket/HTTP 5xx from a proxy) is treated as a data error and not queued.

### 5.3 Dates offline and across time zones

"Today" is `new Date().toISOString().split('T')[0]` (UTC) in 31 places, including `DailyUploadPage.js:36` and its `max` attribute (`:541`). In Ghana (UTC+0) this is invisible. On a farm at UTC+3 between 00:00 and 03:00, or at UTC−5 after 19:00, the default date and the maximum allowed date are off by one day.

## 6. Service worker and PWA

### 6.1 `public/sw.js` (60 lines)

- Registered only in production (`_app.js:28-37`).
- **Install:** pre-caches `/daily-entry`, `/dashboard`, the manifest and `icon.svg` (`:6-12`). It does **not** pre-cache their JS chunks, which are cached only after a page has actually been visited online.
- **Static assets** (`/_next/static/*`, svg/png/ico/woff): cache-first, cached forever (`:31-44`).
- **Navigations:** network-first, cache the response, fall back to the cached page and then to `/daily-entry` (`:47-58`).
- **Skipped:** non-GET, cross-origin (Convex, Google Fonts), `/api/*`.
- **Defects:** `VERSION = 'pbafarm-v1'` is constant (`:5`), so old hashed chunks from every deploy pile up in one cache and are never removed. On a cheap phone with little storage that grows without limit. Navigation responses are cached without checking `res.ok`, so a cached 500 or redirect page can be served offline. There is no update prompt, and `skipWaiting` + `clients.claim` can switch a running page to new chunks mid-session (low risk with hashed chunks).
- **What works offline:** the HTML and JS for pages visited before, served from cache. Data does not, and auth does not (§5.1). In practice, offline is useful only for a session that was already open.

### 6.2 Manifest and installability (`public/manifest.webmanifest`)

| Field | Value | Note |
|---|---|---|
| `name`/`short_name` | "PBA Farm" | Hard-coded company brand; not per tenant. |
| `start_url` | `/daily-entry` | Good for field workers. |
| `display` | `standalone` | |
| `icons` | Only SVG (`icon.svg` any, `icon-maskable.svg` maskable) | Chrome's install criteria have historically needed 192 and 512 px icons. SVG `sizes:"any"` support differs by version. **Installability on older Android Chrome: Unknown – requires verification.** `apple-touch-icon` points to an SVG (`_document.js:9`), which iOS does not use. |
| `id`, `screenshots`, `description` | `description` present; no `id`, no `screenshots` | Minor (richer install UI on Android). |
| `shortcuts` | Daily entry, Dashboard (no icons) | |

## 7. QR cage codes

- `pages/cages/qr-codes.js` builds an SVG QR for every non-inactive cage encoding `${window.location.origin}/daily-entry?cage=<convexId>` (`:23-34`), shown in a printable 2/3/4-column grid.
- **Scan landing:** daily entry adds the cage as a line once lookups load (`DailyUploadPage.js:189-202`). If the cage is unknown, inactive, not stocked, or already logged for that date, it is **silently ignored** with no message.
- **Fragility:** codes contain the **origin at print time** (a preview or localhost print gives dead stickers) and the raw Convex document id (no short code, not re-printable after a data migration that changes ids). They only lead to daily entry, not to sampling, harvest, transfer or the cage page.
- **Cold-start cost:** each scan on a phone where the app isn't open costs a full app boot (≈200 KB gzipped JS + fonts + auth round trip; §9), and it fails offline (§5.1).

## 8. Sunlight, one-handed use and visual feedback

- **Text contrast is good** (computed from tokens): body ink on white is very high, `--muted` 7.7:1, `--lake` 6.9:1, `--signal` 4.8:1, `--kelp` 5.0:1. Plenty of text is still `text-xs` (12 px): hints, "Logged" on chips, line stock summaries.
- **Edges disappear in sunlight:** input borders `#d4d4d8` on white are 1.48:1, and card/line borders `#e4e4e7` are 1.27:1 (`theme.css:8, 29`). In glare, the bordered line cards and input boxes on daily entry will be hard to tell apart. There is no high-contrast or outdoor theme, and the theme toggle is hidden on phones (`Header.js:242`).
- **Status relies on colour in places:** a short stock line turns red and adds ", not enough stock" (text, good). The Waterline bar is a 4 px `bg-lake` strip (low salience in sun). The `HealthMeter` uses amber at 2.15:1.
- **Thumb zone:** primary actions are at the end of long forms, not in a sticky footer (`FormActions` is static, `ui/index.js:359-367`). The tab bar sits in the thumb zone, but on phones two floating layers cover it:
  - **Toasts** at `fixed bottom-0 right-0 z-50` (`Toast.js:35`) render on top of the tab bar (`z-30`), and all form errors in `HarvestForm` and `FeedPurchaseModal` are toasts.
  - **AI assistant button** at `fixed bottom-6 right-6 z-50 h-14 w-14` (`AiAssistant.js:234`). When AI is enabled for the company, it covers most of the **"More"** tab (the right-most fifth of a 360 px bar), which is the only way to reach the drawer on a phone.
- **Accidental dismissal:** QuickCreate modals close on a backdrop tap or Escape and lose what was typed (`QuickCreateModals.js:46`). The same goes for `ConfirmDeleteModal` (`:23`). On a wet screen this is easy to trigger.
- **Drawer:** 39 links, all sections expanded by default (`Sidebar.js:150-158`). Reaching "New Stocking" or "Purchases" takes scrolling inside the drawer. The drawer has no Escape/swipe-to-close and does not lock the page scroll behind it.
- **Location switching** reloads the whole app (`LocationContext.js:70-72`). On a slow network that is the most expensive action in the app, and it sits in the header next to the title, where it is easy to hit by mistake.

## 9. Bundle weight and data usage

Measured from the existing `.next` build (gzip level 6, JS only):

| Route | Route-specific JS (gz) | Total JS incl. shared `_app`/framework (gz) |
|---|---|---|
| Shared (`_app` + framework + main + webpack) | — | **172 KB** (`_app` chunk alone 78 KB: Convex client, Redux + redux-persist, driver.js tour, tour copy, contexts, lucide icons) |
| `/daily-entry` | 31 KB | **203 KB** |
| `/dashboard` (Home tab) | 123 KB (recharts) | **295 KB** |
| `/cages` (Cages tab) | 122 KB (recharts) | **294 KB** |
| `/feed-issue` (Feed tab) | 24 KB | 196 KB |
| `/feed-purchases` | 142 KB | 314 KB |
| `/export` | 127 KB (xlsx) | 299 KB |
| `/biweekly-entry`, `/fish-transfers`, `/harvest`, `/stocking` | 16–29 KB | 188–201 KB |

Plus CSS 13 KB gz, plus 8 Google Fonts faces (not cached by the SW).

Observations:
- Two of the four bottom tabs (Home, Cages) pull in **recharts** (~120 KB gz) because charts are imported statically (`components/Dashboard.js:14`, `pages/cages/index.js:21`). Only `AiAssistant` uses `next/dynamic` (`_app.js:24-26`).
- `driver.js` and its CSS, plus 515 lines of tour copy, ship in `_app` to every user on every page.
- **Runtime data:** imperative screens re-download full lists on every mount and after every save (`DailyUploadPage.loadLookups`: all active cages + all feed types + site stock levels; `:98-140, 441-443`). Changing location reloads everything. Daily entry also calls `listForDate` on every date change. There is no pagination on most lists (doc 10 §5). For a prepaid data plan, the Home tab plus daily entry are the costliest routine path. JS is cached after the first visit, so the ongoing cost is mostly data queries and fonts.
- Plain `<img>` is used for the company logo (`Sidebar.js:263`); there is no image optimisation, but there are few images.

## 10. Top 10 mobile friction points (ranked)

| # | Friction | Severity | Evidence | Confidence |
|---|---|---|---|---|
| 1 | **Opening the app with no signal very likely never gets past the loading skeleton.** The auth gate waits for Convex, so the cached shell and the outbox are unreachable. | Critical | `_app.js:112-116`, `AuthContext.js:15-18, 55-56`, `ProtectedRoute.js:28-30` | Medium-High |
| 2 | **Only daily entry survives poor signal.** Bi-weekly, harvest, purchases, transfers, stocking, feed issue, health and sales have no outbox. Bi-weekly and purchases also have no draft, so a reload loses typed data. | High | grep `offlineOutbox` → 1 file; `BiweeklyEntryForm.js:27-37`, `FeedPurchaseModal.js:49-50` | High |
| 3 | **Offline data is not tied to a user.** Outbox, draft, lookups cache and persisted Redux are shared by whoever signs in next. Queued batches are sent under the next user's identity. | High | `offlineOutbox.js:8`, `usePersistedForm.js:3`, `DailyUploadPage.js:99`, `store/index.js:32-36`, `AuthContext.js:94-103` | High (code), Medium (impact) |
| 4 | **Daily entry for many cages is a very long scroll with a non-sticky Save.** About 400 px per cage on a phone, each card leading with two selects before the two numbers that matter. Blank feed silently becomes 0 kg. | High | `DailyUploadPage.js:690-836, 684, 895-913` | Medium |
| 5 | **Bi-weekly sampling is one cage at a time, with no deep link and no QR path.** About 10 taps per cage; `?cage=` is ignored; the cage is picked from a filterable card grid each time. | High | `pages/biweekly-entry.js:19, 257-267`; `pages/cages/[id].js` links; `BiweeklyEntryForm.js:150-152` | High |
| 6 | **Floating layers cover the bottom tab bar.** The AI button covers "More" (the only drawer entry on phones), and toasts carrying form errors render over the tab bar. | Medium-High | `AiAssistant.js:234`, `Toast.js:35`, `MobileTabBar.js:21` | High (layout), Medium (exact overlap) |
| 7 | **Everything except four screens is behind a 39-item drawer**, and the bottom bar is fixed and not configurable (Feed goes to "Issue feed", which is not where purchases or bi-weekly live). | Medium | `Sidebar.js:47-144`, `MobileTabBar.js:5-10` | High |
| 8 | **Sunlight legibility of edges.** Input and card borders are 1.3–1.5:1. There is a lot of 12 px helper text. There is no outdoor theme and no theme toggle on phones. | Medium | `theme.css:8, 29`; `Header.js:242` | Medium (not viewed outdoors) |
| 9 | **Small or risky touch targets for frequent actions.** 36 px `sm` buttons for Remove / Same as yesterday / Select all / Add line. "Clear all" and "Discard" have no confirmation. Backdrop taps close create modals and lose data. | Medium | `ui/index.js:5`, `DailyUploadPage.js:651-671, 663-667, 492-501`, `QuickCreateModals.js:46` | High |
| 10 | **Heavy first load and data use on cheap phones.** About 295 KB gz JS for the Home and Cages tabs (recharts), the tour engine on every page, full-list refetches after each save, full reload on location change, and the SW cache never cleaned. | Medium | §9; `sw.js:5, 31-44`; `LocationContext.js:70-72` | High (sizes from build), Medium (impact) |

Honourable mentions: the desktop-shaped loading skeleton (`ui/index.js:386-405`); the feed purchase "Add entry before Save" trap; harvest errors shown only as toasts; QR stickers that bake in the origin and silently ignore already-logged or inactive cages; UTC "today" outside UTC+0; the location `<select>` at 14 px.

## 11. Risks

1. **Data loss in the field** (findings 1–2) undermines trust in the records that drive FCR, mortality and stock figures. Workers fall back to paper and enter data in bulk later, which the bulk upload pages hint is already happening (`/bulk-upload`). High.
2. **Cross-tenant or cross-user writes from a shared device** (finding 3). High once more than one company or role shares phones.
3. **Silent zero-feed records** (blank = 0) skew FCR and feed-per-cage analytics. Medium.
4. **Retrofitting offline to the other forms** one at a time would copy the daily-entry pattern 10+ times. It needs a shared offline write layer (an architecture decision for `architecture/08`). Medium.
5. **Double stock deduction risk via the Feed tab.** The "Feed" bottom tab opens Issue Feed (`/feed-issue`), which records outbound usage (`convex/feed.ts:700-722` → `recordOutboundUsage`, source `issue`). Daily entry also deducts feed through the ledger (`DailyUploadPage.js:684`, source `daily`). If workers do both for the same cage and day, stock may be deducted twice. Medium confidence; business rule to confirm in doc 08.

## 12. Outstanding questions

1. Does a signed-in PWA really stay on the skeleton when started offline? Test on a device: install, sign in, use online once, enable airplane mode, cold start. (Finding 1.)
2. Which Android devices and Chrome versions do workers use? This decides SVG-icon installability, `inputMode` behaviour and how much the bundle size matters.
3. Do workers share phones between staff or between farms? This decides how urgent finding 3 is.
4. Is "Issue feed" meant to be used together with daily feed lines, or instead of them? (Risk 5.)
5. How many cages does one worker log per round, and do they log at each cage (QR one by one) or at the end (batch)? This decides whether to optimise the per-cage scan path or the batch path.
6. Is bi-weekly sampling done by the same field staff (needs a mobile batch flow) or by a supervisor at a desk?
7. Should blank feed mean "not fed" (0) or "not recorded"? The current UI says 0.
