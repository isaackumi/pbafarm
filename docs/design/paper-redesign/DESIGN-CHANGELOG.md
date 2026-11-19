# Design changelog (Paper → code)

Paper is the source of truth. The designer adds an entry here for every Paper change, newest first. The build agent re-reads this file before each PR, implements every entry marked `pending`, and then flips it to `built in #PR`.

Format: `date · artboard (node id) · change · status`

## 2026-11-19

- 27–32 (9GK-0, 9OW-0, 9XM-0, A4K-0, ACU-0, AJU-0) · new: Compliance, Sensors, Procurement, Notifications, Account & security, Customization · pending
- 24 Sales (98M-0) · rebuilt: customer and lot merged into one cell, table column fixed at 700px · pending
- Light theme page (p-3-0) · light tokens for 01, 02, 03, 10, 15, 21, 22 · tokens built in #90 · pages pending
- 22 / 23 · roles model assumptions documented in ROLES-CLEANUP.md (UI first, backend later) · pending

## 2026-11-18

- 01–26 + Shell 7Z-0 + Website 3I0-0 · initial redesign · Shell 7Z-0 built in #90 · pages pending
