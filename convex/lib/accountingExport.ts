/**
 * Accounting export (INT-008): sales, payments, feed purchases and expenses
 * as balanced double-entry journal lines, written as CSV for a generic
 * journal, QuickBooks Online (journal entry import) or Xero (manual journal
 * import). Pure: the query (convex/accountingExport.ts) loads the rows; the
 * page builds the CSV in the browser.
 *
 * One journal per source row, two lines each:
 *   sale      Dr Accounts Receivable          Cr Fish sales
 *   payment   Dr Cash / Bank / Mobile money   Cr Accounts Receivable
 *   purchase  Dr Feed inventory               Cr Accounts Payable
 *   expense   Dr <category expense>           Cr Cash
 * Invoices are not separate entries (that would count the sale twice): a
 * sale's journal carries its invoice number as the reference. Voided
 * payments and deleted purchases/expenses are left out.
 */

export type AccountKey =
  | 'cash'
  | 'bank'
  | 'mobileMoney'
  | 'receivable'
  | 'feedInventory'
  | 'payable'
  | 'fishSales'
  | `expense:${string}`

export type Account = { code: string; name: string }

export const DEFAULT_ACCOUNTS: Record<string, Account> = {
  cash: { code: '1000', name: 'Cash' },
  bank: { code: '1010', name: 'Bank' },
  mobileMoney: { code: '1020', name: 'Mobile money' },
  receivable: { code: '1200', name: 'Accounts Receivable' },
  feedInventory: { code: '1300', name: 'Feed inventory' },
  payable: { code: '2000', name: 'Accounts Payable' },
  fishSales: { code: '4000', name: 'Fish sales' },
  'expense:fingerlings': { code: '5000', name: 'Fingerlings' },
  'expense:feed': { code: '5010', name: 'Feed' },
  'expense:treatment': { code: '5020', name: 'Treatment' },
  'expense:labour': { code: '6000', name: 'Labour' },
  'expense:equipment': { code: '6100', name: 'Equipment' },
  'expense:utilities': { code: '6200', name: 'Utilities' },
  'expense:transport': { code: '6300', name: 'Transport' },
  'expense:other': { code: '6900', name: 'Other expenses' },
}

export type PaymentMethod = 'cash' | 'mobile_money' | 'bank' | 'cheque' | 'other'

export type SourceRow =
  | {
      kind: 'sale'
      id: string
      date: string
      amount: number
      customer?: string
      invoiceNumber?: string
      weightKg?: number
      site?: string
    }
  | { kind: 'payment'; id: string; date: string; amount: number; method: PaymentMethod; reference?: string; customer?: string; invoiceNumber?: string; site?: string }
  | { kind: 'purchase'; id: string; date: string; amount: number; supplier?: string; item?: string; quantityKg?: number; site?: string }
  | { kind: 'expense'; id: string; date: string; amount: number; category: string; categoryLabel?: string; supplier?: string; notes?: string; site?: string }

export type JournalLine = { account: Account; debit: number; credit: number }

export type JournalEntry = {
  journalNo: string
  date: string
  source: SourceRow['kind']
  sourceId: string
  reference: string
  memo: string
  /** Customer or supplier. */
  name?: string
  site?: string
  lines: [JournalLine, JournalLine]
}

const round2 = (n: number) => Math.round(n * 100) / 100

const PAYMENT_ACCOUNT: Record<PaymentMethod, string> = {
  cash: 'cash',
  mobile_money: 'mobileMoney',
  bank: 'bank',
  cheque: 'bank',
  other: 'cash',
}

function expenseAccount(category: string, label: string | undefined, accounts: Record<string, Account>): Account {
  return accounts[`expense:${category}`] ?? { ...accounts['expense:other'], name: label || category }
}

const shortId = (id: string) => id.slice(-6).toUpperCase()

/** Journal entries, oldest first, numbered from 1. Zero and negative amounts are skipped. */
export function journalEntries(rows: SourceRow[], accounts: Record<string, Account> = DEFAULT_ACCOUNTS): JournalEntry[] {
  const order = { sale: 0, payment: 1, purchase: 2, expense: 3 } as const
  const sorted = [...rows]
    .filter((r) => Number.isFinite(r.amount) && round2(r.amount) > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.id.localeCompare(b.id))
  return sorted.map((r, i) => {
    const amount = round2(r.amount)
    const pair = (dr: Account, cr: Account): [JournalLine, JournalLine] => [
      { account: dr, debit: amount, credit: 0 },
      { account: cr, debit: 0, credit: amount },
    ]
    const journalNo = String(i + 1)
    switch (r.kind) {
      case 'sale':
        return {
          journalNo,
          date: r.date,
          source: r.kind,
          sourceId: r.id,
          reference: r.invoiceNumber || `SALE-${shortId(r.id)}`,
          memo: `Fish sale${r.customer ? ` to ${r.customer}` : ''}${r.weightKg ? ` (${round2(r.weightKg)} kg)` : ''}`,
          name: r.customer,
          site: r.site,
          lines: pair(accounts.receivable, accounts.fishSales),
        }
      case 'payment':
        return {
          journalNo,
          date: r.date,
          source: r.kind,
          sourceId: r.id,
          reference: r.reference || r.invoiceNumber || `PAY-${shortId(r.id)}`,
          memo: `Payment received${r.customer ? ` from ${r.customer}` : ''}${r.invoiceNumber ? ` for ${r.invoiceNumber}` : ''}`,
          name: r.customer,
          site: r.site,
          lines: pair(accounts[PAYMENT_ACCOUNT[r.method]], accounts.receivable),
        }
      case 'purchase':
        return {
          journalNo,
          date: r.date,
          source: r.kind,
          sourceId: r.id,
          reference: `PUR-${shortId(r.id)}`,
          memo: `Feed purchase${r.item ? `: ${r.item}` : ''}${r.quantityKg ? ` (${round2(r.quantityKg)} kg)` : ''}`,
          name: r.supplier,
          site: r.site,
          lines: pair(accounts.feedInventory, accounts.payable),
        }
      case 'expense':
        return {
          journalNo,
          date: r.date,
          source: r.kind,
          sourceId: r.id,
          reference: `EXP-${shortId(r.id)}`,
          memo: `${r.categoryLabel || r.category}${r.notes ? `: ${r.notes}` : ''}`,
          name: r.supplier,
          site: r.site,
          lines: pair(expenseAccount(r.category, r.categoryLabel, accounts), accounts.cash),
        }
    }
  })
}

