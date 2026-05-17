# Code Review: feature/react-dashboard vs origin/develop

**Date:** 2026-05-11
**Branch:** feature/react-dashboard (63 commits, 3873 lines)
**Merge base:** 4c644f8
**Review team:** correctness, security, adversarial, testing, maintainability

---

## P1 — Critical (4 findings)

### P1 #1: No fetch timeout on REST API calls
- **File:** `appserver/static/react/api.js:108`
- **Issue:** `apiRequest()` uses `fetch()` with no `AbortController` or timeout. Slow/unresponsive Splunk instances cause indefinite hangs, blocking the entire UI.
- **Fix:** Add `AbortController` with configurable timeout (default 30s). Pass `signal` to `fetch()`.

### P1 #2: Zero React component tests
- **File:** `tests/`
- **Issue:** Unit tests exist only for `api.js` utilities. React components (`CredentialForm`, `CredentialTable`, `Modal`, `bundle`) have zero test coverage. No rendering tests, no interaction tests, no snapshot tests.
- **Fix:** Add React Testing Library tests for each component. Minimum: render, user interaction, error state.

### P1 #3: Password not cleared on modal unmount
- **File:** `appserver/static/react/components/Modal.jsx:32`
- **Issue:** `PasswordRevealModal` stores plaintext password in state but doesn't clear on unmount. Password persists in React state tree after modal closes, visible via dev tools or memory inspection.
- **Fix:** Add `useEffect` cleanup that zeroes password state on unmount.

### P1 #4: CSV fields not sanitized before API submission
- **File:** `appserver/static/react/components/Modal.jsx:152`
- **Issue:** CSV import reads fields directly and submits to API without sanitization. Malformed CSV with injected content (script tags, null bytes, oversized fields) passes through to Splunk.
- **Fix:** Sanitize all CSV fields: strip null bytes, trim whitespace, validate field lengths, escape special characters.

---

## P2 — Moderate (5 findings)

### P2 #5: Excessive useState calls in bundle.jsx
- **File:** `appserver/static/react/bundle.jsx`
- **Issue:** 17 `useState` calls in single component. State is scattered, making it hard to track dependencies and causing unnecessary re-renders.
- **Fix:** Consolidate related state into objects or use `useReducer`. Extract sub-components to reduce state surface.

### P2 #6: CSV import row limit not enforced
- **File:** `appserver/static/react/components/Modal.jsx`
- **Issue:** CSV import has no row limit. Large CSVs (10k+ rows) flood the API with parallel requests, exhausting server resources.
- **Fix:** Add configurable row limit (default 500). Warn user when exceeded.

### P2 #7: Modal state not reset after submission
- **File:** `appserver/static/react/components/Modal.jsx`
- **Issue:** After CSV import or credential creation, modal state (form fields, validation errors) persists. Re-opening modal shows stale data.
- **Fix:** Reset form state on successful submission and on modal close.

### P2 #9: handleSelectAll selects ALL credentials, not filtered view
- **File:** `appserver/static/react/bundle.jsx:361`
- **Issue:** "Select All" checkbox selects ALL credentials in the store, not just the filtered/visible ones. User can accidentally bulk-delete credentials they can't see (filtered out).
- **Fix:** Scope selection to filtered credential list only.

### P2 #10: parseError not handled for non-JSON responses
- **File:** `appserver/static/react/api.js`
- **Issue:** `apiRequest()` assumes JSON response. Splunk error pages (HTML) or empty responses cause `JSON.parse()` to throw, crashing the component.
- **Fix:** Wrap `response.json()` in try/catch. Return `{ error: 'Invalid response' }` for non-JSON.

---

## P3 — Low (1 finding)

### P3 #11: useEffect missing dependency
- **File:** `appserver/static/react/components/Modal.jsx`
- **Issue:** `useEffect` callback references a variable not in dependency array. Causes stale closure — effect runs with outdated data.
- **Fix:** Add missing dependency to array or use ref for stable reference.

---

## gated_auto findings (6) — ready for downstream resolver
P1 #1, P1 #3, P1 #4, P2 #7, P2 #9, P3 #11

## advisory findings (5) — need human review
P1 #2, P2 #5, P2 #6, P2 #10, plus architectural concerns about component structure
