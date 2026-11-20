import { Toggle } from './ui'

/**
 * Paper accent tones for the settings and admin screens (artboards 14 to 66,
 * light 7BH-0, JYF-0, K4C-0). The shared `Pill` only has pink and cyan tones;
 * the artboards use lime #D7F75B and sky #6AA8F5, and darker inks on the
 * light theme. Class strings stay literal so Tailwind can see them.
 */
export const TONE = {
  /** Owner role, "custom" role, write scopes. Dark #4A5A1C / lime; light #C9DC7A / #4F6B00. */
  lime: 'border-[#4A5A1C] text-lime-ink [html[data-theme=light]_&]:border-[#C9DC7A] [html[data-theme=light]_&]:text-[#4F6B00]',
  /** Manager role, read scopes. Dark #1F3E6E / sky; light #B9D3F5 / #1562D6. */
  sky: 'border-[#1F3E6E] text-sky-ink [html[data-theme=light]_&]:border-[#B9D3F5] [html[data-theme=light]_&]:text-[#1562D6]',
  /** Neutral role and scope pills. Dark line-strong / #C4C8CD; light #CBD6E3 / #3F444A. */
  neutral: 'border-line-strong text-[#C4C8CD] [html[data-theme=light]_&]:border-[#CBD6E3] [html[data-theme=light]_&]:text-[#3F444A]',
  /** Paper 47 "Data" category. Dark line-strong / #C9CDD2; light #CBD6E3 / #5F656D. */
  data: 'border-line-strong text-[#C9CDD2] [html[data-theme=light]_&]:border-[#CBD6E3] [html[data-theme=light]_&]:text-[#5F656D]',
  /** Paper 56 read-only scopes. Dark line-strong / #C9CDD2; light #CBD6E3 / #3F444A. */
  scope: 'border-line-strong text-[#C9CDD2] [html[data-theme=light]_&]:border-[#CBD6E3] [html[data-theme=light]_&]:text-[#3F444A]',
  green: 'border-[var(--pill-green-border)] text-[var(--pill-green-text)]',
  amber: 'border-[var(--pill-amber-border)] text-[var(--pill-amber-text)]',
  red: 'border-[var(--pill-red-border)] text-[var(--pill-red-text)]',
}

/** Sky as text (links, "+ Add endpoint", legends). Light #1562D6. */
export const SKY_TEXT = 'text-sky-ink [html[data-theme=light]_&]:text-[#1562D6]'
/** Lime as text. Light #4F6B00. */
export const LIME_TEXT = 'text-lime-ink [html[data-theme=light]_&]:text-[#4F6B00]'

/**
 * Extra classes for `<GradientButton variant="lime">` on the light theme, as
 * drawn on L·22 Roles and 56 Integrations — Light only: #4F6B0066 0 8px 20px
 * -10px glow and a medium (not semibold) label. 47, 50 and 53 Light keep the
 * plain semibold button, so pages for those do not use this.
 */
export const LIME_BUTTON =
  '[html[data-theme=light]_&]:shadow-[0_8px_20px_-10px_#4F6B0066] [html[data-theme=light]_&>span]:font-medium'

/** 12/16 outlined pill (Paper py-1, 12px or 10px sides) in one of the tones above. */
export function TonePill({ tone = 'neutral', size = 'md', children, className = '', ...props }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border py-1 text-[12px] leading-4 ${
        size === 'sm' ? 'px-[10px]' : 'px-3'
      } ${TONE[tone] || TONE.neutral} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

/** Paper 22/23 switch: the ON track is solid #3D86E6 (not the brand gradient). */
export function SkyToggle({ checked, ...props }) {
  return (
    <Toggle
      checked={checked}
      {...props}
      style={checked ? { backgroundImage: 'none', backgroundColor: '#3D86E6' } : undefined}
    />
  )
}
