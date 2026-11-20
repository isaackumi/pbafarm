import { useState } from 'react'
import { SearchIcon } from '../../lib/navIcons'
import Tabs from './Tabs'

/**
 * Table card (Paper 24 Sales 9C8-0): title, filter tabs and a search toggle in
 * the header; uppercase column heads; hairline rows.
 *
 * columns: [{ key, header, width, align: 'left'|'right', render(row) }]
 * Cells render `row[key]` unless `render` is given; `sub` adds a muted line.
 *
 * variant 'card' (default): Paper 24 Sales / 01 Home — 20px radius, 20/24
 *   header, 17px title, 24px edge cells, 14/18 rows.
 * variant 'console': Paper 40 tenants — 16px radius, 16/20 header, 20px edge
 *   cells, an always-open 260×34 search field.
 * variant 'panel': Paper 42/43 panels — 12px radius, 16/20 header with a
 *   15px title, 10px header cells, 12px rows of 13/16 text, 20px edge cells.
 */
const VARIANT = {
  card: {
    box: 'rounded-card',
    header: 'px-6 py-5',
    title: 'text-[17px] leading-[22px]',
    edgeL: 'pl-6',
    edgeR: 'pr-6',
    th: 'py-3',
    td: 'py-[14px] text-[14px] leading-[18px]',
  },
  console: {
    box: 'rounded-[16px]',
    header: 'px-5 py-4',
    title: 'text-[17px] leading-[22px]',
    edgeL: 'pl-5',
    edgeR: 'pr-5',
    th: 'py-3',
    td: 'py-[14px] text-[14px] leading-[18px]',
  },
  panel: {
    box: 'rounded-[12px]',
    header: 'px-5 py-4',
    title: 'text-[15px] leading-[18px]',
    edgeL: 'pl-5',
    edgeR: 'pr-5',
    th: 'py-[10px]',
    td: 'py-3 text-[13px] leading-4',
  },
}
export function Table({
  title,
  tabsLabel,
  tabs,
  tab,
  onTabChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  actions,
  columns = [],
  rows = [],
  rowKey = (row, i) => row._id || row.id || i,
  onRowClick,
  empty = 'Nothing here yet',
  variant = 'card',
  className = '',
}) {
  const v = VARIANT[variant] || VARIANT.card
  // Console and panel tables keep the search field open (Paper 40: 260×34).
  const alwaysOpen = variant !== 'card'
  const [searchOpen, setSearchOpen] = useState(Boolean(search))
  const hasHeader = title || tabs || onSearchChange || actions
  return (
    <div className={`flex flex-col overflow-hidden border border-line bg-surface shadow-[var(--shadow-card)] ${v.box} ${className}`}>
      {hasHeader && (
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-line ${v.header}`}>
          <div className="flex flex-wrap items-center gap-5">
            {title && <h2 className={`font-sans font-semibold text-text ${v.title}`}>{title}</h2>}
            {tabs && <Tabs tabs={tabs} value={tab} onChange={onTabChange} label={tabsLabel || title} />}
          </div>
          <div className="flex items-center gap-3">
            {onSearchChange &&
              (alwaysOpen || searchOpen ? (
                <input
                  type="search"
                  autoFocus={!alwaysOpen}
                  aria-label={searchPlaceholder}
                  value={search || ''}
                  placeholder={searchPlaceholder}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onBlur={() => !alwaysOpen && !search && setSearchOpen(false)}
                  className={`rounded-pill border bg-transparent text-[13px] leading-4 text-text placeholder:text-faint focus:border-muted focus:outline-none ${
                    alwaysOpen ? 'h-[34px] w-full border-line-strong px-[14px] sm:w-[260px]' : 'h-8 w-48 border-line px-3'
                  }`}
                />
              ) : (
                <button
                  type="button"
                  aria-label={searchPlaceholder}
                  onClick={() => setSearchOpen(true)}
                  className="text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded"
                >
                  <SearchIcon size={16} strokeWidth={2} aria-hidden />
                </button>
              ))}
            {actions}
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={`${v.th} text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint ${
                    i === 0 ? v.edgeL : 'pl-3'
                  } ${i === columns.length - 1 ? v.edgeR : 'pr-3'} ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t border-line">
                <td colSpan={columns.length} className={`${v.edgeL} ${v.edgeR} ${v.td} text-muted`}>
                  {empty}
                </td>
              </tr>
            )}
            {rows.map((row, r) => (
              <tr
                key={rowKey(row, r)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-t border-line ${onRowClick ? 'cursor-pointer hover:bg-surface-2' : ''}`}
              >
                {columns.map((col, i) => (
                  <td
                    key={col.key}
                    className={`${v.td} align-middle text-text ${
                      i === 0 ? v.edgeL : 'pl-3'
                    } ${i === columns.length - 1 ? v.edgeR : 'pr-3'} ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}
                  >
                    {col.render ? col.render(row) : row[col.key]}
                    {col.sub && (
                      <div className="mt-[2px] text-[12px] leading-4 text-muted">{col.sub(row)}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Table
