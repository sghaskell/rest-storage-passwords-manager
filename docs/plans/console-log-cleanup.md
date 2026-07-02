# Plan: Console.log Spam Cleanup

## Goal

Remove debug-only `console.log` statements that fire during normal operation. Keep all `console.error` (genuine failures) and `console.warn` (expected-but-recoverable conditions) since those are useful for troubleshooting.

## Inventory (75 total console statements across 9 files)

### REMOVE — Debug spam (7 lines)

| File | Lines | Statement | Why remove |
|------|-------|-----------|------------|
| `components/RoleAccessDashboard.jsx` | 131–134 | `console.log('[RoleAccess] rolesWithCapabilities:', ...)` (×4) | Dumps full objects on every `useMemo` recompute — noisy during normal operation |
| `bundle.jsx` | 136 | `console.log('Credential Manager: Script loaded')` | Fires every page load |
| `bundle.jsx` | 2096 | `console.log('Credential Manager: Initializing...')` | Fires every page load |
| `bundle.jsx` | 2111 | `console.log('Credential Manager: Render complete')` | Fires every page load |

### KEEP — Error logging (all `console.error`)

All `console.error` statements are genuine failure handlers:
- `api.js`: Error fetching/creating/updating/deleting credentials, rotation failures
- `bundle.jsx`: Error loading credentials, duplicate scan failures, create/update/delete failures
- Components: Audit log fetch, credential history fetch, bulk role assignment, password rotation, undo

### KEEP — Warning logging (all `console.warn`)

All `console.warn` statements are expected-but-recoverable conditions:
- KVStore collections unavailable (`[TAGS][LOAD]`, `[EXPIRY][LOAD]`)
- ACL bump failed during password fetch
- 404 fallback paths during credential delete
- Expiry/tag save failures that don't block the main credential operation

These are the exact conditions an admin would want to see when troubleshooting.

### KEEP — One-time migration log

| File | Line | Statement |
|------|------|-----------|
| `api.js` | 1948 | `console.log('[POLICY] Migrated localStorage policy to KVStore')` |

One-time migration. Could revisit removal after the migration epoch passes.

## Changes

| File | Action |
|------|--------|
| `components/RoleAccessDashboard.jsx` | Remove lines 131–134 (4 console.log statements) |
| `bundle.jsx` | Remove line 136 (1 console.log statement) |
| `bundle.jsx` | Remove line 2096 (1 console.log statement) |
| `bundle.jsx` | Remove line 2111 (1 console.log statement) |

**Total: 7 lines removed. Zero behavioral change.**
