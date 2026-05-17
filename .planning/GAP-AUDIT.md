# Legacy-to-React Gap Audit

**Date:** 2026-04-28
**Scope:** `appserver/static/react/` React app vs `password-crud.js` (1171 lines) legacy implementation
**Auditor:** opencode agent session
**Status:** IDENTIFIED — not yet addressed

## How an orchestrator should read this document

Each gap below has:
- **ID:** Unique reference for tracking (e.g., GAP-C01)
- **Severity:** 🔴 CRITICAL, 🟠 VALIDATION, 🟡 FEATURE, 🔵 ERROR-HANDLE, ⚪ UX
- **Dependencies:** Which other gaps must resolve first (`Depends on: GAP-XXX`)
- **Wave:** Suggested execution wave for parallelization
  - Wave 1: Blocking bugs (ACL, name format) — must land before anything else
  - Wave 2: Form validation + field-level fixes — independent within the wave
  - Wave 3: Full-feature gaps (CSV, bulk, password reveal) — can parallelize
- **Suggested Phase:** Where this fix slots into the existing ROADMAP.md phases

---

## Summary by Severity

| Severity | Count | IDs |
|----------|-------|-----|
| 🔴 CRITICAL | 9 | C01–C09 |
| 🟠 VALIDATION | 4 | V01–V04 |
| 🟡 FEATURE | 4 | F01–F04 |
| 🔵 ERROR-HANDLE | 3 | E01–E03 |
| ⚪ UX | 4 | U01–U04 |
| **Total** | **27** | |

---

## Wave 1: Blocking Bugs (ACL, API Contract)

These must land first. The ACL path is wrong and the credential name format may double-namespace items. Until these are fixed, CRUD operations will silently fail or create misconfigured credentials.

### GAP-C01 🔴 CRITICAL — ACL path missing `credential:` prefix
**Wave:** 1 | **Suggested Phase:** 1.3 API Integration (insert as prerequisite) | **Depends on:** none

In `api.js`, the ACL PUT path is constructed at line 205:
```js
// React (WRONG):
/servicesNS/nobody/${app}/configs/conf-passwords/${encodedRealm}%3A${encodedName}/acl

// Legacy (CORRECT) in password-crud.js buildAclPath() line 459:
/servicesNS/.../configs/conf-passwords/credential%3A${stanza}/acl
```
The React path is missing the `credential:` prefix, so Splunk returns 404 on every ACL update. This affects both create and update flows. The create flow also uses `editLink/acl` at line 166 which may work (uses the link Splunk returned), but the update flow at line 205 will always fail.

**Fix scope:** `appserver/static/react/api.js` — `updateCredential()` ACL path construction.

---

### GAP-C06 🔴 CRITICAL — Credential name double-namespacing risk
**Wave:** 1 | **Suggested Phase:** 1.3 (insert as prerequisite) | **Depends on:** none

In `api.js` line 154, the create body sends:
```js
name: realm ? `${realm}:${username}` : username,
password: password,
realm: realm || '',
```
Legacy sends `name: username` and `realm: realm` as separate fields (password-crud.js lines 73-74). Splunk's storage/passwords handler may produce a credential with stanza key `realm:realm:username` when both the name includes the realm prefix AND a separate realm field is provided.

**Fix scope:** `api.js` — `createCredential()` should use `name: username` (no realm prefix), consistent with legacy behavior.

---

### GAP-C08 🔴 CRITICAL — No `credential:` stanza encoding in ACL path
**Wave:** 1 | **Suggested Phase:** 1.3 (insert as prerequisite) | **Depends on:** GAP-C01

Related to C01. Beyond just missing the prefix, legacy encodes the full stanza as `credential:${row.stanza}` where stanza itself includes realm and username with colons. The React code doesn't account for Splunk's colon-terminated stanza format (`realm:username:`). This compounds the 404 problem.

**Fix scope:** `api.js` — extract a `buildAclPath(row)` function matching legacy pattern in password-crud.js lines 456-459.

---

### GAP-C05 🔴 CRITICAL — No two-step ACL pattern for user sharing
**Wave:** 1 | **Suggested Phase:** 1.3 (insert as prerequisite) | **Depends on:** GAP-C04

When creating with `sharing: 'user'`, Splunk requires a two-step write: first set sharing to `app`, then re-set to `user` (password-crud.js lines 478-481). React currently hard-codes sharing to `'app'` and doesn't have this pattern. This is blocked on C04 exposing the sharing field; without that field this gap is latent but will surface when C04 is fixed.

Note: If sharing is never exposed (i.e., product decision is "always app-scoped"), this gap can be closed as WONTFIX once C04 is resolved by removing the sharing option entirely.