export type ExportFormat = 'journal' | 'quickbooks' | 'xero'
export type DateFormat = 'iso' | 'dmy' | 'mdy'

export const EXPORT_FORMATS: { id: ExportFormat; label: string; dateFormat: DateFormat }[] = [
  { id: 'journal', label: 'Double-entry journal (generic)', dateFormat: 'iso' },
  { id: 'quickbooks', label: 'QuickBooks Online: journal entries', dateFormat: 'mdy' },
  { id: 'xero', label: 'Xero: manual journals', dateFormat: 'dmy' },
]

export function formatDate(iso: string, f: DateFormat) {
  const [y, m, d] = iso.split('-')
  if (f === 'dmy') return `${d}/${m}/${y}`
  if (f === 'mdy') return `${m}/${d}/${y}`
  return iso
}

const money = (n: number) => (n ? n.toFixed(2) : '')

/** Text that a spreadsheet would run as a formula gets a leading quote. */
export function safeText(s: string | undefined) {
  const v = (s ?? '').replace(/[\r\n]+/g, ' ').trim()
  return /^[=+\-@\t]/.test(v) ? `'${v}` : v
}

export type CsvTable = { header: string[]; rows: string[][] }

export function buildExport(
  entries: JournalEntry[],
  opts: { format: ExportFormat; currency: string; dateFormat?: DateFormat; xeroTaxRate?: string },
): CsvTable {
  const fmt = opts.dateFormat ?? EXPORT_FORMATS.find((f) => f.id === opts.format)!.dateFormat
  const date = (e: JournalEntry) => formatDate(e.date, fmt)
  if (opts.format === 'quickbooks') {
    return {
      header: ['Journal No', 'Journal Date', 'Currency Code', 'Memo', 'Account', 'Debits', 'Credits', 'Description', 'Name', 'Location'],
      rows: entries.flatMap((e) =>
        e.lines.map((l) => [
          `PBA-${e.journalNo}`,
          date(e),
          opts.currency,
          safeText(`${e.reference} ${e.memo}`),
          safeText(l.account.name),
          money(l.debit),
          money(l.credit),
          safeText(e.memo),
          safeText(e.name),
          safeText(e.site),
        ]),
      ),
    }
  }
  if (opts.format === 'xero') {
    const tax = opts.xeroTaxRate || 'Tax Exempt'
    return {
      header: ['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount', 'TrackingName1', 'TrackingOption1'],
      rows: entries.flatMap((e) =>
        e.lines.map((l) => [
          safeText(`${e.reference} ${e.memo}`),
          date(e),
          safeText(e.name ? `${e.memo} (${e.name})` : e.memo),
          l.account.code,
          tax,
          (l.debit ? l.debit : -l.credit).toFixed(2),
          e.site ? 'Site' : '',
          safeText(e.site),
        ]),
      ),
    }
  }
  return {
    header: ['Date', 'Journal No', 'Reference', 'Account Code', 'Account Name', 'Description', 'Debit', 'Credit', 'Currency', 'Name', 'Site', 'Source', 'Source Id'],
    rows: entries.flatMap((e) =>
      e.lines.map((l) => [
        date(e),
        e.journalNo,
        safeText(e.reference),
        l.account.code,
        safeText(l.account.name),
        safeText(e.memo),
        money(l.debit),
        money(l.credit),
        opts.currency,
        safeText(e.name),
        safeText(e.site),
        e.source,
        e.sourceId,
      ]),
    ),
  }
}

/** Totals for the page and for tests: debits equal credits. */
export function journalTotals(entries: JournalEntry[]) {
  let debit = 0
  let credit = 0
  const bySource: Record<string, number> = { sale: 0, payment: 0, purchase: 0, expense: 0 }
  for (const e of entries) {
    for (const l of e.lines) {
      debit += l.debit
      credit += l.credit
    }
    bySource[e.source] += e.lines[0].debit
  }
  return { debit: round2(debit), credit: round2(credit), bySource, count: entries.length }
}
