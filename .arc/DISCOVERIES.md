# DISCOVERIES.md — Parked Findings & Deferred Work

Items confirmed during development but intentionally deferred for later sessions.
Not blocking parity — revisit when prioritized.

## UI/UX Enhancements
- ~~**CSV template missing optional columns**: `generateCSVTemplate()` only outputs required fields; add `app`, `owner`, `sharing`, `read`, `write` columns with defaults~~ — **fixed S2**
- [ ] **"App scope reinstall" warning hint**: JS version warns user when current app is picked as storage context; form doesn't surface this guidance yet

## Bugs
- [ ] **Pagination broken after ~30 entries**: Table only renders 30 credentials at a time; bulk importing 55 results in 30 shown on first page, remaining entries spread across miscounted pages. May be resolved during Splunk React UI component migration.

## Testing & Quality
- [ ] **Unit/integration test suite**: No tests exist for api.js or components; critical API paths (updateCredential, deleteCredential, getCredentialPassword) need coverage
- ~~**CSV import validation edge cases**: RFC 4180 compliance solid but could add per-row data sanitization checks before API calls~~

## Splunk Component Migration
- [ ] **@splunk/react-ui adoption plan**: Current codebase uses vanilla DOM with inline styles; full parity achieved before migrating to native components
- [ ]**Dark theme awareness**: Only minimal CSS overrides exist; forms/tables could adopt Splunk design tokens for better visual consistency

## Technical Debt
- [ ] **error message sanitization**: `dangerouslySetInnerHTML` still used in ResultModal messages — works but leaves React invariant risks unfixed
- ~~**CSV import preview UX**: Shows raw text dump vs parsed table with per-row validation/errors (JS legacy does the latter)~~ — **fixed S2**

## Splunk REST Insights Discovered
- ACL updates require `/configs/conf-passwords/credential:${realm}:${username}:` path — NOT `${rest_uri}/acl` (returns 404)
- User-scoped credentials need temporary sharing bump (`user→app→fetch→user`) for password reveal and deletion
- `*` wildcard in role lists grants access to all roles; mutual-exclusion required with named roles
