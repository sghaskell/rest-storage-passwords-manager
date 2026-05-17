---
date: 2026-05-11
topic: finish-react-migration
---

# Finish React Migration — Ship-Ready

## Summary

Fix the CSS/theming blocker, resolve remaining test failures, and swap the app to load the React bundle as default — completing the migration from standalone JS to Splunk native React with full feature parity.

---

## Problem Frame

The React migration is structurally complete — all components render, all CRUD operations work, and the bundle is under the 2 MB cap. However, `@splunk/react-ui` components render with no CSS styling, making the UI unusable in production. This is traced to a duplicate `styled-components` instance: our webpack bundle includes one copy, while Splunk's global context loads another. The `SplunkThemeProvider` reads from one instance's theme context, but the components inject styles into the other — styles never reach the DOM. Additionally, Playwright headless tests fail due to modal interaction issues (S4 carryover), and the `.spl` dashboard still loads the legacy JS bundle. The app cannot ship until CSS is correct, tests pass, and the dashboard points to the React bundle.

---

## Requirements

**CSS and theming**
- R1. `@splunk/react-ui` components (Table, Button, Select, Modal, Form fields) render with proper Splunk styling — visual parity with documented Splunk React UI examples
- R2. `styled-components` must not be bundled — externalize in webpack to share Splunk's global instance and eliminate duplicate context

**Test coverage**
- R3. Playwright headless CRUD tests pass — create, edit, delete, and CSV import operations complete successfully in headless Chromium
- R4. REST integration test (`test-rest-integration.js`) continues to pass all 12 checks against Docker Splunk 10.2.2

**Deployment**
- R5. Dashboard `.spl` loads the React bundle (`react/bundle.js`) as default, replacing the legacy JS version
- R6. `npm run build` produces a clean bundle under 2 MB; no unverified dependencies added

**Parity**
- R7. React app behavior matches the legacy JS version exactly — all CRUD operations, ACL controls, CSV import, bulk delete, password reveal, and filtering work identically

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given the dashboard loads in Splunk, when the user views the credentials table, all `@splunk/react-ui` components display with correct Splunk styling (buttons styled, table borders visible, modal overlays functional).
- AE2. **Covers R3.** Given the Playwright test suite runs headless, when the create credential test submits the form, the API call completes and the result modal displays without interaction failure.
- AE3. **Covers R5.** Given the user opens the Credential Management dashboard, when the page loads, the React app renders — not the legacy JS version.

---

## Success Criteria

- All `@splunk/react-ui` components visually match Splunk design system — no unstyled elements
- Playwright test suite passes with 0 failures
- REST integration test passes all 12 checks
- Dashboard loads React bundle by default; legacy JS no longer invoked
- Bundle size under 2 MB cap

---

## Scope Boundaries

- Dark theme CSS overrides beyond native component defaults
- Unit/integration test suite for api.js or components
- Error message sanitization (`dangerouslySetInnerHTML` removal in ResultModal)
- Bundle optimization (lazy-loading, code splitting)
- New feature development (app scope reinstall warning, CSV enhancements)
- Legacy JS file deletion — files remain in repo, only stop loading

---

## Key Decisions

- **Externalize `styled-components` (Approach A)**: Mark as webpack external rather than loading from Splunk CDN or bypassing styled-components entirely. Smallest change, fixes root cause directly, reduces bundle size.
- **Playwright modal fix scoped to headless only**: The modal interaction failure is specific to headless Chromium — Splunk custom Modal traps focus/events differently. Fix targets the test environment, not the component.
- **`controlGroupDefault` error treated as side-effect**: S5 discovery suggests this resolves with the CSS fix. If not, investigate separately as low priority.

---

## Dependencies / Assumptions

- Splunk provides `styled-components` globally at runtime — if not, Approach A fails and we fall back to Approach C (load from Splunk CDN)
- `@splunk/themes` package is available in Splunk's context for `SplunkThemeProvider`
- Docker Splunk 10.2.2 remains available for integration testing

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Needs research] What is the exact mechanism causing Playwright headless modal interaction failure — focus trapping, event delegation, or timing? Requires isolated investigation.
- [Affects R2][Technical] Does Splunk's runtime context expose `styled-components` as a global that webpack can reference via externals? Needs verification before implementation.
