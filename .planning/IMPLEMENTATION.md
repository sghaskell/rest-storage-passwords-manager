# Phase 1.3 Implementation Spec — Subagent Dispatch Guide

**Created:** 2026-04-28
**Status:** READY FOR DISPATCH — all tasks documented, no code written yet
**Source of Truth:** `appserver/static/password-crud.js` (1171 lines) - every behavior must be ported from here

---

## How to Use This Document

Each TASK_BLOCK has:
- **ID:** Unique reference (T01, T02, etc.)
- **Parallel Group:** Which tasks can run concurrently (A = parallel with each other, B = sequential after A)
- **Agent Role:** What kind of agent should handle it
- **Files to Modify:** Exact file paths and approximate line ranges
- **Legacy Reference:** Source lines in `password-crud.js` proving the behavior
- **Current State:** What the React code does NOW (wrong/missing)
- **Target Behavior:** What it MUST do (copied from legacy, no invention)
- **Verification:** How another agent can confirm correctness

Tasks within the same Parallel Group can be dispatched to separate subagents simultaneously.

---

## Task Summary

| ID | Group | Description | Files | Priority |
|----|-------|-------------|-------|----------|
| T01 | A | Dropdown lookups - API layer (getApps, getRoles, getUsers) | api.js | High |
| T02 | A | Form validation rules + confirm password fields | CredentialForm.jsx, bundle.jsx | High |
| T03 | A | XML error extraction from Splunk responses | api.js | High |
| T04 | B | App/Owner dropdown selectors in form (depends on T01) | CredentialForm.jsx, bundle.jsx | Medium |
| T05 | B | Roles multi-select with * exclusivity (depends on T01) | CredentialForm.jsx | Medium |
| T06 | B | Sharing field exposed + two-step ACL for 'user' mode | api.js, CredentialForm.jsx, bundle.jsx | Medium |
| T07 | B | Password reveal with user-sharing bump pattern | Modal.jsx, api.js, bundle.jsx | Medium |
| T08 | C | Delete flow - ACL bump before DELETE | api.js, bundle.jsx | High |
| T09 | C | Update flow - four-step sequence | api.js, bundle.jsx | High |

**Execution Order:** Group A (parallel) → Group B (can parallelize after A completes) → Group C (parallel with each other, can overlap B)

---

## TASK T01: Dropdown Lookup API Functions (ParallelGroup A)

### Agent Type
general - straightforward function addition to existing api.js

### Files
- `appserver/static/react/api.js` — Add 3 new functions, export them

### Current State
api.js has no lookup functions. Form fields (App, Owner, Roles) accept free-text input.

### Legacy Reference
```javascript
// password-crud.js lines 153-174:
async function fetchApps() { ... }     // → [{label, value}]
async function fetchRoles() { ... }    // → prepends * (all roles) option
async function fetchUsers() { ... }    // → [{label, value}]
```

### Target Behavior

**getApps():**
- Endpoint: `GET /servicesNS/-/-/apps/local?output_mode=json&count=0&search=disabled%3D0`
- Returns: Array of `{ label: content.label || name, value: name }`
- Note: `search=disabled%3D0` filters to only enabled apps

**getRoles():**
- Endpoint: `GET /servicesNS/-/-/authorization/roles?output_mode=json&count=0`
- Returns: Array starting with `{ label: '* (all roles)', value: '*' }`, then all named roles as `{ label: name, value: name }`

**getUsers():**
- Endpoint: `GET /servicesNS/-/-/authentication/users?output_mode=json&count=0`
- Returns: Array of `{ label: name, value: name }`

All three use the existing `splunkdRequest()` helper with GET method.

### Verification Checklist
- [ ] Three new functions exist in api.js with matching endpoint paths
- [ ] Each returns array of `{label, value}` objects from parsed JSON
- [ ] getRoles() prepends * (all) as first option
- [ ] Functions exported via module.exports
- [ ] No changes to existing functions

---

## TASK T02: Form Validation Rules + Confirm Password Fields (ParallelGroup A)

### Agent Type
general - modify CredentialForm.jsx and bundle.jsx validation

### Files
- `appserver/static/react/components/CredentialForm.jsx` — Add confirm password fields, inline validation state
- `appserver/static/react/bundle.jsx` — Replace alert() with validation error display (lines 65-104)

