import Link from 'next/link'

/**
 * "Sky & lake" Home header (Paper "L · 01 Home — Sky & lake (proposal v2)",
 * layer "Sky & lake panel"). A personal preference (dashboard.homeHeader):
 * a rounded sky panel sits behind the greeting and the first card row stands
 * on its waterline. Colours live in styles/theme.css (.home-sky*), with a day
 * version for the light theme and a night version for dark.
 *
 * The panel is purely decorative: aria-hidden, no pointer events, no motion.
 */
function HomeSkyPanel() {
  return (
    <div
      aria-hidden
      className="home-sky-panel pointer-events-none absolute -inset-x-2 top-0 -bottom-[84px] -z-10 overflow-hidden rounded-[28px] sm:-inset-x-4 sm:-bottom-[226px]"
    >
      <span className="home-sky-glow absolute right-[7%] top-[-90px] h-[240px] w-[40%] rounded-pill blur-[70px]" />
      <span className="home-sky-cloud absolute right-[21%] top-[40px] h-[54px] w-[23%] rounded-pill opacity-[0.55] blur-[22px]" />
      <span className="home-sky-cloud absolute right-[-5%] top-[120px] hidden h-[60px] w-[26%] rounded-pill opacity-[0.45] blur-[26px] sm:block" />
      <span className="home-sky-haze absolute -inset-x-10 bottom-[22.4%] h-10 rounded-pill blur-[18px]" />
      <svg
        className="home-sky-water absolute inset-x-0 bottom-0 h-[24%] w-full"
        viewBox="0 0 1144 80"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M180 30h60M300 58h90M520 40h70M700 66h80M960 28h50"
          className="home-sky-ripple"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <CageRings className="absolute bottom-[3%] left-0 h-[30px] w-[124px] sm:bottom-[6px]" cx={62} rx={62} ry={11} />
      <CageRings className="absolute bottom-[6%] right-0 h-[30px] w-[140px] sm:bottom-[16px]" cx={70} rx={70} ry={12} />
      <CageRings
        className="absolute bottom-[1%] right-[19%] hidden h-[20px] w-[94px] sm:block"
        cx={47}
        rx={46}
        ry={8}
        single
      />
    </div>
  )
}

/** Faint floating cage collars on the water: an outer and inner ring. */
function CageRings({ className, cx, rx, ry, single = false }) {
  const h = ry * 2 + 4
  return (
    <svg className={className} viewBox={`0 0 ${cx * 2 + 2} ${h}`} fill="none">
      <ellipse cx={cx + 1} cy={h / 2} rx={rx} ry={ry} className="home-sky-ring" strokeWidth="1.2" />
      {!single && (
        <ellipse cx={cx + 1} cy={h / 2} rx={rx * 0.71} ry={ry * 0.64} className="home-sky-ring" strokeWidth="1.2" />
      )}
    </svg>
  )
}

/**
 * Greeting over the sky: white text, lime primary, dark-glass secondaries.
 * The panel hangs from this block (330px on wide screens, ~220px on phones)
 * so it grows with the header when the buttons wrap. The parent needs
 * `isolate` so the panel stays behind the cards that follow.
 */
export function HomeSkyTitle({ eyebrow, title, actions }) {
  return (
    <div className="relative flex flex-col gap-4 px-2 pt-5 sm:flex-row sm:items-end sm:justify-between sm:px-3 sm:pb-5 sm:pt-[26px]">
      <HomeSkyPanel />
      <div className="flex min-w-0 flex-col gap-[6px]">
        <div className="home-sky-eyebrow text-[13px] leading-4">{eyebrow}</div>
        <h1 className="font-sans text-[24px] font-semibold leading-[30px] tracking-[-0.02em] text-white sm:text-[30px] sm:leading-9">
          {title}
        </h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}

/** Pill for the sky header. `tone`: 'lime' (primary) or 'glass' (secondary). */
export function SkyButton({ href, onClick, icon: Icon, tone = 'glass', size = 'md', children }) {
  const sizing =
    size === 'sm' ? 'h-10 px-[18px] gap-2 text-[14px] leading-[18px]' : 'h-12 px-[22px] gap-2.5 text-[15px] leading-[18px]'
  const className = `home-sky-btn home-sky-btn-${tone} inline-flex shrink-0 items-center whitespace-nowrap rounded-pill font-medium transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${sizing}`
  const inner = (
    <>
      {Icon && <Icon size={16} strokeWidth={2} aria-hidden className="shrink-0" />}
      {children}
    </>
  )
  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {inner}
    </button>
  )
}
