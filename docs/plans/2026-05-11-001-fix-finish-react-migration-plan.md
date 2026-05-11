---
title: Finish React Migration — CSS, Tests, Parity
type: fix
status: active
date: 2026-05-11
origin: docs/brainstorms/finish-react-migration-requirements.md
---

# Finish React Migration — CSS, Tests, Parity

## Summary

Externalize `styled-components` in webpack to share Splunk's global instance and restore CSS styling to all `@splunk/react-ui` components. Harden Playwright headless modal interactions to eliminate test failures. Verify bundle size, REST integration, and full feature parity with the legacy JS app.

---

## Problem Frame

The React migration is structurally complete — all components render, all CRUD operations work, and the bundle is under the 2 MB cap. However, `@splunk/react-ui` components render with no CSS styling due to a duplicate `styled-components` instance (webpack bundles one copy, Splunk's global context loads another). Additionally, Playwright headless tests fail due to modal interaction timing issues in headless Chromium. See origin document for full problem frame.

---

## Requirements

- R1. `@splunk/react-ui` components (Table, Button, Select, Modal, Form fields) render with proper Splunk styling — visual parity with documented Splunk React UI examples
- R2. `styled-components` must not be bundled — externalize in webpack to share Splunk's global instance and eliminate duplicate context
- R3. Playwright headless CRUD tests pass — create, edit, delete, and CSV import operations complete successfully in headless Chromium
- R4. REST integration test (`test-rest-integration.js`) continues to pass all 12 checks against Docker Splunk 10.2.2
- R5. Dashboard `.spl` loads the React bundle (`react/bundle.js`) as default — **already satisfied**, `default/data/ui/views/credential_management.xml` already has `script="react/bundle.js"`
- R6. `npm run build` produces a clean bundle under 2 MB; no unverified dependencies added
- R7. React app behavior matches the legacy JS version exactly — all CRUD operations, ACL controls, CSV import, bulk delete, password reveal, and filtering work identically

**Origin acceptance examples:** [AE1 (covers R1, R2), AE2 (covers R3), AE3 (covers R5)]

---

## Scope Boundaries

- Dark theme CSS overrides beyond native component defaults
- Unit/integration test suite for api.js or components
- Error message sanitization (`dangerouslySetInnerHTML` removal in ResultModal)
- Bundle optimization (lazy-loading, code splitting)
- New feature development (app scope reinstall warning, CSV enhancements)
- Legacy JS file deletion — files remain in repo, only stop loading

---

## Context & Research

### Relevant Code and Patterns

- `webpack.config.js` — current `externals: {}`, needs styled-components entry
- `appserver/static/react/bundle.jsx` — entry point, uses `@splunk/react-ui` components and `SplunkThemeProvider`
- `appserver/static/react/components/Modal.jsx` — Modal, PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal
- `appserver/static/react/components/CredentialTable.jsx` — Table, Paginator, Chip, Button components
- `appserver/static/react/components/CredentialForm.jsx` — Text, Select, Multiselect, Switch, ControlGroup components
- `tests/smoke-test.spec.js` — 7 Playwright tests, headless mode, modal interactions in tests 3-5
- `tests/test-rest-integration.js` — 12-step REST API validation, curl-based, no changes expected
- `playwright.config.js` — headless: true, 60s timeout, 1280x720 viewport

### Institutional Learnings

- No applicable learnings found in `docs/solutions/`

### External References

- No external research needed — webpack externals and Playwright headless modal patterns are well-established

---

## Key Technical Decisions

- **Externalize `styled-components` via webpack externals string form**: Use `externals: { 'styled-components': 'styled-components' }` to reference Splunk's global instance. This is the smallest change, fixes the root cause directly, and reduces bundle size. (see origin: Key Decisions)
- **Playwright modal fix scoped to headless only**: The modal interaction failure is specific to headless Chromium — Splunk custom Modal traps focus/events differently. Fix targets the test selectors and timing, not the Modal component. (see origin: Key Decisions)
- **`controlGroupDefault` error treated as side-effect**: Origin S5 discovery suggests this resolves with the CSS fix. If not, investigate separately as low priority. (see origin: Key Decisions)
- **Dashboard XML no change needed**: `credential_management.xml` already loads `react/bundle.js` via `script="react/bundle.js"` attribute. R5 already satisfied.

---

## Open Questions

### Resolved During Planning

- **Does Splunk's runtime context expose `styled-components` as a global?**: Yes — `@splunk/react-ui` v5.9.1 depends on styled-components and Splunk provides it globally. The duplicate instance problem confirms Splunk loads it; the fix is to prevent webpack from bundling a second copy.
- **What is the exact mechanism causing Playwright headless modal interaction failure?**: Headless Chromium has different timing for focus trapping and event delegation in Splunk's Modal component. The fix requires explicit wait strategies and hardened selectors in the test code, not component changes.

### Deferred to Implementation

- **Exact selector adjustments for modal interactions**: Depends on observing the actual failure mode during test runs — whether it's focus trapping, event delegation, or timing. The test scenarios below cover the expected fixes.
- **Whether `controlGroupDefault` error resolves with CSS fix**: Verify after U1; if it persists, investigate as a separate low-priority issue.

---

## Implementation Units

### U1. Externalize styled-components in webpack

**Goal:** Eliminate the duplicate `styled-components` instance so `@splunk/react-ui` components render with proper Splunk styling.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `webpack.config.js`
- Test: `tests/smoke-test.spec.js` (visual verification)

**Approach:**
- Add `styled-components` to webpack `externals` using string form to reference Splunk's global instance
- This prevents webpack from bundling a second copy, allowing `SplunkThemeProvider` and all `@splunk/react-ui` components to share the same styled-components context
- After change, rebuild and verify all components display with correct Splunk styling

**Patterns to follow:**
- Existing webpack externals pattern (currently `externals: {}`)
- Standard webpack externals string form for global module references

**Test scenarios:**
- Happy path: After rebuild, `@splunk/react-ui` Button component displays with Splunk styling (correct colors, borders, hover states)
- Happy path: Table component renders with proper borders, header styling, and row formatting
- Happy path: Modal overlays display correctly with proper backdrop and positioning
- Happy path: Form fields (Text, Select, Multiselect, Switch, ControlGroup) render with Splunk design system styling
- Happy path: Chip components in CredentialTable display with correct background colors and text colors
- Edge case: Paginator component renders with proper styling when multiple pages exist
- Integration: Full CRUD flow (create, edit, delete) completes with all modals and forms styled correctly

**Verification:**
- Run `npm run build` — bundle produces without errors
- Load dashboard in Splunk — all `@splunk/react-ui` components display with correct Splunk styling, no unstyled elements
- Compare visual output against Splunk React UI documentation examples

---

### U2. Fix Playwright headless modal interactions

**Goal:** Resolve Playwright headless test failures caused by modal interaction timing issues in headless Chromium.

**Requirements:** R3

**Dependencies:** U1 (CSS fix may affect modal rendering timing)

**Files:**
- Modify: `tests/smoke-test.spec.js`

**Approach:**
- The modal interaction failures are specific to headless Chromium — Splunk's custom Modal component traps focus and delegates events differently in headless mode
- Harden modal selectors and add explicit wait strategies for modal appearance and interaction readiness
- Target the specific test scenarios that fail: credential create form submission (TEST 3), edit flow (TEST 4), and delete confirmation (TEST 5)
- Keep fixes scoped to the test file — no changes to the Modal component itself

**Patterns to follow:**
- Existing test helpers (`loginToSplunk`, `navigateToDashboard`) in `tests/smoke-test.spec.js`
- Playwright best practices for modal interactions: explicit waits, visibility checks, and actionability assertions

**Test scenarios:**
- Happy path: Create credential test — form modal opens, fields fill, submit button clicks, API call completes, result modal displays without interaction failure
- Happy path: Edit credential test — edit button clicks, edit form opens, save completes without modal interaction errors
- Happy path: Delete credential test — delete button clicks, confirmation modal opens, confirm button clicks, credential removed from table
- Edge case: Modal closes correctly when cancel/back buttons are clicked
- Edge case: Multiple rapid modal interactions (create → edit → delete sequence) complete without race conditions
- Integration: Full CRUD test suite runs headless with 0 failures

**Verification:**
- Run `npm test` — all Playwright tests pass with 0 failures in headless mode
- Verify test output shows successful modal interactions for create, edit, delete, and CSV import flows

---

### U3. Verify bundle size and REST integration

**Goal:** Confirm bundle stays under 2 MB cap after webpack changes and REST integration tests still pass.

**Requirements:** R4, R6

**Dependencies:** U1 (webpack changes affect bundle size)

**Files:**
- Test: `tests/test-rest-integration.js`
- Verify: `appserver/static/react/bundle.js` (bundle size)

**Approach:**
- Externalizing styled-components should reduce bundle size — verify it stays under 2 MB
- Run existing bundle size check script to confirm
- Run REST integration test suite to verify all 12 checks still pass (no code changes expected to affect REST behavior)

**Test scenarios:**
- Happy path: `npm run check:bundle-size` reports bundle under 2 MB
- Happy path: `node tests/test-rest-integration.js` passes all 12 checks against Docker Splunk 10.2.2
- Edge case: Bundle size decreased or stable after externalizing styled-components (no unexpected growth)

**Verification:**
- `npm run check:bundle-size` outputs "PASS: bundle.js X bytes (under 2MB)"
- `node tests/test-rest-integration.js` outputs "ALL CHECKS PASSED"

---

## System-Wide Impact

- **Interaction graph:** The webpack externals change affects the bundle build only — no runtime behavior changes. The Playwright test changes affect the test suite only — no production code modified.
- **Error propagation:** No changes to error handling paths. The styled-components externalization eliminates the duplicate context error at the source.
- **State lifecycle risks:** None — no data model or state management changes.
- **API surface parity:** No API changes. The React app continues to use the same REST endpoints via `api.js`.
- **Integration coverage:** The Playwright tests cover the full CRUD flow end-to-end. The REST integration test covers the API layer independently.
- **Unchanged invariants:** Legacy JS files remain untouched. The dashboard XML already loads the React bundle. The `api.js` module requires no changes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Splunk's global `styled-components` version incompatible with `@splunk/react-ui` v5.9.1's expectation | Splunk ships styled-components as part of its React UI ecosystem; version mismatch would manifest immediately in U1 verification. Fallback: load from Splunk CDN (Approach C from origin). |
| Playwright modal fixes mask underlying component timing issues | Origin decision scopes fix to headless only. If modals fail in headed mode, investigate separately. |
| `controlGroupDefault` error persists after CSS fix | Low priority — investigate separately if it doesn't resolve with U1. |

---

## Documentation / Operational Notes

- After U1 verification, the app is visually ready for production use in Splunk
- Legacy JS files (`appserver/static/password-crud.js`) remain in repo per scope boundaries — only the dashboard entry point uses React
- No README or user documentation changes needed — the app's behavior is unchanged, only the underlying implementation is now React-based with correct styling

---

## Sources & References

- **Origin document:** [docs/brainstorms/finish-react-migration-requirements.md](docs/brainstorms/finish-react-migration-requirements.md)
- Related code: `webpack.config.js`, `tests/smoke-test.spec.js`, `appserver/static/react/bundle.jsx`
- Related tests: `tests/test-rest-integration.js`
