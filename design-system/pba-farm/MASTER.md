# Design System — PBA Farm (charcoal light)

> Source: UI/UX Pro Max Soft UI + light dashboard guidance. Chrome uses zinc charcoal on white — not teal, not purple.

## Chrome (sidebar + primary buttons)

| Role | Hex | Notes |
|------|-----|--------|
| Primary / sidebar | `#18181B` | zinc-900 — soft black on white |
| Hover / elevated | `#27272A` | zinc-800 |
| Subtle chrome | `#3F3F46` | zinc-700 |
| On primary | `#FFFFFF` | |
| Canvas | `#F8FAFC` | cool near-white |
| Card | `#FFFFFF` | |
| Border | `#E4E4E7` | zinc-200 |
| Muted text | `#71717A` | |
| Success | `#15803D` | keep for positive metrics only |
| Danger | `#DC2626` | |

## Rules

- Sidebar + primary CTAs use charcoal only (high contrast on white).
- Active nav item: white chip on charcoal sidebar.
- Do not use purple / teal as chrome.
- Buttons: min-height ≥ 44px; hover 150–300ms; visible focus ring.
- Prefer reusable `components/ui` Button / Card / StatCard.