---

### GAP-C07 🔴 CRITICAL — App move operation not implemented on update
**Wave:** 1 | **Suggested Phase:** 1.3 API Integration | **Depends on:** none

When updating a credential from one app to another, legacy sends a POST to the `/move` endpoint (password-crud.js lines 533-539). React `updateCredential()` in api.js line 197 includes `app: newApp` in the POST body to the credentials endpoint, but Splunk ignores `app` on credential update — it doesn't move. The `/move` endpoint is separate and required.

**Fix scope:** `api.js` — add `moveCredential(stanza, oldApp, newApp)` using `/configs/conf-passwords/credential:${stanza}/move`.

---

### GAP-C09 🔴 CRITICAL — Password reveal has no API call
**Wave:** 1 | **Suggested Phase:** 1.3 or 1.4 (your call) | **Depends on:** none

`PasswordRevealModal` in Modal.jsx line 20-31 sets `password: '********'` with a comment "Note: This requires a separate API endpoint or method". The legacy code calls `fetchClearPassword(restUri)` which does a direct GET to the credential's REST URI and reads `entry[0].content.clear_password`. The React app has no equivalent function in api.js.

**Fix scope:** Add `getCredentialPassword(name, realm)` to `api.js` that fetches `clear_password` from the credential endpoint, wire into Modal.jsx.

---

## Wave 2: Form Validation and Field Gaps

Independent within this wave. These can be worked in parallel or serially — no ordering required between items.

### GAP-C04 🔴 CRITICAL — Sharing hard-coded to 'app'
**Wave:** 2 | **Suggested Phase:** 1.3 API Integration | **Depends on:** none (blocks C05)

Both `createCredential` and `updateCredential` always send `sharing: 'app'`. Legacy offers a full sharing dropdown with `global`, `app`, `user` options. Users cannot create global-scoped or user-scoped credentials in React.

**Fix scope:**
1. Add `sharing` field to CredentialForm.jsx (select dropdown with 3 values)
2. Thread `sharing` through form submit → bundle.jsx handler → api.js functions
3. In api.js, use passed sharing value instead of hard-coded `'app'`

---

### GAP-V01 🟠 VALIDATION — No password confirmation on create
**Wave:** 2 | **Suggested Phase:** 1.2 (regression) or 1.4 Validation | **Depends on:** none

Legacy `handleCreateCredential` line 490 validates `password !== confirmPassword`. React CredentialForm has no Confirm Password field during create. User can misspell a password with no safety net — and once created, you can't see the password to verify.

**Fix scope:** Add "Confirm Password" input to CredentialForm.jsx create mode, validate in `handleSubmit`, show inline error if mismatch.

---

### GAP-V02 🟠 VALIDATION — No password confirmation on update (when changing password)
**Wave:** 2 | **Suggested Phase:** 1.2 (regression) or 1.4 Validation | **Depends on:** none

Legacy line 514 checks `if (password && password !== confirmPassword)`. React form has only one password field in edit mode. Same risk as V01.

**Fix scope:** Add "Confirm Password" conditional input that appears when user toggles "Change password", validate before submit.

---

### GAP-V03 🟠 VALIDATION — Empty readRoles defaults to empty string, strips access
**Wave:** 2 | **Suggested Phase:** 1.4 Validation | **Depends on:** none

Legacy defaults read roles to `['admin', 'power']` (password-crud.js line 614). React initializes `readRoles` to `''` (CredentialForm.jsx line 23), and api.js line 171 sends `perms_read: ''` when empty. This silently strips all read access from the credential.

**Fix scope:** Set default value of `aclRead`/`aclWrite` textareas to `'admin, power'` or validate non-empty before submit and show error.

---

### GAP-V04 🟠 VALIDATION — Empty writeRoles defaults to owner only
**Wave:** 2 | **Suggested Phase:** 1.4 Validation | **Depends on:** none

Related to V03. React api.js line 172 falls back to `owner` when writeRoles is empty: `perms_write: ... : (owner || 'nobody')`. Legacy defaults to `'admin,power'`. A credential created with empty write roles may only be writable by a single user, not the admin role.

**Fix scope:** Same as V03 — default values or pre-submit validation.

---

### GAP-V18 🟠 VALIDATION — App field is unvalidated free text
**Wave:** 2 | **Suggested Phase:** 1.4 Validation | **Depends on:** none

Legacy fetches `/apps/local` and presents a validated dropdown (password-crud.js line 153-156). React accepts any text for the App field. A typo creates a credential in wrong context or fails with cryptic Splunk error.

