/**
 * Floating pill action bar (Paper 53 import bar, 04 daily entry footer):
 * summary on the left, actions on the right. Sticks above the phone tab bar.
 */
export function ActionBar({ children, className = '', ...props }) {
  return (
    <div
      className={`sticky bottom-[calc(var(--tabbar-h)+8px)] z-20 flex flex-wrap items-center gap-3 rounded-[28px] border border-line-strong bg-surface-2 py-3 pl-5 pr-3 shadow-[var(--shadow-card)] sm:rounded-pill sm:py-3.5 sm:pl-6 sm:pr-3.5 lg:bottom-4 print:hidden ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export default ActionBar
