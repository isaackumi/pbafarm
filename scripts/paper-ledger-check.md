# Paper ledger check

Run this before starting UI work and at the end of every UI PR. It tells you which Paper artboards changed since they were last hashed, so no design change is missed. Rules: [docs/design/README.md](../docs/design/README.md).

A Node script can't call the Paper MCP, so the agent dumps the JSX and the script compares it with the ledger offline.

## 1. List the artboards

Paper file `01M7RD5Z2VX87M2KSRH9YKX8XA`. Call `get_basic_info({fileId, pageId})` for each page in scope:

| Page | id |
|---|---|
| Anowa app · Desktop | `p-1-0` |
| Anowa app · Remaining screens | `p-6-0` |
| Anowa app · Light theme | `p-3-0` |
| Anowa app · Cage keepers (proposed) | `p-D-2` |
| Anowa app · Telegram (proposed) | `p-G-0` |
| Anowa app · Console, bot & AI | `p-4-0` |
| Anowa · Emails | `p-E-0` |

Client websites, the marketing site, the brand page and Scratch pages are out of scope. If a new app page appears in the `pages` list, add it to this table, to `pages` in `docs/design/paper-ledger.json`, and dump it too.

## 2. Dump the JSX

For every artboard id, call:

```
get_jsx({ fileId: "01M7RD5Z2VX87M2KSRH9YKX8XA", nodeId: "<id>", includeNodeIds: false, format: "inline-styles" })
```

Write one JSON file outside the repo (for example `/tmp/paper-dump.json`) shaped `{ "<id>": "<jsx text>" }`. Use the JSX text exactly as returned, not the file-header block that comes before it (the script also accepts the raw content array and takes its last block). Don't reformat or trim it: the hash is sha256 of that exact text.

Tip: the Paper desktop app also serves the MCP over HTTP on the local machine (`http://127.0.0.1:29979/mcp`), so a short local script can make the same `tools/call` requests and write the dump without pasting 100+ artboards through a chat context.

## 3. Compare

```
node scripts/paper-ledger.mjs /tmp/paper-dump.json
```

It prints one line per difference and exits 1 if there are any:

- **CHANGED**: the hash differs. The artboard changed in Paper, so its screen needs a rebuild. Open the artboard (screenshot + JSX) and diff it against the code.
- **NEW**: in Paper, not in the ledger. Add a full entry (name, page, theme, width, route, status).
- **REMOVED**: in the ledger, not in Paper. Find out why (renamed, deleted, moved to another page) and fix the entry or remove it by hand.

## 4. Record

When the changes are understood:

```
node scripts/paper-ledger.mjs /tmp/paper-dump.json --write
```

This stores the new hashes and `hashedAt`, clears `verifiedAt` on changed artboards (their browser check no longer holds), appends stubs for new artboards, and regenerates `docs/design/paper-ledger.md`. It never deletes entries or changes a status: set `status`, `route`, `implementation`, `notes` and, after a browser check, `verifiedAt` by hand, then run `node scripts/paper-ledger.mjs --md`.

Other commands: `--validate` checks the ledger's shape, `--ledger <path>` points at another ledger file.
