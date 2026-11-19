import SettingsNav from '../SettingsNav'
import { useCompanySettings } from '../../contexts/CompanySettingsContext'
import { useT } from '../../lib/i18n/context'

/** "Settings · <company>" eyebrow, optionally followed by more crumbs. */
export function useSettingsEyebrow(...crumbs) {
  const t = useT()
  const { displayName } = useCompanySettings()
  return [t('settingsUi.eyebrow', { company: displayName }), ...crumbs].filter(Boolean).join(' · ')
}

/**
 * P-SETTINGS pattern (Paper 31 Account ACU-0, 22 Roles 57B-0): the settings
 * sub-nav on the left (200px) and stacked cards of label / helper / control
 * rows on the right. Pages still render `Layout` themselves (title, eyebrow,
 * actions); this fills the content row under the page header.
 *
 * `active` is a SettingsNav key; omit it to match by path, pass null for
 * pages outside the list.
 */
export function SettingsFrame({ active, children, className = '' }) {
  return (
    <div className={`flex w-full flex-col items-start gap-6 md:flex-row md:gap-7 ${className}`}>
      <SettingsNav active={active} />
      <div className="flex w-full min-w-0 grow basis-0 flex-col gap-5">{children}</div>
    </div>
  )
}

/** Card with a 15/600 title, optional muted meta or action on the right, then rows. */
export function SettingsCard({ title, meta, action, children, className = '', id, as: Tag = 'section', ...rest }) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <Tag
      id={id}
      aria-labelledby={title && headingId ? headingId : undefined}
      className={`flex min-w-0 flex-col gap-1 rounded-card border border-line bg-surface px-5 py-6 shadow-[var(--shadow-card)] sm:px-[26px] ${className}`}
      {...rest}
    >
      {(title || meta != null || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          {title && (
            <h2 id={headingId} className="text-[15px] font-semibold leading-[18px] text-text">
              {title}
            </h2>
          )}
          {(meta != null || action) && (
            <div className="flex items-center gap-3">
              {meta != null && <span className="text-[13px] leading-4 text-muted">{meta}</span>}
              {action}
            </div>
          )}
        </div>
      )}
      {children}
    </Tag>
  )
}

/** One label / helper / control row with a hairline above it. */
export function SettingsRow({ label, helper, children, htmlFor, className = '', labelClassName = '' }) {
  const Label = htmlFor ? 'label' : 'div'
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-line py-3 ${className}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <Label htmlFor={htmlFor} className={`text-[14px] leading-[18px] text-text ${labelClassName}`}>
          {label}
        </Label>
        {helper && <div className="text-[12px] leading-4 text-muted">{helper}</div>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/** Red-outlined destructive block (Paper 31 "Delete account"). */
export function DangerRow({ label, helper, children, className = '' }) {
  return (
    <div
      className={`mt-[10px] flex flex-wrap items-center justify-between gap-3 rounded-input border px-[18px] py-4 ${className}`}
      style={{
        borderColor: 'var(--pill-red-border)',
        backgroundColor: 'color-mix(in oklab, var(--alert) 5%, var(--surface))',
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="text-[14px] leading-[18px] text-alert">{label}</div>
        {helper && <div className="text-[12px] leading-4 text-muted">{helper}</div>}
      </div>
      {children}
    </div>
  )
}

const NOTICE_COLOR = { warn: 'var(--warn)', alert: 'var(--alert)', good: 'var(--good)', cyan: 'var(--cyan)' }

/** Inline notice strip with a status dot (Paper 57 phone-outbox banner). */
export function Notice({ tone = 'warn', children, action, role, className = '' }) {
  const color = NOTICE_COLOR[tone] || NOTICE_COLOR.warn
  return (
    <div
      role={role || (tone === 'alert' ? 'alert' : 'status')}
      className={`flex flex-wrap items-center gap-3 rounded-input border px-5 py-[14px] text-[14px] leading-[18px] text-text ${className}`}
      style={{
        borderColor: `color-mix(in oklab, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 6%, var(--surface))`,
      }}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** Label / value rows used in detail panels (Paper 50 site detail, 59 registration). */
export function DetailList({ items = [], className = '' }) {
  return (
    <dl className={`flex flex-col ${className}`}>
      {items
        .filter((item) => item && item.value != null && item.value !== '')
        .map((item, i) => (
          <div
            key={item.key || item.label}
            className={`flex items-center justify-between gap-3 py-3 text-[14px] leading-[18px] ${i ? 'border-t border-line' : ''}`}
          >
            <dt className="shrink-0 text-muted">{item.label}</dt>
            <dd className={`min-w-0 truncate text-right text-text ${item.mono ? 'font-data text-[13px] text-pearl-cyan' : ''}`}>
              {item.value}
            </dd>
          </div>
        ))}
    </dl>
  )
}

/** Paper input style: radius 14, bg fill, line-strong border (21 Automations, 58 Anowa). */
export const FIELD =
  'w-full rounded-input border border-line-strong bg-bg px-[14px] py-3 text-[14px] leading-[18px] text-text placeholder:text-faint focus:border-muted focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50'

/** 12px muted label above a field. */
export const FIELD_LABEL = 'mb-1.5 block text-[12px] leading-4 text-muted'

/** Inline error banner used inside cards. */
export function InlineError({ children, className = '' }) {
  if (!children) return null
  return (
    <div
      role="alert"
      className={`rounded-input border px-4 py-3 text-[13px] leading-4 text-alert ${className}`}
      style={{ borderColor: 'var(--pill-red-border)' }}
    >
      {children}
    </div>
  )
}

/** Inline success banner used inside cards. */
export function InlineSuccess({ children, className = '' }) {
  if (!children) return null
  return (
    <div
      role="status"
      className={`rounded-input border px-4 py-3 text-[13px] leading-4 text-good ${className}`}
      style={{ borderColor: 'var(--pill-green-border)' }}
    >
      {children}
    </div>
  )
}

/** Small muted line for loading / empty text inside a card. */
export function CardNote({ children, className = '' }) {
  return <p className={`border-t border-line py-3 text-[13px] leading-4 text-muted ${className}`}>{children}</p>
}

/**
 * Underline tab bar (Paper 30 Notifications, 47 Audit log): 28px gap, 2px
 * button-colour underline on the active tab, hairline under the row.
 * tabs: [{ value, label, count }]. WAI-ARIA tablist with arrow keys.
 */
export function LineTabs({ tabs = [], value, onChange, label, className = '' }) {
  const onKeyDown = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = Math.max(0, tabs.findIndex((tab) => tab.value === value))
    const next = tabs[(i + step + tabs.length) % tabs.length]
    onChange?.(next.value)
    e.currentTarget.querySelector(`[data-tab="${next.value}"]`)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex flex-wrap gap-x-7 border-b border-line ${className}`}
    >
      {tabs.map((tab) => {
        const on = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            data-tab={tab.value}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange?.(tab.value)}
            className={`-mb-px rounded-t-sm border-b-2 pb-3 text-[14px] leading-[18px] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
              on ? 'border-button font-medium text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {tab.label}
            {tab.count != null && <span className="ml-1">{tab.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 12px label above a Paper field. Children get FIELD styling from the caller. */
export function SettingsField({ label, htmlFor, hint, required = false, children, className = '' }) {
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
        {required && <span aria-hidden className="text-alert"> *</span>}
      </label>
      {children}
      {hint && <span className="mt-1 text-[12px] leading-4 text-faint">{hint}</span>}
    </div>
  )
}
