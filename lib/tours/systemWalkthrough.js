/**
 * Detailed first-run / on-demand walkthrough of PBA Farm.
 * Steps with `route` cause navigation; `element` uses data-tour selectors.
 *
 * Description markup (parsed by formatTourDescription):
 *   **bold**   → strong emphasis
 *   ==highlight== → teal highlight mark
 */

export const SYSTEM_WALKTHROUGH_ID = 'system-walkthrough'

export const systemWalkthrough = {
  id: SYSTEM_WALKTHROUGH_ID,
  title: 'Full system walkthrough',
  description:
    'A detailed guided tour of setup, production recording, feed inventory, and approvals.',
  steps: [
    // ——— Welcome ———
    {
      route: '/dashboard',
      element: '[data-tour="app-shell"]',
      popover: {
        title: 'Welcome to PBA Farm',
        description:
          'This walkthrough explains how the farm system fits together—from creating ==cages== and ==feed stock==, to stocking fish, daily feeding, bi-weekly sampling, harvest, and inventory. You can leave anytime with **Esc** or **Close**, and restart from **Help → Start walkthrough**.',
        side: 'over',
        align: 'center',
      },
    },
    {
      route: '/dashboard',
      element: '[data-tour="sidebar"]',
      popover: {
        title: 'Main navigation',
        description:
          'Everything lives in this sidebar. Sections: **Production** (daily work), **Cages**, **Feed**, **Inventory**, **Reports**, and **Management** (admins). Collapse the sidebar with the chevron if you need more screen space.',
        side: 'right',
        align: 'start',
      },
    },
    {
      route: '/dashboard',
      element: '[data-tour="nav-section-production"]',
      popover: {
        title: 'Production section',
        description:
          'Day-to-day culture work: ==Dashboard==, ==Daily Entry==, Bi-weekly Entry/Records, Harvest, and Stocking. Most farm operators spend most of their time **here after setup**.',
        side: 'right',
        align: 'start',
      },
    },
    {
      route: '/dashboard',
      element: '[data-tour="header-title"]',
      popover: {
        title: 'Page context',
        description:
          'The header shows which screen you are on. Notifications (bell) surface **mortality alerts**, **low stock**, and **approval needs**. Use your profile menu to sign out.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      route: '/dashboard',
      element: '[data-tour="location-switcher"]',
      popover: {
        title: 'Farm location switcher',
        description:
          'If your company has multiple sites, switch ==active location== here. Cages, daily entry, sales, **feed purchases**, KPIs, and stock are scoped to the selected farm. Changing location reloads the page so numbers stay in sync. Admins manage sites under **Farm Locations**.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      route: '/dashboard',
      element: '[data-tour="theme-toggle"]',
      popover: {
        title: 'Light & dark theme',
        description:
          'Toggle ==light / dark mode== anytime. Your preference is saved on this device so the app stays readable day or night on the farm.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      route: '/dashboard',
      element: '[data-tour="tour-help"]',
      popover: {
        title: 'Restart this tour anytime',
        description:
          'Click ==Help== whenever you want to replay this walkthrough or jump back into onboarding.',
        side: 'bottom',
        align: 'end',
      },
    },

    // ——— Setup order ———
    {
      route: '/dashboard',
      element: '[data-tour="app-shell"]',
      popover: {
        title: 'Recommended setup order',
        description:
          'Before recording production, set up dependencies in this order: **1)** Create cages → **2)** Create feed types **and suppliers** → **3)** Record feed purchases (supplier required) so ==stock exists== at the active location → **4)** Stock cages with fish → **5)** Approve stockings if required → **6)** Then use ==Daily Entry==. Forms will guide you with create-modals if something is missing.',
        side: 'over',
        align: 'center',
      },
    },

    // ——— Cages ———
    {
      route: '/cages',
      element: '[data-tour="nav-cages"]',
      popover: {
        title: 'Cages — your production units',
        description:
          'Cages are physical units that hold fish. Status matters: ==empty / fallow / harvested== cages can be stocked; **active** cages appear in Daily Entry and Harvest.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/cages',
      element: '[data-tour="page-cages"]',
      popover: {
        title: 'Cage list',
        description:
          'Review all cages, open a cage for detail, and use edit/delete where allowed. Create new cages from **Create Cage** (or the quick-create modal inside stocking forms).',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/create-cage',
      element: '[data-tour="page-create-cage"]',
      popover: {
        title: 'Create a cage',
        description:
          'Give each cage a **unique name** and optional size/capacity/location. New cages start as ==empty== so they can be stocked. After create, go to **New Stocking**.',
        side: 'top',
        align: 'center',
      },
    },

    // ——— Feed setup ———
    {
      route: '/feed-types',
      element: '[data-tour="nav-feed-types"]',
      popover: {
        title: 'Feed types',
        description:
          'Feed types are products you buy and feed (e.g. Grower 32%). Each has **price/kg**, bag size (default ==20 kg==), minimum stock, and current ledger stock. You **cannot** record daily feed without a ==feed type==.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/feed-types',
      element: '[data-tour="page-feed-types"]',
      popover: {
        title: 'Manage feed catalog',
        description:
          'Add each commercial feed you use. Opening stock (if any) is posted through the inventory ledger. Prefer recording ==purchases== for accurate **cost tracking**.',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/feed-suppliers',
      element: '[data-tour="nav-feed-suppliers"]',
      popover: {
        title: 'Suppliers (required on purchases)',
        description:
          'Create the vendors you buy feed from **before** recording purchases. Every purchase ==requires a supplier== so spend and reliability stay accurate.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/feed-management',
      element: '[data-tour="nav-feed-management"]',
      popover: {
        title: 'Feed management hub',
        description:
          'Overview of feed types and suppliers. Use ==Feed Purchase== here or under Purchases to open the shared multi-entry purchase modal.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/feed-management',
      element: '[data-tour="page-feed-management"]',
      popover: {
        title: 'Live feed stats',
        description:
          'Cards show active feed types, suppliers, ==total stock==, and monthly usage for your farm. They refresh after purchases and feed-type edits.',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/feed-purchases',
      element: '[data-tour="nav-feed-purchases"]',
      popover: {
        title: 'Feed purchases = stock in',
        description:
          'Purchases **increase** inventory at the ==active location==. Daily entry and Issue Feed **decrease** it. If daily entry says ==Insufficient stock==, record a purchase first.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/feed-purchases',
      element: '[data-tour="feed-purchases-record"]',
      popover: {
        title: 'Record Purchase',
        description:
          'Opens the ==New Feed Purchase== modal: pick a **required supplier**, date, then add one or more feed lines (type, bags, price/bag). Bag size defaults to ==20 kg==—change only if this lot differs. Location is locked to the header selection.',
        side: 'bottom',
        align: 'end',
      },
    },
    {
      route: '/feed-purchases',
      element: '[data-tour="feed-purchases-kpis"]',
      popover: {
        title: 'Purchase KPIs (this location)',
        description:
          'Total cost, quantity bought, avg cost/kg, stock value, bags on hand, and feed age—all for the ==active location== only. Switch the header location to compare sites.',
        side: 'bottom',
        align: 'start',
      },
    },
    {
      route: '/feed-purchases',
      element: '[data-tour="feed-purchases-inventory"]',
      popover: {
        title: 'Current stock & reorder',
        description:
          'Per–feed-type stock at this location (with location badge), protein, bag size, and bags on hand. ==Reorder== suggestions appear when stock is near a configured minimum.',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/feed-purchases',
      element: '[data-tour="page-feed-purchases"]',
      popover: {
        title: 'Purchase history',
        description:
          'The table lists purchases for the active location. Edit a row to fix quantity, price, or assign a missing supplier. Soft-delete voids stock on the ledger.',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/feed-issue',
      element: '[data-tour="nav-feed-issue"]',
      popover: {
        title: 'Issue feed (store → farm)',
        description:
          'Use ==Issue Feed== when feed leaves the store outside of daily cage entry (or to allocate bags). Stock is deducted at the ==active location==. Admins can override **negative stock** with a reason when enabled.',
        side: 'right',
        align: 'center',
      },
    },

    // ——— Stocking ———
    {
      route: '/stocking',
      element: '[data-tour="nav-stocking"]',
      popover: {
        title: 'New stocking',
        description:
          'Stocking places fish into an ==empty/fallow/harvested== cage: batch number, count, initial **ABW (g)**, date, and supervisors. Depending on company settings, stocking may need ==admin approval== before the cage becomes active.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/stocking',
      element: '[data-tour="page-stocking"]',
      popover: {
        title: 'Stocking form tips',
        description:
          'If no stockable cages appear, create a cage from the hint modal. **Drafts survive a browser refresh**. After submit, watch ==Approvals== if your farm requires them.',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/fish-transfers',
      element: '[data-tour="nav-fish-transfers"]',
      popover: {
        title: 'Fish transfers',
        description:
          'Move fish between cages (**full** empties the source; **partial** leaves fish behind). Empty destinations get a new stocking; occupied cages get a top-up. Cross-location is allowed.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/stocking-management',
      element: '[data-tour="nav-stocking-management"]',
      popover: {
        title: 'Stocking management',
        description:
          'History of stockings and top-ups. **Top-up** adds fish to an existing active batch (also may require approval).',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/approvals',
      element: '[data-tour="nav-approvals"]',
      adminOnly: true,
      popover: {
        title: 'Approvals (admins)',
        description:
          'Pending stockings, top-ups, and **fish transfers** wait here. **Approve** to update both cages; **reject** with a reason when something looks wrong. Operators cannot use ==Daily Entry== on a cage until stocking is approved (if approval is required).',
        side: 'right',
        align: 'center',
      },
    },

    // ——— Daily / biweekly / harvest ———
    {
      route: '/daily-entry',
      element: '[data-tour="nav-daily-entry"]',
      popover: {
        title: 'Daily entry',
        description:
          'Core daily workflow: pick an **active cage**, enter mortality, feed type, and feed amount (kg). Feed ==deducts from inventory==. The form warns if stock is insufficient and offers a purchase modal.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/daily-entry',
      element: '[data-tour="page-daily-entry"]',
      popover: {
        title: 'How to complete a daily record',
        description:
          '**1)** Select active cage  **2)** Confirm date  **3)** Enter mortality (if any)  **4)** Select feed type with stock on hand  **5)** Enter kg fed  **6)** Save. ==One record per cage per date==. Drafts persist across refresh until you save successfully.',
        side: 'top',
        align: 'center',
      },
    },
    {
      route: '/biweekly-entry',
      element: '[data-tour="nav-biweekly-entry"]',
      popover: {
        title: 'Bi-weekly sampling',
        description:
          'Every ~2 weeks, sample fish to measure ==average body weight (ABW)==. Pick a cage, enter sample fish counts and weights; ABW calculates automatically. Used for **growth tracking** and harvest planning.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/biweekly-records',
      element: '[data-tour="nav-biweekly-records"]',
      popover: {
        title: 'Bi-weekly records',
        description:
          'Browse and edit past sampling sessions. Keep this history clean—**growth charts** and FCR-related insights depend on it.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/harvest',
      element: '[data-tour="nav-harvest"]',
      popover: {
        title: 'Harvest',
        description:
          'Record complete or partial harvests: total weight, ABW, estimated count, **FCR**, and size-grade breakdown. Size breakdown weights must ==sum to total weight==. Complete harvests move the cage toward harvested/empty for restocking.',
        side: 'right',
        align: 'center',
      },
    },

    // ——— Inventory ———
    {
      route: '/inventory/overview',
      element: '[data-tour="nav-inventory-overview"]',
      popover: {
        title: 'Inventory overview',
        description:
          'Live view of feed stock value, movements, and health. Use this to spot ==shortages== before daily entry fails.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/stock-levels',
      element: '[data-tour="nav-stock-levels"]',
      popover: {
        title: 'Stock levels',
        description:
          'Per–feed-type on-hand kg and bags vs minimum for the farm. On Purchases, KPIs and inventory cards are further filtered to the ==active location==. ==Low-stock alerts== fire when below threshold × company multiplier.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/inventory/lots',
      element: '[data-tour="nav-inventory-lots"]',
      popover: {
        title: 'Lots (FIFO)',
        description:
          'When lot tracking is enabled in company settings, purchases create lots (batch/expiry/location). Usage deducts ==oldest/expiring lots first==.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/inventory/adjust',
      element: '[data-tour="nav-inventory-adjust"]',
      popover: {
        title: 'Adjust & transfer',
        description:
          'Correct counts (damage, count error) or move stock between locations. Adjustments write to the **same ledger** as purchases and daily usage.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/inventory-transactions',
      element: '[data-tour="nav-inventory-transactions"]',
      popover: {
        title: 'Ledger / audit trail',
        description:
          'Every stock change (purchase, daily usage, issue, adjustment, reversal) appears here. Use it to ==reconcile physical store counts==.',
        side: 'right',
        align: 'center',
      },
    },

    // ——— Reports & settings ———
    {
      route: '/report',
      element: '[data-tour="nav-report"]',
      popover: {
        title: 'Production reports',
        description:
          'Summaries across cages and time. Pair with **Export** when you need spreadsheets for stakeholders.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/company-settings',
      element: '[data-tour="nav-company-settings"]',
      adminOnly: true,
      popover: {
        title: 'Company settings (admins)',
        description:
          'Farm rules: stocking approval, density/ABW limits, mortality alert thresholds, default feed bag size (==20 kg==), lot tracking, and whether negative stock is allowed. ==Change carefully==—they affect validation on forms and the ledger.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/farm-locations',
      element: '[data-tour="nav-farm-locations"]',
      adminOnly: true,
      popover: {
        title: 'Farm locations (admins)',
        description:
          'Create and name each physical site. The header ==location switcher== filters cages, purchases, KPIs, and ops to the active site. Use **Backfill** once if older records need a location assigned.',
        side: 'right',
        align: 'center',
      },
    },
    {
      route: '/audit-logs',
      element: '[data-tour="nav-audit-logs"]',
      adminOnly: true,
      popover: {
        title: 'Audit logs (admins)',
        description:
          'Who created/updated/deleted what, with before/after detail. Use when investigating unexpected **stock** or **stocking** changes.',
        side: 'right',
        align: 'center',
      },
    },

    // ——— Closing ———
    {
      route: '/dashboard',
      element: '[data-tour="app-shell"]',
      popover: {
        title: 'You are ready',
        description:
          'Remember the loop: ==Cage → Stock (approve) → Add suppliers → Buy feed (required supplier, multi-line modal) → Daily feed & mortality → Bi-weekly ABW → Harvest → Restock==. KPIs follow the ==active location==. If a dropdown is empty, use the **amber hint** to create the missing piece in a modal. Restart this tour from **Help** anytime.',
        side: 'over',
        align: 'center',
      },
    },
  ],
}

export const tourCatalog = {
  [SYSTEM_WALKTHROUGH_ID]: systemWalkthrough,
}

/** Drop admin-only steps for non-admin users. */
export function filterTourStepsForRole(steps, role) {
  const isAdmin = role === 'admin' || role === 'super_admin'
  return (steps || []).filter((s) => {
    if (s.adminOnly && !isAdmin) return false
    return true
  })
}
