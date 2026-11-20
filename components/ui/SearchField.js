import { forwardRef } from 'react'
import { SearchIcon } from '../../lib/navIcons'

/** Pill search input (Paper top bar 7Z-0): 320×36, faint icon, optional ⌘K hint. */
export const SearchField = forwardRef(function SearchField(
  { placeholder = 'Search', hint, className = '', inputClassName = '', ...props },
  ref,
) {
  return (
    <label
      className={`flex h-9 w-full items-center gap-2.5 rounded-pill border border-line bg-surface px-3.5 focus-within:border-line-strong ${className}`}
    >
      <SearchIcon size={14} strokeWidth={2} className="shrink-0 text-faint" aria-hidden />
      <input
        ref={ref}
        type="search"
        placeholder={placeholder}
        className={`min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-4 text-text placeholder:text-faint placeholder:opacity-100 focus:outline-none focus:ring-0 focus:shadow-none ${inputClassName}`}
        style={{ backgroundColor: 'transparent' }}
        {...props}
      />
      {hint && (
        <kbd className="shrink-0 font-sans text-[11px] leading-[14px] text-muted">{hint}</kbd>
      )}
    </label>
  )
})

export default SearchField