### Current State
- Create mode: No confirm password field, no pre-submit validation
- Edit mode: Single password field behind toggle, no confirmation
- ReadRoles and WriteRoles default to empty string `''` - silently strips access when submitted
- bundle.jsx uses `alert()` for all success/error feedback

### Legacy Reference
```javascript
// password-crud.js lines 486-492 (create validation):
if (!username) return showModal(... 'Username is required.');
if (!password) return showModal(... 'Password is required.');
if (password !== confirmPassword) return showModal(... 'Passwords do not match.');
if (!read)  return showModal(... 'Select at least one Read Users role...');
if (!write) return showModal(... 'Select at least one Write Users role...');

// password-crud.js lines 514-518 (update validation):
if (password && password !== confirmPassword) { ... } // only if password is filled
if (!read)  return showModal(...);
if (!write) return showModal(...);

// Default values (line 613-614):
formRead defaults: ['admin', 'power']
formWrite defaults: ['admin', 'power']
```

### Target Behavior

**CredentialForm.jsx changes:**

1. Add `confirmPassword` state + confirm password input field
   - Create mode: Always visible, required, must match `password`
   - Edit mode: Only visible when "Change password" checkbox is checked AND password field has content; must match `password`

2. Default readRoles and writeRoles to `'admin,power'` in create mode (not empty string)

3. Add inline validation state: object `{ errors: { [fieldName]: string } }` displayed as red text below each invalid field

4. `handleSubmit` should run pre-submit validation and return early with error display if any check fails:
   - Create: username required, password required, passwords match, readRoles non-empty, writeRoles non-empty
   - Update: (if changing) passwords match, readRoles non-empty, writeRoles non-empty

5. Realm field must be `disabled` in edit mode (password-crud.js line 697: `realmInput.disabled = true`)

