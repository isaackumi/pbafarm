# Anowa logo guidelines (v1.0)

**Chosen concept: 12 — Pulse.** A heartbeat line that turns into a fish tail stands for live monitoring of the farm's vital signs. The coral dot is the moment Anowa notices something, which is where every alert begins. The Paper board "Anowa — logo (final)" (EMT-0) on the "Brand — Anowa" page is the reference.

## Files (`logo/`)

| Asset | Files | Use |
|---|---|---|
| Horizontal lockup | `anowa-horizontal-{color,reversed,black,white}.svg` | Default: app header, website nav, documents |
| Stacked lockup | `anowa-stacked-{…}.svg` | Square spaces: sign-in, splash, social |
| Mark | `anowa-mark-{…}.svg` | Avatars, sidebar when collapsed, small placements |
| Wordmark | `anowa-wordmark-{…}.svg` | Where the mark already appears nearby |
| App icon | `anowa-app-icon.svg`, `anowa-app-icon-maskable.svg`, `png/anowa-app-icon-{1024,512,192,180}.png`, `png/anowa-app-icon-maskable-512.png` | PWA manifest, iOS (180 for apple-touch), stores |
| Favicon | `favicon.svg` (switches to Sand in dark mode), `png/favicon-{32,16}.png` | Browser tab |

Variants:
- `color`: Ink line and wordmark with a Coral dot, on light backgrounds.
- `reversed`: Sand line and wordmark with a Coral dot, on Deep or Ink.
- `black` / `white`: one colour, for print, embossing or photos.

The wordmark is "anowa" in Geist Mono Medium at −0.02em tracking, converted to outlines, so no font is needed. Rebuild everything with `logo/build.py`. It needs `fonttools` and the Geist font release, and the paths are at the top of the file.

## Rules

- **Clear space:** 2 × the coral dot's diameter on every side.
- **Minimum size:**
  - Horizontal lockup: 96px wide on screen, 25mm in print.
  - Stacked lockup: 64px wide.
  - Mark: 16px.
  - Below 96px wide, use the mark or the app icon.
- **The dot is always Coral `#F2A07B`.** It is never Lime or Lake. In the one-colour versions it matches the line.
- **Backgrounds:** use flat Sand, White, Deep, Ink or Lake. Avoid photos and gradients unless there is a solid backing plate.
- **Don't:** rotate or skew it, recolour the dot, change the spacing between the mark and the wordmark, add outlines or shadows, or animate the shape. The only motion allowed is a single "pulse" draw-on during loading.

## Colour

| Name | Hex | Role |
|---|---|---|
| Ink | `#0B0D10` | Line and wordmark on light |
| Sand | `#F4F0E8` | Line and wordmark on dark; brand background |
| Coral | `#F2A07B` | The dot |
| Deep | `#06121C` | App icon and dark surfaces |
| Lake | `#0E6B86` | Secondary brand colour |
| Lime | `#D7F75B` | Product UI accent only, never in the logo |
