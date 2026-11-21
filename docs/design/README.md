# Paper designs

Paper is the source of truth for the Anowa UI. Every artboard in scope is tracked in [paper-ledger.json](./paper-ledger.json), shown as a table in [paper-ledger.md](./paper-ledger.md) (generated, don't edit by hand).

Paper file `01M7RD5Z2VX87M2KSRH9YKX8XA`. Pages in scope: Anowa app · Desktop, Remaining screens, Light theme, Cage keepers (proposed), Telegram (proposed), Console, bot & AI, and Anowa · Emails.

## Rules

1. **Paper wins.** When code and Paper differ, the code is wrong unless the owner says otherwise. Don't improvise a section that isn't in Paper.
2. **Run the ledger check** ([scripts/paper-ledger-check.md](../../scripts/paper-ledger-check.md)) before starting UI work and again at the end of every UI PR. Any CHANGED artboard you touch must be rebuilt to match, not just re-hashed.
3. **Every UI PR names the artboard ids it implements** (for example `IH-0`, `6LO-0`) and updates their ledger entries: `status`, `route`, `implementation`, `notes`, and `verifiedAt` after the browser check.
4. **"built" means checked in a browser.** An artboard is `built` only after the screen was compared in a browser with the artboard's screenshot and JSX, at the artboard's width and theme, and every top-level section is there. Then set `verifiedAt` to that date.
5. **Never mark an artboard built from an agent report alone.** Status comes from the code and the browser, not from PR descriptions. When unsure, use `partial` and say in `notes` what's missing.
6. **Don't edit the Paper file** while implementing. Design changes go to the designer/owner.

## Statuses

| Status | Meaning |
|---|---|
| `built` | Implemented, every top-level section present, verified in the browser. |
| `partial` | Some sections exist; `notes` lists what's missing or different. |
| `not-built` | No implementation yet. |
| `proposal` | A design awaiting owner approval. Don't build it until approved. |
| `superseded` | Replaced by a newer artboard (named in `notes`). Don't build it. |

## Entry fields

`id`, `name`, `page`, `theme` (`dark`/`light`), `width`, `route` (app route, or the component/template file when it isn't a page), `implementation` (main files), `status`, `jsxHash` (sha256 of the artboard's `get_jsx` output with `includeNodeIds:false`, `format:"inline-styles"`), `hashedAt`, `verifiedAt` (date of the last browser check, or null), `notes`.

The initial statuses (November 2026) were set from a code read, not a browser check, so every `verifiedAt` starts as null.

Older planning docs live in [paper-redesign/](./paper-redesign/); where they disagree with the ledger, the ledger wins.
