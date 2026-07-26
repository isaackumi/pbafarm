# Design System Master File — Tide Chart

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> Page files override this Master. Do **not** use purple/pink AI-default palettes.

---

**Project:** PBA Farm  
**Theme:** Tide Chart (aquaculture ops)  
**Updated:** 2026-07-25

---

## Color Palette

| Role | Hex | Token / class |
|------|-----|----------------|
| Sidebar / chrome | `#062A33` | `lagoon-950` |
| Primary actions | `#0B4A58` | `lagoon-800` |
| Primary hover | `#0E5C6E` | `lagoon-700` |
| App canvas | `#F3F7F6` | `foam` |
| Borders / dividers | `#E4EEEB` | `foam-deep` |
| Success / stock OK | `#2F6B4F` | `kelp` |
| Alerts / errors | `#C45C26` | `signal` |
| Body text | `#1A2B32` | `chart-ink` |
| Secondary text | `#5A6F76` | `muted` |
| Surfaces / cards | `#FFFFFF` | `surface` |

**Avoid:** purple gradients, cream+terracotta brochure look, broadsheet hairlines, glow, emoji-as-icons.

## Typography

- Display (login brand): **Fraunces** → `font-display`
- UI: **Source Sans 3** → `font-sans`
- Data / tables: **IBM Plex Mono** → `font-data`

## Shared classes (globals)

- `.page-shell` — page background + padding
- `.page-card` — white surface panel
- `.page-title` — page H1
- `.btn-primary` / `.btn-secondary` / `.btn-danger`
- `.input-field` — form controls
- `.table-shell` — table container

## UX checklist

- Lucide icons only
- `cursor-pointer` + 150–300ms transitions on controls
- Focus-visible rings (`lagoon-800`)
- Loading skeletons/spinners — never blank freeze
- Dense ops tables with mono numerals
- Respect `prefers-reduced-motion`
