# Roles & permissions cleanup (proposal)

Status: proposal, nothing has been migrated. Designs 22 (Roles & permissions) and 23 (Member access) assume this target model.

## Today: three role concepts at once

| Concept | Where | Used by |
|---|---|---|
| Legacy `users.role` (`user` / `admin` / `super_admin`) | `convex/schema.ts` users | `components/ProtectedRoute.js` (ROLE_RANK), `hooks/usePermission.js` fallback, `UserManagement.js` dropdown, `lib/llmApiAuth.js`, `lib/tours/systemWalkthrough.js`, company registrations, `automations.js` ("staff" label). About 30 `super_admin` checks. |
| `memberships.roleKey` (`owner` / `admin` / `manager` / `field_staff` / `viewer` / custom) + `allLocations` / `locationIds` | `convex/memberships.ts`, `convex/lib/permissionCatalog.ts` | `can()` permission checks, roles settings |
| Team `lead` / `member` | `convex/teams.ts` | Team pages |

Other overlaps:
- `userInvites.role` (legacy) sits next to an optional `roleKey`.
- `users.locationIds` duplicates `memberships.locationIds`.
- The `owner` and `admin` templates are identical (both get every permission). The only difference is the owner-protection logic in `memberships.ts`.
- `ADMIN_ONLY` is one flat list of about 28 permissions. Managers therefore can't approve stocking or transfers (`production.stocking.approve`, `transfer.approve`), although the design shows them doing so.
- Approval limits and "sensitive" permission tiers don't exist yet.

## Target model

1. **Memberships are the single source of truth** for what a user can do inside a company. All UI and server checks go through `can(permission)` and the membership's location scope.
2. **Platform admin is separate.** Replace `users.role === 'super_admin'` with a `platformAdmins` table (or `users.isPlatformAdmin`). It applies only to `/admin/*`, company registrations and act-as, and every use is audited.
3. **Drop legacy roles.** Remove `users.role`, `userInvites.role` and `users.locationIds`. Invites carry `roleKey` and scope.
4. **Make owner meaningful.** Owner-only actions: billing and plan, deleting the company, transferring ownership, managing integrations or API keys (optional). Keep exactly one owner at a time and require ownership transfer before an owner leaves.
5. **Tier the permissions** instead of a flat `ADMIN_ONLY` list:
   - `sensitive`: finance edits, exports, role management, deletions. Admins only; MFA is required.
   - `approve`: stocking, transfers, top-ups, expenses. Managers by default.
   - `operate`: daily entry, sampling, feeding. Field staff.
   - `read`: viewer.
6. **Approval limits as role attributes**, for example `approvalLimits: { expenseGHS: 2000, transferFish: 10000 }`. Requests above the limit escalate to the next role (design 25 shows "over GHC 2,000 limit").
7. **Team lead becomes an assignment, not a role.** Rename it "crew lead". It routes tasks and notifications and grants no extra permissions.
8. **One label set everywhere:** Owner, Admin, Manager, Field staff, Viewer and custom roles. Stop showing "User" or "staff".

## Migration order (one PR each)

1. Backfill: every user gets a membership with a `roleKey` derived from the legacy role (`admin` → `admin`, `user` → `field_staff`) and a location scope copied from `users.locationIds`.
2. Add the platform admin flag or table, then move the `super_admin` checks to it.
3. Change `ProtectedRoute`, `usePermission`, `llmApiAuth`, tours and `UserManagement` to use `can()` and membership roles. Delete `ROLE_RANK`.
4. Split `ADMIN_ONLY` into tiers and give `manager` the approve tier. Add the owner-only permission set.
5. Add `approvalLimits` to roles and enforce them in the approval mutations.
6. Remove `users.role`, `userInvites.role` and `users.locationIds` from the schema (widen → migrate → narrow).

Run the security-audit skill before merging steps 2–4. They change authorization.