**Fix scope:** Add `getApps()` to api.js, render as `<select>` populated from fetched apps list, or at minimum validate against known apps on submit.

---

### GAP-V19 🟠 VALIDATION — Owner field is unvalidated free text
**Wave:** 2 | **Suggested Phase:** 1.4 Validation | **Depends on:** none

Same issue as V18 but for owner. Legacy fetches `/authentication/users` dropdown (line 170-173). React accepts any string. Invalid owner may be accepted silently by Splunk API.

**Fix scope:** Add `getUsers()` to api.js, render as `<select>`.

---

### GAP-V20 🟠 VALIDATION — Roles text area has no existence validation
**Wave:** 2 | **Suggested Phase:** 1.4 Validation | **Depends on:** V18 (same pattern)

Legacy provides a multi-select picker from `/authorization/roles`. React textarea accepts arbitrary role names. User can type `adminn` and it sends through. Splunk may accept it silently, creating ACL entries for roles that don't exist.

**Fix scope:** Fetch roles via api.js `getRoles()`, render as multi-select or autocomplete, validate on submit. Lower priority than V18/V19 since invalid role names are less likely to cause data loss.

---

## Wave 3: Feature Gaps and Error Handling

Independent items suitable for parallel agent assignment.

### GAP-F02 🟡 FEATURE — No bulk delete
**Wave:** 3 | **Suggested Phase:** 1.4 Advanced Features | **Depends on:** none

Legacy has row checkboxes, select-all checkbox, "Delete Selected" button, and batch delete with per-credential success/failure results (password-crud.js lines 418-421, 556-595). React only supports single-credential delete.

**Fix scope:**
1. Add checkbox column to CredentialTable
2. Select-all + select-indeterminate state in table header
3. "Delete Selected" toolbar button
4. Bulk delete handler in bundle.jsx with `Promise.allSettled` result modal

---

### GAP-F03 🟡 FEATURE — No CSV import processing
**Wave:** 3 | **Suggested Phase:** 1.4 Advanced Features | **Depends on:** none

Modal UI exists (`ImportCSVModal`) but `onImport` handler in bundle.jsx line 148 is stubbed: `alert('CSV import not yet implemented')`. Legacy has full pipeline: RFC 4180 parser (lines 848-903), 512KB file size guard, preview modal with errors highlighted, batch create with success/fail per row.

**Fix scope:**
1. Port `parseCSV()` from legacy to api.js or new utility module
2. Wire CSV content through Modal.jsx → bundle.jsx `handleImport`
3. Batch-apply via `createCredential()` in `Promise.allSettled`
4. Show results modal with per-row status

---

### GAP-F04 🟡 FEATURE — No CSV template download
**Wave:** 3 | **Suggested Phase:** 1.4 Advanced Features | **Depends on:** GAP-F03 (or independent)

Legacy `downloadCSVTemplate()` (lines 1074-1100) generates a pre-formatted CSV with headers, comments, and example row. React has no equivalent button or handler.

**Fix scope:** Add "Download Template" button to ImportCSVModal (or toolbar), generate blob and trigger download client-side.

---

### GAP-E01 🔵 ERROR-HANDLE — No 409 conflict detection on create
**Wave:** 3 | **Suggested Phase:** 1.4 Validation or 1.3 API Integration | **Depends on:** none

Legacy checks `if (err.status === 409)` and renders friendly message: "A credential already exists... click the row to expand the update form" (lines 501-502). React shows generic alert with raw error text, which includes XML that's unreadable.

**Fix scope:** Catch status 409 in bundle.jsx `handleCreateCredential`, show modal with human-readable duplicate message + "Edit existing" action.

---

### GAP-E02 🔵 ERROR-HANDLE — No multi-step result reporting
**Wave:** 3 | **Suggested Phase:** 1.4 Validation | **Depends on:** none

Legacy builds per-operation messages (`messages.push(...)`) so user sees "Password updated", "ACLs applied", etc. React shows `alert('Credential created successfully!')` — no detail about what actually happened. If one step succeeds and another fails, user only sees the failure with no context.

**Fix scope:** Replace `alert()` calls in bundle.jsx with structured result display (modal or inline toast) showing per-step status.

---

### GAP-E03 🔵 ERROR-HANDLE — Splunk XML error responses not parsed
**Wave:** 3 | **Suggested Phase:** 1.3 API Integration | **Depends on:** none

Legacy extracts `<msg>` text from XML errors (line 108: `text.match(/<msg[^>]*>([^<]+)<\/msg>/)`). React dumps raw `errorText` which is unparsed XML like `<response><messages><msg type="ERROR">...</msg></messages></response>`.