**bundle.jsx changes:**
- Replace all `alert()` calls with inline modal state or structured error display
- handleCreateCredential and handleUpdateCredential should accept validation errors from form and NOT submit if form is invalid
- Success feedback replaced with structured result messages (same pattern as legacy's per-step messages)

### Verification Checklist
- [ ] Confirm password field exists in create mode, required
- [ ] Confirm password field appears conditionally in edit mode when "change password" active
- [ ] Password mismatch shows inline error before submit
- [ ] readRoles/writeRoles default to 'admin,power' on create
- [ ] Empty read/write roles blocked with validation error
- [ ] Realm input is disabled on credential edit
- [ ] No alert() calls remain in bundle.jsx (replaced with modal/inline)

---

## TASK T03: XML Error Extraction from Splunk Responses (ParallelGroup A)

### Agent Type
general - modify error handling in api.js request helpers

### Files
- `appserver/static/react/api.js` — Modify `apiRequest()` and `splunkdRequest()` (lines 50-56, 87-92)

### Current State
Both functions dump raw XML into error message:
```javascript
const errorText = await response.text();
throw new Error(`API Error ${response.status}: ${errorText}`);
```
This produces: `API Error 409: <response><messages><msg type="ERROR">...</msg>...</messages></response>`

### Legacy Reference
```javascript
// password-crud.js lines 107-111:
if (!res.ok) {
    const text = await res.text().catch(() => '');
    const xmlMsg = text.match(/<msg[^>]*>([^<]+)<\/msg>/)?.[1]?.trim();
    const err = new Error(xmlMsg || `${res.status} ${res.statusText}`);
    err.status = res.status;  // ← important for 409 detection downstream
    throw err;
}
```

### Target Behavior

Both `apiRequest()` and `splunkdRequest()` must:
1. Extract `<msg>` text using regex: `/extract_msg_tag/` — matches `<msg>` with optional attributes, captures inner text only
2. Fall back to `${status} ${statusText}` if no match
3. Attach `error.status = response.status` to the thrown Error object (critical for 409 conflict detection in bundle.jsx)

Additional: also append `X-Requested-With: XMLHttpRequest` header (legacy line 92), which some Splunk middleware checks.

### Verification Checklist
- [ ] Both apiRequest and splunkdRequest extract <msg> text from error responses
- [ ] Error object has `.status` property set to HTTP status code
- [ ] X-Requested-With: XMLHttpRequest header added to all requests
- [ ] Fallback to status + statusText when no XML message found

---

## TASK T04: App/Owner Dropdown Selectors in Form (ParallelGroup B, depends on T01)

### Agent Type
general - add dropdowns to CredentialForm.jsx with data from api.js

### Files
- `appserver/static/react/components/CredentialForm.jsx` — Replace free-text inputs with `<select>` for App and Owner
- `appserver/static/react/bundle.jsx` — Fetch dropdown data, pass as props to CredentialForm

### Current State
App field (line 165) and Owner field (line 184) are plain text `<input type="text">`. Any string accepted.

### Legacy Reference
```javascript
// password-crud.js lines 609-612:
form.appendChild(fieldGroup('App Scope', buildSelect('formApp', apps, defaults.app || getCurrentApp()),
    'Credentials are stored in this app\'s local directory...' hint));
form.appendChild(fieldGroup('Owner', buildSelect('formOwner', users, defaults.owner || currentUser())));

// Legacy line 622-630: Conditional warning when selected app === current app
const appSelect = form.querySelector('#formApp');
if (appSelect && hint) {
    hint.style.display = appSelect.value === getCurrentApp() ? '' : 'none';
}
```

### Target Behavior

**CredentialForm.jsx changes:**
1. Accept new props: `apps={[]}`, `users={[]}`, `currentApp`, `currentUser`
2. Replace App `<input>` with `<select>` populated from `apps` prop, defaulting to `currentApp`
3. Replace Owner `<input>` with `<select>` populated from `users` prop, defaulting to `currentUser`
4. Add conditional warning text below App dropdown when selected app === `currentApp`: "Credentials are stored in this app's local directory and will be lost if it is uninstalled. Choose a long-lived app (e.g. search) if they need to survive reinstalls." — styled with warning color

**bundle.jsx changes:**
1. Fetch apps/users on mount (in useEffect alongside loadCredentials), store as state
2. Implement `getCurrentApp()` equivalent: read from URL path or via Splunk util (legacy line 734-736)
3. Implement `currentUser()` equivalent: need to check how legacy's `Splunk.util.getConfigValue('USERNAME')` maps to React context — may need a new api.js function that calls `/en-US/splunkd/__raw/servicesNS/-/-/authentication/me?output_mode=json` or reads from page-global
4. Pass fetched arrays, currentApp, currentUser as props to CredentialForm

### Verification Checklist
- [ ] App field is `<select>` populated from getApps()
- [ ] Owner field is `<select>` populated from getUsers()
- [ ] Defaults match legacy: currentApp for app, currentUser for owner
- [ ] Warning hint shows/hides conditionally on app selection
- [ ] bundle.jsx fetches dropdown data on mount and passes as props

---

## TASK T05: Roles Multi-Select with * Exclusivity (ParallelGroup B, depends on T01)

### Agent Type
general — custom multi-select component, replaces textarea

### Files
- `appserver/static/react/components/CredentialForm.jsx` — Replace readRoles/writeRoles textareas with multi-select components

### Current State
Read roles and write roles are `<textarea>` fields accepting arbitrary comma-separated text (lines 204-238). No validation that roles exist.

### Legacy Reference
```javascript
// password-crud.js lines 786-843: custom buildMultiSelect()

// Key behaviors:
// - <select multiple> with size=5
// - * (all) is mutually exclusive with individual roles (line 818-827):
//   selecting * deselects others; selecting any other role deselects *
// - "Select All" button selects every NAMED role but NOT * (line 830-832)
// - "Reset" button restores default values (line 834-836)
// - Counter shows "${N} selected" (line 810-812)

// Defaults (lines 613-614): ['admin', 'power']
```

### Target Behavior

Create a `RoleMultiSelect` render function within CredentialForm.jsx (or separate component):

1. Props: `roles={[] /* from api.js */}`, `selectedValues={['admin', 'power']}`, `onChange`, `fieldName`
2. Renders as HTML `<select multiple size={5}>` populated from roles array
3. Selection logic: toggling * deselects all others; toggling any other role deselects *
4. "Select All" button: selects every named role, NOT *
5. "Reset" button: restores default `['admin', 'power']`
6. Counter display: `${N} selected`
7. Hint text: "Hold Ctrl/Cmd to select multiple"

Both Read Roles and Write Roles use this component with their respective state values.

### Verification Checklist
- [ ] Role fields render as `<select multiple size={5}>` populated from getRoles()
- [ ] Selecting * deselects all other options automatically
- [ ] Selecting any named role deselects * automatically
- [ ] "Select All" selects every NAMED role but leaves * unselected
- [ ] "Reset" restores ['admin', 'power'] defaults
- [ ] Counter shows correct selected count
- [ ] Values submitted as array of role names (not including * unless that's what was selected)

---

## TASK T06: Sharing Field + Two-Step ACL Pattern (ParallelGroup B, depends on T01+T02)

### Agent Type
general — exposes sharing option, implements two-step ACL write

### Files
- `appserver/static/react/api.js` — Modify createCredential and updateCredential to accept `sharing` parameter, implement two-step ACL for 'user' mode
- `appserver/static/react/components/CredentialForm.jsx` — Add sharing `<select>` dropdown (global/app/user)
- `appserver/static/react/bundle.jsx` — Thread sharing value through form submit → API calls

### Current State
- api.js line 185: hardcoded `sharing: 'app'` in createCredential ACL POST
- api.js line 226: hardcoded `sharing: 'app'` in updateCredential ACL POST
- No sharing field in CredentialForm.jsx
- Missing two-step pattern for user-scoped credentials

### Legacy Reference
```javascript
// password-crud.js lines 478-481 (create with user sharing):
if (sharing === 'user') {
    await splunkdPOST(aclPath, { ... sharing: 'app', owner }); // Step 1: bump to app
}
await splunkdPOST(aclPath, { ... sharing, owner });            // Step 2: set real sharing

// password-crud.js line 615-618 (sharing UI):
buildSelect('formSharing', [
    { label: 'global', value: 'global' },
    { label: 'app',    value: 'app'    },
    { label: 'user',   value: 'user'   }
], defaults.acl_sharing || 'app')

// password-crud.js lines 522-547 (update with sharing change):
// Step 1: always bump to app first
await splunkdPOST(buildAclPath(row), { ..., sharing: 'app', owner });
... // password update, possible app move
// Final: set ACL with requested sharing in new app context
await splunkdPOST(..., { ..., sharing, owner });
```

### Target Behavior

**api.js createCredential changes:**
1. Accept `sharing` parameter (default 'app')
2. If `sharing === 'user'`, perform two-step: POST ACL with `sharing: 'app'` first, then POST with actual `sharing`
3. Use the requested `sharing` for all other modes (global/app)

**api.js updateCredential changes:**
1. Accept `sharing` parameter
2. First ACL POST always uses `sharing: 'app'` (the safety bump)
3. Final ACL POST uses the actual requested `sharing`, potentially in new app context if app changed

**CredentialForm.jsx changes:**
1. Add `sharing` state, default to credential's existing sharing value on edit or 'app' on create
2. Add `<select>` with options: global, app, user

**bundle.jsx changes:**
1. Pass `sharing` from form data → API calls

### Verification Checklist
- [ ] Sharing field appears in form with three options (global/app/user)
- [ ] createCredential accepts and uses sharing parameter
- [ ] When sharing='user', create performs two-step ACL (app first, then user)
- [ ] updateCredential accepts and uses sharing parameter
- [ ] update always bumps to app first before setting final sharing

---

## TASK T07: Password Reveal with User-Sharing Bump Pattern (ParallelGroup B, depends on T06)

### Agent Type
general — fix Modal.jsx password fetch for user-scoped credentials

### Files
- `appserver/static/react/components/Modal.jsx` — PasswordRevealModal component (lines 13-132)
- `appserver/static/react/api.js` — Add `setSharing(stanza, aclInfo)` helper + modify getCredentialPassword to accept restUri

### Current State
- Modal.jsx line 21: calls `getCredentialPassword(credential.name, credential.realm)` — works for app/shared credentials only
- No handling for user-scoped credentials that need temporary sharing bump
- api.js `getCredentialPassword` (line 274) fetches via `/${realm}:${name}` path — doesn't handle user-sharing bump

### Legacy Reference
```javascript
// password-crud.js lines 424-450:
async function handleShowPassword(row) {
    if (row.acl_sharing === 'user') {
        await setSharing(row, 'app');   // bump to app
    }
    const pwd = await fetchClearPassword(row.rest_uri); // uses the stored rest_uri from list response
    if (row.acl_sharing === 'user') {
        await setSharing(row, 'user');  // revert back
    }
    // ... show password or error
}

// setSharing helper (lines 462-469):
async function setSharing(row, sharing) {
    await splunkdPOST(buildAclPath(row), {
        'perms.read':  row.acl_read,
        'perms.write': row.acl_write,
        sharing,
        owner: row.owner
    });
}

// fetchClearPassword (lines 146-150):
async function fetchClearPassword(restUri) {
    const res = await splunkdGET(`${restUri}?output_mode=json`);
    return json.entry?.[0]?.content?.clear_password;
}
```

### Target Behavior

**api.js changes:**
1. Add `setSharing(credential, sharing)` function:
   - POST to buildAclPath with credential's existing perms.read, perms.write, owner, and the target sharing value
2. Modify getCredentialPassword signature: accept full credential object (with stanzaKey, sharing, etc.), not just name/realm

**Modal.jsx PasswordRevealModal changes:**
1. When `credential.sharing === 'user'`, call setSharing(credential, 'app') BEFORE fetching password
2. Fetch the clear-text password
3. If original sharing was 'user', call setSharing(credential, 'user') AFTER fetch
4. Show realm:username format in modal title (legacy line 443)

### Verification Checklist
- [ ] PasswordRevealModal bumps sharing to 'app' before fetch for user-scoped creds
- [ ] PasswordRevealModal reverts sharing back to 'user' after fetch
- [ ] Modal title shows "Realm:Username" format
- [ ] Error state handled gracefully if bump fails

---

## TASK T08: Delete Flow - ACL Bump Before DELETE (ParallelGroup C)

### Agent Type
general — modify api.js deleteCredential + bundle.jsx bulk delete support

### Files
- `appserver/static/react/api.js` — Modify deleteCredential function (lines 241-253)
- `appserver/static/react/bundle.jsx` — Add bulk delete capability, replace alert feedback with result modal

### Current State
- api.js line 245: Direct DELETE without ACL bump — may fail for user-scoped credentials
- bundle.jsx line 94: Single delete only, uses alert() for feedback
- No bulk selection in table (checkboxes missing)

### Legacy Reference
```javascript
// password-crud.js lines 569-596:
async function executeDelete(rows) {
    const results = await Promise.allSettled(rows.map(async row => {
        // ACL bump before DELETE for predictable URI
        await splunkdPOST(buildAclPath(row), {
            perms.read: row.acl_read,
            perms.write: row.acl_write,
            sharing: row.acl_sharing === 'user' ? 'app' : row.acl_sharing,
            owner: row.owner
        });
        await splunkdDELETE(
            `/servicesNS/${owner}/${app}/storage/passwords/${stanza}`
        );
        return row;
    }));
    // Show per-result modal with success/failure for each row
}
```

### Target Behavior

**api.js deleteCredential changes:**
1. Accept full credential object (not just name/realm) — needs stanzaKey, owner, app, acl_read, acl_write, acl_sharing
2. If `sharing === 'user'`, POST ACL bump to 'app' first (using existing perms.read/perms.write)
3. DELETE call uses: `/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/storage/passwords/${encodeURIComponent(stanzaKey)}` via splunkdRequest

**bundle.jsx changes:**
1. `handleDeleteCredential` should accept credential object with full ACL info
2. Success result message pattern: "Deleted Realm:Username" (per-credential)
3. Future bulk delete support uses Promise.allSettled for all rows

### Verification Checklist
- [ ] deleteCredential accepts full credential object with ACL fields
- [ ] User-scoped credentials get ACL bump to 'app' before DELETE
- [ ] DELETE URL uses owner/app path format matching legacy
- [ ] Error result shows per-credential status (no more generic alert)

---

## TASK T09: Update Flow - Four-Step Sequence (ParallelGroup C, depends on T06+T08)

### Agent Type
general — rewrite updateCredential in api.js to match legacy four-step sequence

### Files
- `appserver/static/react/api.js` — Rewrite updateCredential (lines 203-236)
- `appserver/static/react/bundle.jsx` — Wire full credential data into update flow

### Current State
```javascript
// Current api.js line 203-236:
// Simplistic POST to /storage/passwords/realm:name + PUT ACL
// Missing: (1) initial app-bump, (2) password via nobody/servicesNS, (3) move endpoint for app change, (4) final ACL in new app context
```

### Legacy Reference
```javascript
// password-crud.js lines 511-554 — FOUR STEPS:
// 1. POST buildAclPath → { perms.read, perms.write, sharing: 'app', owner }  // ALWAYS bump to app first
// 2. If password changed: POST /servicesNS/nobody/{row.app}/storage/passwords/{stanza} → { password }
//    NOTE: uses "nobody" as namespace, not the credential's owner!
// 3. If row.app !== newApp: POST /move endpoint → { app: newApp, user: 'nobody' }
// 4. POST ACL in NEW app context (or same app if unchanged) → final sharing + perms

// Build per-step messages for result display (success or failure at each step)
```

### Target Behavior

**Rewrite updateCredential to accept:** `credential` object (full row data), and `formData` with `{ password, newPasswordConfirm, newApp, sharing, owner, readRoles, writeRoles }`

**Step 1: ACL bump to app (ALWAYS, regardless of what changed)**
```javascript
POST buildAclPath(credential.stanzaKey, credential.owner, credential.app) → { 'perms.read': formData.readRoles.join(','), 'perms.write': formData.writeRoles.join(','), sharing: 'app', owner: formData.owner }
```

**Step 2: Password update (only if password is provided)**
```javascript
POST /servicesNS/nobody/${credential.app}/storage/passwords/${encodeURIComponent(credential.stanzaKey)} → { password: formData.password }
```

**Step 3: App move (only if app changed)**
```javascript
// Use existing moveCredential() or inline the POST to /move endpoint
POST /servicesNS/nobody/${credential.app}/configs/conf-passwords/credential:${stanzaKey}/move → { app: formData.newApp, user: 'nobody' }
```

**Step 4: Final ACL in new (or same) app context**
```javascript
POST buildAclPath(stanzaKey, formData.owner, formData.newApp || credential.app) → { 'perms.read', 'perms.write', sharing: formData.sharing, owner: formData.owner }
```

All steps must be sequential (await each before next), with per-step error handling.

### Verification Checklist
- [ ] ACL bump to 'app' happens FIRST regardless of what's being updated
- [ ] Password update uses servicesNS/nobody/{oldApp}/ path
- [ ] App move uses /move endpoint when app changes
- [ ] Final ACL sets requested sharing in (potentially new) app context
- [ ] All four steps are sequential with error handling per step

---

## Appendix: Helper Functions to Verify Against Legacy

### getCurrentApp() — needed by bundle.jsx or api.js
```javascript
// password-crud.js lines 734-736:
function getCurrentApp() {
    const match = window.location.pathname.match(/\/app\/([^/]+)/);
    return match ? match[1] : 'search';
}
```

### currentUser() — needed by bundle.jsx or api.js
Legacy uses `Splunk.util.getConfigValue('USERNAME')`. React equivalent options:
- Call `/en-US/splunkd/__raw/servicesNS/-/-/authentication/me?output_mode=json` and extract name
- Check if window.Splunk is available and use same method
- Read from page context (may be set by Splunk global scripts)

### escHtml() — XSS escape helper
```javascript
// password-crud.js lines 740-746:
function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
```
React components don't need this (JSX auto-escapes), but API error messages shown via innerHTML would.

---

## Parallelization Matrix

| Task | Can run with... | Blocks... | Estimated Complexity |
|------|----------------|-----------|---------------------|
| T01 | T02, T03 | T04, T05 | Low |
| T02 | T01, T03 | T06 (sharing validation) | Medium |
| T03 | T01, T02 | — | Low |
| T04 | T05, T06 (after T01) | — | Medium |
| T05 | T04, T06 (after T01) | — | Medium |
| T06 | T04, T05, T07, T09 (after T01, T02) | T09 | Medium |
| T07 | T06, T08 | — | Low-Medium |
| T08 | T07, T09 (can start early since no deps on T06 except ACL helper) | — | Low |
| T09 | T08 (after T06) | — | Medium-High |

**Recommended dispatch order:**
1. Spawn T01 + T02 + T03 in parallel (ParallelGroup A)
2. After A completes, spawn T04 + T05 + T06 + T07 + T08 in parallel (ParallelGroup B+C mixed)
3. T09 starts after T06 completes (last to finish due to four-step complexity)
