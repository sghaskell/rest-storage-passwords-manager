# Playwright Bug-Surface Test Suite Design
**Date:** 2026-05-08  
**Agent:** Qwen3-27B (via opencode)  
**Project:** REST Storage Passwords Manager — Splunk React Dashboard

## Context & Problem

The existing Playwright smoke test (`tests/smoke-test.spec.js`) has 4 passing and 3 failing tests out of 7. The failures share a single root cause:

- **Root cause:** `@fluentui/react` Layer portal (`ModalLayerStyles__StyledClickAwayOverlay`, rendered via Splunk's Modal) sits atop the form buttons in headless Chromium mode. Click events on `<button type="submit">` are intercepted by this invisible overlay, so API calls never fire.
- **Secondary issue:** `[role="dialog"]` selectors match Splunk's hidden "noconnection" dialog instead of our credential form modal, causing wrong-element interactions.

Additionally, several areas lack any test coverage: parse-csv edge cases, per-field input validation, console error detection, pagination/filter/sort behavior, bulk operations, and API request body correctness.

## Goal

Expand the test suite across 3 layers to surface outstanding bugs in the React component refactor — modal interaction resilience, API wire format verification, and React runtime error capture.

**Target outcome:** 18 new tests covering create (3 variants), update (2), delete (2), bulk operations (2), CSV import (3), console errors (2), navigation/filter/sort/pagination (4), template download (1). Existing 7 tests preserved with locator fixes where applicable.

## Architecture: 3 Independent Test Files, All Headless-Resilient

The approach is split across 3 files for isolation — each test file can run independently via `--grep` or by name.

```
tests/
  smoke-test.spec.js          (existing, preserved + locator fixes)
  api-intercept.spec.js       (new: network interception + per-field validation)
  edge-cases.spec.js          (new: console errors, table interactions, pagination)
```

### Shared Helpers (collocating in each file vs shared module)

Each file defines the same `loginToSplunk(page)` and `navigateToDashboard(page)` helpers from the existing smoke tests. No shared utility module needed — duplication is ~20 lines per file and keeps tests self-contained. Alternatively, if we extract to `tests/helpers.js`, that's a follow-up task.

**Decision:** Inline helpers in each file for now. Extraction only if test set grows beyond 3 files.

## Layer 1: Modal Interaction Fix (smoke-test.spec.js + new api-intercept tests)

### Fix strategy, attempted in order

1. **Scoped dialog locator**: `#credential-manager-app [role="dialog"]` — restricts to our React root, excludes Splunk's global hidden dialogs
2. **Close overlay before click**: `await page.locator('[data-test="modal-overlay"]').first().click()` — dismisses the interfering Layer portal
3. **Force click**: `locator.click({ force: true })` — bypasses pointer-event interception (works if overlay doesn't consume event)
4. **Keyboard-tab strategy**: If all above fail, use `page.keyboard.press('Tab')` to focus Create button, then `page.keyboard.press('Enter')` to submit

These fixes apply to all tests that need form interaction: create, edit, delete, CSV import. If none resolve the headless overlay issue, Layer 1 is deferred and we rely on Layer 2 (network intercept) for verification — which is resilient regardless of modal UI issues.

### Tests affected by fix
- `should create a new credential via the form` (existing, line 169)
- `should update an existing credential` (existing, line 244)
- `should delete a credential and confirm removal from the table` (existing, line 323)
- `should show conflict error when creating duplicate credential` (existing, line 399)

## Layer 2: Network Interception + Per-Field Validation (api-intercept.spec.js)

### Technique

```javascript
// Intercept and forward requests while capturing bodies
page.route('**/splunkd/__raw/**storage/passwords**', route => {
  const request = route.request();
  apiCalls.push({
    url: request.url(),
    method: request.method(),
    postData: request.postData(),
    headers: request.headers(),
  });
  route.continue();
});
```

`apiCalls` array is cleared before each test, asserted after interactions. Combined with `page.waitForResponse()` to know when calls complete.

### Test Suite

#### Create Credential — Baseline (existing test rework)
Navigate, click "Create Credential", fill form (username + password only), submit. Verify:
- POST to `/storage/passwords` contains `username`, `password`, `realm=` in body
- POST to ACL path contains `perms.read=admin,power&perms.write=admin,power&sharing=app&owner=nobody`
- Table row appears with correct name

#### Create Credential — Per-Field App/Owner Validation
Fill form with non-default values: app=`some-other-app`, owner=`specific-user`, read roles=`admin`, write roles=`admin, power`. Intercept both calls and assert:
- Body: `username=...&password=...&realm=...` (only 3 fields, ACL is separate)
- ACL body: exact role list match, correct app/owner/sharing
- **Key coverage:** confirms that form dropdown → body mapping is correct for all select fields

#### Create Credential — Per-Field Realm/Sharing Validation
Fill form with realm value and `sharing=global` (and separately `sharing=user`). Assert ACL POST carries correct `sharing` and that both calls use correct owner/app path.

#### Update Credential — Baseline
Click Edit on existing row, submit without changes. Verify:
- No POST to `/storage/passwords/{stanza}` (password not changed → request skipped)
- ACL bump POST fires with correct roles

#### Update Credential — Password Change Only
Toggle "Change password" switch, fill new password, submit. Intercept and verify:
- POST to `/storage/passwords/{stanza}` body contains ONLY `password=newpass&output_mode=json` (not username/realm)
- ACL bump + final ACL POST both fire

#### Delete Credential — Baseline
Click Delete on row. Verify:
- ACL bump POST fires before DELETE
- DELETE request path is `/servicesNS/{owner}/{app}/storage/passwords/{stanza}`
- Table row disappears from DOM

#### Bulk Delete Verification
Select 2+ rows via checkboxes, click "Delete Selected (N)". Verify N DELETE calls fire with correct stanza keys.

### CSV Import Tests

#### Happy Path — Small File
Click "Import CSV", use `page.setInputFiles('input[type="file"]', pathToCsv)`, verify parsed preview shows 3 rows. Click "Import", intercept 3 POSTs. Assert each credential created with correct app/owner defaults.

- Test CSV: `/tmp/playwright-test-input.csv` — generated by test helper at runtime with `fs.writeFileSync()`

#### Parse Errors Skipped Rows
CSV with one row missing password. Verify skipped rows still fire for remaining valid rows, error count matches.

#### Conflict Handling in Import
CSV with duplicate of existing credential. Verify 409 error doesn't crash import, non-duplicate rows still succeed.

### Template Download Test

Click "Download Template", `page.waitForEvent('download')`, read CSV content. Assert:
- Header row contains all 8 columns: `username,password,realm,app,owner,sharing,read,write`
- Example row present with current app and owner defaults
- Comments included (`#` prefixed lines)

## Layer 3: Console Error Capture + Edge Cases (edge-cases.spec.js)

### Shared Console Fixture Pattern

Applied to ALL tests in this file (and optionally grafted onto `smoke-test.spec.js`):

```javascript
test.use({ javaScriptEnabled: true }); // default, explicit for clarity

let consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', err => {
  consoleErrors.push(`[PAGEERROR] ${err.message}`);
});

// After navigation/setup, assert:
expect(consoleErrors.filter(e => e.includes('Error #'))).toEqual([]);
```

### Console Error Capture Test

Navigate to dashboard, wait for React render. Assert no React Error #130 or `controlGroupDefault` errors in console. This is our sentinel check — if it fails after a refactor, we know the bundle has unresolved references.

### Navigation + Container Load Test

Verify:
- Dashboard navigates successfully (reuse existing pattern)
- `#credential-manager-app` container visible within 20s
- Table renders with headers
- No JavaScript errors in console

### Filter + Sort Tests

#### Filter by Username
Type text into search input. Wait for filtered results. Assert only rows containing the filter term are visible (row count decreases). Clear filter, verify all rows return.

#### Sort Order Change
Click sort header (Name column). Verify first row changes — either a different credential appears at top or same order confirms it was already sorted. Click again for descending. Row set remains same size.

#### Filter Type Selection
Change dropdown from "All Fields" to "Username" then filter. Verify filtering is scoped to correct column subset.

### Pagination Test

#### Paginate Through Pages (if >10 items exist)
If table has more than 10 credentials, click next page button. Verify different set of rows appears. Current page number updates in paginator component. Click previous, verify original set returns.

- If <10 items: skip assertion gracefully with `test.skip(tableCount <= 10)`

### Bulk Selection State Test

- Click first checkbox → verify "1 selected" counter appears next to toolbar
- Click select-all header checkbox → verify `N selected` matches total row count
- Deselect all via "Delete Selected (N)" button click or manual → counter clears

## Error Handling Strategy

All tests use try-catch where operations may fail:
- Failed test is reported with its name + assertion failure — no silent passes
- Console errors are surfaced as `console.error` output even if the operation succeeds, so they accumulate in CI logs for review

## File Structure Post-Implementation

```
tests/
  smoke-test.spec.js       (7 existing tests + locator fixes → baseline preservation)
  api-intercept.spec.js    (10 new: create×3, update×2, delete×1, bulk×1, csv×3, template×1)
  edge-cases.spec.js       (8 new: console errors×2, navigation×1, filter×3, pagination×1, selection×1)
```

**Total: ~18 tests across all layers.** Running via `npx playwright test` (same config). Individual runs: `playwright test --grep 'api-intercept'`.

## Out of Scope

- Full regression suite for all password-crud.js behavior (that's the JS tests' job)
- Visual comparison / screenshot assertions (requires baseline capture tooling like Percy or Playwright screenshots stored as fixture — not needed for bug detection)
- Performance / load testing (Splunk REST API is the bottleneck, not React UI at these scales)

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Headless overlay blocks all form interaction in Layer 1 | Medium | Network intercept tests (Layer 2) are resilient regardless of UI outcome — if force/tab don't work, we have API-level coverage anyway |
| `page.setInputFiles()` blocked by modal dialog layer in CSV import | Low | File input is native HTML `<input type="file">`, Playwright bypasses click for direct assignment. Overlay won't interfere with programmatic file setting. Only "Import" button click might still be blocked. |
| Splunk Docker state drift (leftover test credentials) | Medium | Each test uses timestamped names (`test-create-{timestamp}`), cleanup after each test. If cleanup fails, orphan is logged but doesn't affect subsequent tests. |
| Test timeout on slow Splunk API response | Low | 120s timeout per operation in Layer 2 (longer than smoke-test 60s), appropriate for multi-step API chains with network interception overhead. |