**Fix scope:** Add XML error parsing in `apiRequest()` and `splunkdRequest()` — extract `<msg>` text from response body on non-2xx.

---

### GAP-U01 ⚪ UX — No inline row expansion for editing
**Wave:** 3 (or defer) | **Suggested Phase:** post-1.5 polish | **Depends on:** none

Legacy expands an edit form inline beneath the table row with a chevron animation. React opens all forms in modals. The modal approach works but is less efficient for power users who want to see the credential list while editing.

**Likely WONTFIX** for v3.0 — the modal pattern is clean and consistent. Defer if desired.

---

### GAP-U02 ⚪ UX — No loading indicator during form operations
**Wave:** 3 (or defer) | **Suggested Phase:** post-1.5 polish | **Depends on:** none

Legacy shows a spinner "Loading form" when building forms. React has no per-operation loading state — buttons are clickable and user gets `alert()` for feedback.

**Likely WONTFIX** for v3.0 — can add disabled state + spinner to submit button as polish.

---

### GAP-U03 ⚪ UX — No "App Scope" warning hint
**Wave:** 3 (or defer) | **Suggested Phase:** post-1.5 polish | **Depends on:** GAP-V18 (needs app context first)

Legacy shows a conditional warning when user selects their own app as the credential container, cautioning that credentials will be lost on app uninstall (lines 622-630). React form has no such hint.

**Likely LOW PRIORITY** — nice-to-have UX improvement.

---

### GAP-U04 ⚪ UX — Table row key may collide for same username, different realms
**Wave:** 2 | **Suggested Phase:** 1.3 (quick fix) | **Depends on:** none

React CredentialTable.jsx line 252 uses `key: cred.name || cred.id`. Two credentials with the same username in different realms will have identical keys, causing React to skip rendering or corrupt state. Legacy uses full stanza key as unique identity.

**Fix scope:** Change to `key: cred.stanzaKey` (already available from api.js `flattenCredential` line 110).

---

## Dependency Graph

```
Wave 1:
  GAP-C01 ───────┐
                 ├── GAP-C08 ──────────────┐
  GAP-C06              │                    │
                       └── GAP-C05 (if sharing exposed)
  GAP-C07 (independent)
  GAP-C09 (independent)

Wave 2:
  GAP-C04 (blocks C05 if not deferred)
  GAP-V01, V02 (form validation — independent)
  GAP-V03, V04 (defaults — independent)
  GAP-V18, V19, V20 (dropdown lookups — independent pair)
  GAP-U04 (key fix — trivial, independent)

Wave 3:
  GAP-F02 (bulk delete — independent)
  GAP-F03, F04 (CSV import pipeline — pair)
  GAP-E01, E02, E03 (error handling — independent)
  GAP-U01, U02, U03 (polish — defer likely)
```

## Suggested Execution Plan for Orchestrator Agent

### Option A: Insert gap-fixing phase before Phase 1.3/1.4
Create a new **Phase 1.2.5: Gap Fixes** that addresses Wave 1 + Wave 2 items, letting 1.3 and 1.4 proceed on solid footing. This prevents fixing API bugs three times as later phases rework the same code.

### Option B: Route fixes into existing phases as they execute
- **Wave 1 → Phase 1.3:** ACL path fixes, name format fix, app move, password API are all "API Integration" work that belongs in 1.3 anyway
- **Wave 2 → Phase 1.4:** Validation, field dropdowns belong in "Advanced Features" validation plan
- **Wave 3 → Phase 1.4:** CSV import, bulk delete, error handling are already planned in 1.4

### Option C: Hybrid (recommended)
- Execute Wave 1 fixes as a quick pre-flight before Phase 1.3 (`gsd-insert-phase` 1.2.5)
- Let Wave 2 and Wave 3 items roll into Phases 1.3/1.4 naturally as they execute

## Files Involved per Gap

| File | Gaps touching it | Count |
|------|------------------|-------|
| `api.js` | C01, C05, C06, C07, C08, C09, E03, V18, V19, V20 | 10 |
| `CredentialForm.jsx` | C04, V01, V02, V03, V04, U03 | 6 |
| `bundle.jsx` | C04, E01, E02, F02, F03 | 5 |
| `CredentialTable.jsx` | U04, F02 (bulk checkboxes) | 2 |
| `Modal.jsx` | C09, F02, F03, F04 | 4 |
| **Total unique files** | | **5 of 5 source files** |

---

*Generated: 2026-04-28 by opencode agent — Legacy-to-React gap audit session*
*Legacy reference: `appserver/static/password-crud.js` (1171 lines)*
*React target: `appserver/static/react/` (api.js + bundle.jsx + 3 components)*
