/** Shared UI primitives — Harbor Soft light dashboard */
import Link from 'next/link'

const SIZE = {
  sm: 'px-3 py-2 text-sm min-h-10',
  md: 'px-5 py-3 text-base min-h-12',
  lg: 'px-6 py-3.5 text-base min-h-14',
}

const VARIANT = {
  primary:
    'bg-lagoon-950 text-white hover:bg-lagoon-800 shadow-sm border border-transparent',
  secondary:
    'bg-white text-chart-ink border border-foam-deep hover:bg-foam hover:border-lagoon-700',
  ghost: 'bg-transparent text-chart-ink hover:bg-foam border border-transparent',
  danger: 'bg-signal text-white hover:opacity-90 border border-transparent',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  href,
  type = 'button',
  ...props
}) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lagoon-800 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${SIZE[size] || SIZE.md} ${VARIANT[variant] || VARIANT.primary} ${className}`

  if (href) {
    return (
      <Link href={href} className={classes} {...props}>
        {children}
      </Link>
    )
  }

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  )
}

export function Card({ children, className = '', padding = true }) {
  return (
    <div
      className={`bg-white border border-zinc-200/90 rounded-2xl shadow-[0_1px_3px_rgba(24,24,27,0.06)] ${
        padding ? 'p-5 sm:p-6' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="font-display text-lg font-bold text-chart-ink tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatCard({ label, value, unit, hint, icon: Icon, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'text-kelp'
      : tone === 'warn'
        ? 'text-signal'
        : tone === 'accent'
          ? 'text-lagoon-950'
          : 'text-chart-ink'

  return (
    <Card className="min-h-[7.5rem] flex flex-col justify-between">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-muted">{label}</p>
        {Icon && (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-foam text-lagoon-950">
            <Icon size={20} weight="duotone" aria-hidden />
          </span>
        )}
      </div>
      <div>
        <p className={`font-display text-2xl sm:text-3xl font-bold tracking-tight ${toneClass}`}>
          <span className="font-data">{value}</span>
          {unit && (
            <span className="ml-1 text-sm font-semibold text-muted font-sans">
              {unit}
            </span>
          )}
        </p>
        {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
      </div>
    </Card>
  )
}

export function HealthMeter({ score, label = 'Farm health' }) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0))
  return (
    <Card className="min-h-[7.5rem]">
      <p className="text-sm font-semibold text-muted mb-2">{label}</p>
      <p className="font-display text-3xl font-bold text-chart-ink font-data mb-3">
        {clamped.toFixed(0)}
        <span className="text-base text-muted font-sans font-semibold"> / 100</span>
      </p>
      <div
        className="h-3 rounded-full overflow-hidden"
        style={{
          background:
            'linear-gradient(90deg, #dc2626 0%, #eab308 45%, #15803d 100%)',
        }}
        role="meter"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="relative h-full w-full">
          <span
            className="absolute top-1/2 -translate-y-1/2 h-4 w-1 rounded-full bg-white shadow border border-chart-ink/20"
            style={{ left: `calc(${clamped}% - 2px)` }}
          />
        </div>
      </div>
    </Card>
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <p className="font-semibold text-chart-ink">{title}</p>
      {description && <p className="text-sm text-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div className="inline-flex rounded-xl bg-foam p-1 border border-foam-deep">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2.5 text-sm font-semibold rounded-lg min-h-11 transition-colors ${
            active === tab.id
              ? 'bg-white text-chart-ink shadow-sm'
              : 'text-muted hover:text-chart-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Breadcrumbs({ items = [] }) {
  if (!items.length) return null
  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span className="text-zinc-300 select-none" aria-hidden>
                  /
                </span>
              )}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="font-medium text-muted hover:text-lagoon-950 transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={last ? 'font-semibold text-chart-ink' : 'text-muted'}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function PageHeader({
  breadcrumbs = [],
  title,
  description,
  actions,
  related = [],
  showTitle = true,
}) {
  return (
    <div className="mb-8">
      <Breadcrumbs items={breadcrumbs} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 max-w-3xl">
          {showTitle && title && (
            <h2 className="font-display text-2xl sm:text-[1.75rem] font-bold text-chart-ink tracking-tight">
              {title}
            </h2>
          )}
          {description && (
            <p
              className={`text-sm sm:text-[15px] text-muted leading-relaxed ${
                showTitle && title ? 'mt-1.5' : 'mt-0'
              }`}
            >
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
      {related.length > 0 && (
        <nav
          aria-label="Related pages"
          className="mt-5 flex flex-wrap items-center gap-2 border-t border-foam-deep pt-4"
        >
          <span className="text-xs font-semibold uppercase tracking-wide text-muted mr-1">
            Related
          </span>
          {related.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center rounded-lg bg-foam px-3 py-1.5 text-sm font-medium text-chart-ink hover:bg-zinc-200/80 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}

const FIELD_CLASS =
  'w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-[15px] text-chart-ink placeholder:text-zinc-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-lagoon-800/30 focus:border-lagoon-800 transition-colors disabled:opacity-50 min-h-12'

export function Field({ label, htmlFor, hint, error, required, children, className = '' }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-sm font-semibold text-chart-ink"
        >
          {label}
          {required && <span className="text-signal ml-0.5">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-signal">{error}</p>}
    </div>
  )
}

export function Input({ className = '', ...props }) {
  return <input className={`${FIELD_CLASS} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${FIELD_CLASS} ${className}`} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className = '', rows = 3, ...props }) {
  return (
    <textarea
      rows={rows}
      className={`${FIELD_CLASS} resize-y min-h-[6rem] ${className}`}
      {...props}
    />
  )
}

/** Page-width wrapper for form screens (header + form). */
export function FormPage({ children, className = '', width = 'lg' }) {
  const max =
    width === 'full'
      ? 'max-w-6xl'
      : width === 'md'
        ? 'max-w-3xl'
        : 'max-w-4xl'
  return (
    <div className={`${max} w-full mx-auto sm:mx-0 ${className}`}>
      {children}
    </div>
  )
}

export function FormSection({ title, description, children, className = '' }) {
  return (
    <section className={`space-y-4 ${className}`}>
      {(title || description) && (
        <div className="pb-1 border-b border-foam-deep">
          {title && (
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-sm text-muted mt-1 mb-3">{description}</p>
          )}
          {!description && title && <div className="mb-3" />}
        </div>
      )}
      {children}
    </section>
  )
}

export function FormCard({
  children,
  className = '',
  title,
  subtitle,
  fullWidth = true,
}) {
  return (
    <Card
      className={`${fullWidth ? 'w-full' : 'max-w-2xl'} p-6 sm:p-8 ${className}`}
      padding={false}
    >
      {(title || subtitle) && (
        <div className="mb-6">
          {title && (
            <h3 className="font-display text-lg font-bold text-chart-ink tracking-tight">
              {title}
            </h3>
          )}
          {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </Card>
  )
}

export function FormActions({ children, className = '' }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 pt-5 border-t border-foam-deep mt-8 ${className}`}
    >
      {children}
    </div>
  )
}

export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-zinc-200/80 ${className}`}
      aria-hidden
    />
  )
}

/** Full app chrome skeleton — sidebar + header + content placeholders. */
export function AppShellSkeleton() {
  return (
    <div
      className="min-h-screen bg-foam"
      aria-busy="true"
      aria-label="Loading application"
    >
      <aside
        className="fixed top-0 left-0 h-screen w-64 border-r border-zinc-800 bg-zinc-900 p-3 space-y-4"
        aria-hidden
      >
        <div className="flex items-center gap-2.5 px-2 py-3">
          <Skeleton className="h-9 w-9 rounded-xl bg-zinc-700/80" />
          <Skeleton className="h-5 w-28 bg-zinc-700/80" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 px-1">
            <Skeleton className="h-9 w-full rounded-xl bg-zinc-700/70" />
            <div className="ml-3 space-y-1.5 pl-2 border-l border-white/10">
              <Skeleton className="h-8 w-[90%] rounded-lg bg-zinc-700/50" />
              <Skeleton className="h-8 w-[75%] rounded-lg bg-zinc-700/50" />
            </div>
          </div>
        ))}
      </aside>

      <div className="ml-64 min-h-screen flex flex-col">
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-sm border-b border-foam-deep px-5 sm:px-8 py-4">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-8 w-48" />
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <Skeleton className="h-12 w-12 rounded-xl" />
              <Skeleton className="h-12 w-36 rounded-xl" />
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 sm:p-8">
          <div className="space-y-6 max-w-[1400px]">
            <div className="space-y-3 max-w-md">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-9 w-64 max-w-full" />
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="min-h-[7rem] space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-3 w-full" />
                </Card>
              ))}
            </div>
            <Card className="min-h-[18rem] space-y-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-52 w-full rounded-2xl" />
            </Card>
          </div>
        </main>
      </div>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div
      className="space-y-6 max-w-[1400px]"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="space-y-3 w-full max-w-md">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-72 max-w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-14 w-44 rounded-xl" />
          <Skeleton className="h-14 w-40 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="min-h-[7.5rem] space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-full" />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 min-h-[22rem] space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </Card>
        <Card className="min-h-[22rem] space-y-4">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </Card>
      </div>

      <Card padding={false}>
        <div className="p-5 sm:p-6 border-b border-foam-deep flex justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-11 w-56 rounded-xl" />
        </div>
        <div className="p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    </div>
  )
}

