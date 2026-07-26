# AI Assistant — page overrides

Overrides `MASTER.md` for the floating Farm AI panel.

## Brand lock (do not replace)

Keep **Tide Chart** tokens — do not use the generator’s purple/pink AI palette:

- Primary chrome: `lagoon-950` / `lagoon-800`
- Canvas: `foam` / `surface`
- Success / send: `kelp`
- Errors: `signal`
- Text: `chart-ink`
- Data: IBM Plex Mono where numeric

## Pattern

AI-Native UI (conversational) on Tide Chart chrome:

- Minimal floating panel, sticky input
- User bubbles right (lagoon), assistant left (foam)
- Clear “Farm AI” label (never present as a human)
- Typing indicator: 3-dot pulse (respect `prefers-reduced-motion`)
- Settings behind key icon (progressive disclosure)
- Provider + model + key form with visible focus rings

## Checklist (must pass)

- [x] Lucide icons only (Bot, not emoji)
- [x] `cursor-pointer` + 150–300ms transitions on controls
- [x] Focus-visible rings on inputs/buttons
- [x] Reduced-motion safe typing animation
- [x] Mobile: panel fits `min(100vw-2rem, 22rem)`
- [x] Clear “Farm AI” label (not presented as human)
