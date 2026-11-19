# Design changelog (Paper → code)

Paper is the source of truth. The designer adds an entry here for every Paper change, newest first. The build agent re-reads this file before each PR, implements every entry marked `pending`, and then flips it to `built in #PR`.

Format: `date · artboard (node id) · change · status`

## 2026-11-19

- 01 Home · Light theme page, "L · 01 Home — Sky & lake (proposal v2)" (INK-0, layer "Sky & lake panel") · optional "Sky & lake" header: each user picks Plain or Sky & lake under Account → Preferences (`dashboard.homeHeader`, default plain); night variant for dark theme · built in #3
- Brand page p-5-0 "Anowa — Pulse", logo EMT-0 · rebrand PBA Farm → Anowa: Pulse mark (heartbeat → fish tail, coral `#F2A07B` dot) and lowercase Geist Mono wordmark in Sidebar, Header, auth, onboarding, billing shell, platform console and landing; favicon, apple-touch, PWA 192/512/maskable icons, OG image; theme tokens unchanged · built in this PR (chore/rebrand-anowa)
- 58 Anowa settings (FUF-0) · assistant renamed: nav "Anowa", page "Ask Anowa" (FR "Demander à Anowa") · built in this PR (chore/rebrand-anowa)
- 27–32 (9GK-0, 9OW-0, 9XM-0, A4K-0, ACU-0, AJU-0) · new: Compliance, Sensors, Procurement, Notifications, Account & security, Customization · built in #97–#103
- 24 Sales (98M-0) · rebuilt: customer and lot merged into one cell, table column fixed at 700px · built in #97–#103
- Light theme page (p-3-0) · light tokens for 01, 02, 03, 10, 15, 21, 22 · tokens built in #90 · pages built in #97–#103
- 22 / 23 · roles model assumptions documented in ROLES-CLEANUP.md (UI first, backend later) · pending

## 2026-11-18

- 01–26 + Shell 7Z-0 + Website 3I0-0 · initial redesign · Shell 7Z-0 built in #90 · pages built in #97–#103 (20 Projects not built)
