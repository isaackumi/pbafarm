# Design changelog (Paper → code)

Paper is the source of truth. The designer adds an entry here for every Paper change, newest first. The build agent re-reads this file before each PR, implements every entry marked `pending`, and then flips it to `built in #PR`.

Format: `date · artboard (node id) · change · status`

## 2026-11-19

- ALL · **The AI is now named "Anowa"** (named after the founder's mother) · replaces "Ask PBA", "AI assistant" and "Farm Assistant" everywhere:
  - Paper: 17 (3UX-0) title and eyebrow are "Anowa"; the composer placeholder reads "Ask Anowa about cages, feed, costs…". Permission rows in 22 (57B-0) and light 22 (7BH-0) read "Use Anowa AI" and "Use Anowa (own unit data)". On the landing page (B9Q-0), the chip reads "Meet Anowa — your farm’s AI co-pilot", and the cards, footer and pricing say "Anowa". The WhatsApp bot (CJH-0) is named "Anowa" with an "A" avatar.
  - Code to update: `components/AiAssistant.js` (header label and the `sr-only` "Assistant:" prefix become "Anowa"), `pages/company-settings.js` ("Enable Anowa (AI assistant) for this company"), nav labels and tour copy in `locales/en.json` and `fr.json` (keep the name "Anowa" untranslated), the `X-Title` header in `convex/lib/llmProviders.ts` ("PBA Farm · Anowa"), the WhatsApp bot display name, and the server-built system prompt (it should introduce itself as "Anowa, PBA Farm's assistant"). Keep the route `/ai` unchanged. · pending

- Website · Landing v2 — Sky (B9Q-0) · ELEVATED (same artboard, supersedes the v2 entry below):
  - Editorial type: every section headline pairs Inter Tight with an **Instrument Serif italic** accent ("data, not *guesswork*", "*and traceable*", "*in one calm place*", "*without the spreadsheets*", "*not per seat*", "*answered*", "*finally in one place*"). Load Instrument Serif (400 + italic) on marketing pages only.
  - Hero polish: the nine cards now fan out in an arc using `rotate()` (−14°, −10°, −6°, −3°, 0, 3°, 6°, 10°, 14°, with the outer cards dropping up to 34px) instead of `skewY`. A blurred white haze softens the horizon line. A soft white glow (blur 90px, 14% opacity) sits behind the headline. Lake shimmer lines are kept clear of the rating.
  - Glass nav: links sit in a translucent pill (`#FFFFFF1F`, 1px `#FFFFFF38`); the active link is a white pill.
  - NEW Live ticker (C5L-0) under the logos: an ink pill with a lime "Live · 320 farms" badge and a horizontally scrolling marquee of farm events (CSS marquee animation, pause on hover, respect `prefers-reduced-motion`).
  - NEW Showcase — underwater (C70-0) after About: sky top → wavy waterline → deep-water gradient with blurred light rays, bubbles and fish silhouettes. Inside sits the framed Home product shot **D9N-0 (a copy of 3J1-0, 1200×847, the real 01 Home layout)**, with four floating chips overlapping its edges. Section height is 1200px (live DO sensor, Ask PBA, offline queue, lot QR trace). Animate: rays drift slowly, bubbles rise, chips float ±6px.
  - NEW Testimonial (CC6-0) before Pricing: large serif-italic quote, avatar, three metrics divided by hairlines.
  - NEW FAQ (CCQ-0) after Pricing: left heading and a WhatsApp CTA; right accordion (first item open, lime minus button).
  - Footer: giant clipped "pba farm" wordmark (Inter Tight 300px, `#EEF2F6`) behind the footer columns. · pending

- Website · Landing v2 — Sky (B9Q-0) · NEW, replaces Landing 3I0-0 for `/`:
  - Sky-blue hero with blurred clouds and a lake horizon with cage rings.
  - Nine floating product cards in an arc. CSS `skewY` is allowed; scale and fade them on narrow screens.
  - Marketing-only lime accent `#D7F75B` with an ink arrow button.
  - DM Mono uppercase labels; Inter Tight 400 headlines at -0.045em.
  - Sections: logo strip, headline with inline icon pills, stats grid, three product cards, dark "Stock → Sell" strip with a dashed line, per-cage pricing, sky CTA, footer.
  - Clouds are blurred white ellipses (`filter: blur`). Use CSS, no images. · pending

- Brand page p-5-0 "Anowa — Pulse", logo EMT-0 · rebrand PBA Farm → Anowa: Pulse mark (heartbeat → fish tail, coral `#F2A07B` dot) and lowercase Geist Mono wordmark in Sidebar, Header, auth, onboarding, billing shell, platform console and landing; favicon, apple-touch, PWA 192/512/maskable icons, OG image; theme tokens unchanged · built in this PR (chore/rebrand-anowa)
- 58 Anowa settings (FUF-0) · assistant renamed: nav "Anowa", page "Ask Anowa" (FR "Demander à Anowa") · built in this PR (chore/rebrand-anowa)
- 27–32 (9GK-0, 9OW-0, 9XM-0, A4K-0, ACU-0, AJU-0) · new: Compliance, Sensors, Procurement, Notifications, Account & security, Customization · built in #97–#103
- 24 Sales (98M-0) · rebuilt: customer and lot merged into one cell, table column fixed at 700px · built in #97–#103
- Light theme page (p-3-0) · light tokens for 01, 02, 03, 10, 15, 21, 22 · tokens built in #90 · pages built in #97–#103
- 22 / 23 · roles model assumptions documented in ROLES-CLEANUP.md (UI first, backend later) · pending

## 2026-11-18

- 01–26 + Shell 7Z-0 + Website 3I0-0 · initial redesign · Shell 7Z-0 built in #90 · pages built in #97–#103 (20 Projects not built)
