# DISCOVERIES.md — Parked Findings & Deferred Work

Items confirmed during development but intentionally deferred for later sessions.
Not blocking parity — revisit when prioritized.

## UI/UX Enhancements
- ~~**CSV template missing optional columns**: `generateCSVTemplate()` only outputs required fields; add `app`, `owner`, `sharing`, `read`, `write` columns with defaults~~ — **fixed S2**
- [ ] **"App scope reinstall" warning hint**: JS version warns user when current app is picked as storage context; form doesn't surface this guidance yet

## Bugs
- ~~**Pagination broken after ~30 entries**: Table only renders 30 credentials at a time; bulk importing 55 results in 30 shown on first page, remaining entries spread across miscounted pages. May be resolved during Splunk React UI component migration~~ — **resolved Task 7 S3** (Splunk Table/Paginator handles counting correctly now)

## Testing & Quality
- [ ] **Unit/integration test suite**: No tests exist for api.js or components; critical API paths (updateCredential, deleteCredential, getCredentialPassword) need coverage
- ~~**CSV import validation edge cases**: RFC 4180 compliance solid but could add per-row data sanitization checks before API calls~~

## Splunk Component Migration
- ~~**@splunk/react-ui adoption plan**: Current codebase uses vanilla DOM with inline styles; full parity achieved before migrating to native components~~ — **resolved Tasks 2-9 S3**
- [ ]**Dark theme awareness**: Only minimal CSS overrides exist; forms/tables could adopt Splunk design tokens for better visual consistency

## Technical Debt
- [ ] **error message sanitization**: `dangerouslySetInnerHTML` still used in ResultModal messages — works but leaves React invariant risks unfixed
- ~~**CSV import preview UX**: Shows raw text dump vs parsed table with per-row validation/errors (JS legacy does the latter)~~ — **fixed S2**

## Splunk REST Insights Discovered
- ACL updates require `/configs/conf-passwords/credential:${realm}:${username}:` path — NOT `${rest_uri}/acl` (returns 404)
- User-scoped credentials need temporary sharing bump(`user→app→fetch→user`) for password reveal and deletion
- `*` wildcard in role lists grants access to all roles; mutual-exclusion required with named roles

## Execution Lessons
- [ ] **Inline execution + heavy file overlap bloats context fast**: Tasks 1-9 touched up to 4 files concurrently(bundle.jsx, Modal.jsx, CredentialForm.jsx, CredentialTable.jsx), causing two compaction cycles where operator lost visibility on completion status. For future multi-task refactors: subagent-driven isolation preferred for 6+ tasks, OR prune mid-session after ~3–4 tasks to preserve tracking.
- [ ] **Bundle inflation from Splunk React UI**: Migrated components added ~850 KiB overhead (176 → 1082 KiB). Still passes <2MB constraint but headroom is tight — lazy-loading @splunk modules would help if additional components are added later.
- [ ] **Smoke test debugging produces no progress under pollution**: Multiple attempts to diagnose React #130 failed due to context drift. Lesson: revert to known-good baseline before investigating new errors, isolate one change at a time, use non-minified bundle for readable stack traces.

## Debugging & Failure Modes
- [ ] **`controlGroupDefault` unresolved reference (S4)**: React error #130 on page load references `controlGroupDefault` in CollapsiblePanel but no such token exists in our local bundle(grep returns nothing). Likely a webpack module resolution issue with @splunk/react-ui/ControlGroup — or CollapsiblePanel's internal controlGroup prop expecting something different. Needs isolated investigation.
- [ ] **Playwright headless modal interaction failure (S4)**: Create/Edit/Delete/Conflict tests share same failure — form submit clicks OK but API response never arrives. Suspicion: Splunk custom Modal(credential-form-modal) traps focus/events differently in headless Chromium. Roles are pre-selected(admin+power via DEFAULT_READ/WRITE), so validation isn't blocking it.
- [ ] **REST integration test is our reliable ground truth**: `test-rest-integration.js` covers full CRUD and passes all 12 checks reliably against Docker Splunk 10.2.2. Use this as the baseline when UI tests fail to determine if issue is API vs rendering layer.

## S5 — React Error #130 Fix & Fluent Theming
- `[ ] `React error #130 root cause: raw @splunk/react-ui module objects(e.g., { default: Component }) passed directly to React.createElement() throw "Objects are not valid as a React child". Fix: extract .default. Table and Select modules were missing it.  
- `[ ] `@fluentui/react` ThemeProvider approach was unverified guess — did not resolve CSS, added 2 MiB bloat. Splunk supplies its own global CSS; Webpack-bundled components don't tap into that plumbing. Always read splunkui.splunk.com before guessing.  
- `[ ] `Bundle inflation: Fluent v8 + @fluentui/react pushed bundle from ~1 MiB → 2.37 MiB(unverified dep). Reverted & uninstalled, back to ~1 MiB. 2MB cap binding — be conservative with new packages.  
