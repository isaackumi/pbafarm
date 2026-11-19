import { useState } from 'react'
import { Search } from 'lucide-react'
import Tabs from './Tabs'

/**
 * Table card (Paper 24 Sales 9C8-0): title, filter tabs and a search toggle in
 * the header; uppercase column heads; hairline rows.
 *
 * columns: [{ key, header, width, align: 'left'|'right', render(row) }]
 * Cells render `row[key]` unless `render` is given; `sub` adds a muted line.
 */
export function Table({
  title,
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
  className = '',
}) {
  const [searchOpen, setSearchOpen] = useState(Boolean(search))
  const hasHeader = title || tabs || onSearchChange || actions
  return (
    <div className={`flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-[var(--shadow-card)] ${className}`}>
      {hasHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
          <div className="flex flex-wrap items-center gap-5">
            {title && <h2 className="font-sans text-[17px] font-semibold leading-[22px] text-text">{title}</h2>}
            {tabs && <Tabs tabs={tabs} value={tab} onChange={onTabChange} label={title} />}
          </div>
          <div className="flex items-center gap-3">
            {onSearchChange &&
              (searchOpen ? (
                <input
                  type="search"
                  autoFocus
                  value={search || ''}
                  placeholder={searchPlaceholder}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onBlur={() => !search && setSearchOpen(false)}
                  className="h-8 w-48 rounded-pill border border-line px-3 text-[13px] leading-4 text-text placeholder:text-faint focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  aria-label={searchPlaceholder}
                  onClick={() => setSearchOpen(true)}
                  className="text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan rounded"
                >
                  <Search size={16} strokeWidth={2} aria-hidden />
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
                  className={`py-3 text-[11px] font-normal uppercase leading-[14px] tracking-[0.08em] text-faint ${
                    i === 0 ? 'pl-6' : 'pl-3'
                  } ${i === columns.length - 1 ? 'pr-6' : 'pr-3'} ${col.align === 'right' ? 'text-right' : ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr className="border-t border-line">
                <td colSpan={columns.length} className="px-6 py-[14px] text-[14px] leading-[18px] text-muted">
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
                    className={`py-[14px] align-middle text-[14px] leading-[18px] text-text ${
                      i === 0 ? 'pl-6' : 'pl-3'
                    } ${i === columns.length - 1 ? 'pr-6' : 'pr-3'} ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}
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
