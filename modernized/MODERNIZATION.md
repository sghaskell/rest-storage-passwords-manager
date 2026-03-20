# Modernization Summary
## rest-storage-passwords-manager → Splunk 9.2+ / Cloud

---

## Deliverables

| File | What it is |
|---|---|
| `appserver/static/password-crud.js` | **Drop-in replacement.** Same classic dashboard, zero deprecated deps. |
| `src/CredentialManager.jsx` | **React scaffold.** Full `@splunk/react-ui` rewrite for a custom page. |
| `default/data/ui/views/credential_management.xml` | Updated dashboard XML (bootstrap-* entries removed). |

---

## What Changed (by concern)

### Data layer
| Old | New | Why |
|---|---|---|
| `SearchManager` + `\| rest … storage/passwords` | `fetch()` → `splunkd/__raw` | Keeps clear-text out of search job cache/artifacts |
| `SearchManager` + `\| rest … storage/passwords \| table clear_password` | Direct REST GET per credential | Same reason; password only ever touches browser session |
| `SearchManager` + `\| rest … apps/local` | `fetch()` → `/servicesNS/-/-/apps/local` | No search job spin-up; faster |
| Two `SearchManager`s + SPL `append` for roles/users | `Promise.all([roles, users])` + client dedup | Two parallel GETs, no search tier |

### UI layer
| Old | New | Why |
|---|---|---|
| `splunkjs/mvc`, `splunkjs/mvc/searchmanager`, etc. | Removed | Deprecated in 9.x, absent in some Cloud builds |
| `SplunkJS DropdownView` / `MultiDropdownView` | `<select>` (JS) / `Select`+`Multiselect` (React) | No deprecated dep |
| `bootstrap-table.js` v1.11.1 (BS3-era bundle) | Native DOM / `@splunk/react-ui Table` | Eliminates style conflicts with Splunk's own Bootstrap |
| `bootstrap-dropdown.js`, `bootstrap-btn-danger.css` etc. | Removed | Same |
| Custom `Modal.js` + Bootstrap 3 modal markup | Splunk-native modal markup (JS) / `@splunk/react-ui Modal` (React) | No custom bundle |

### State & flow
| Old | New | Why |
|---|---|---|
| `window.sessionStorage` for form-open flag | Module-scoped `boolean` (JS) / `useReducer` (React) | sessionStorage is shared across tabs |
| `location.reload()` after mutations | `refreshTable()` re-fetches credentials only | No full page reload |
| `$.Deferred` / `$.when` / `.then` chains | `async/await` + `Promise.allSettled` | Native, readable, proper error propagation |
| String-concatenated HTML → `innerHTML` | DOM helper `el()` + `textContent` (JS) / React children (React) | Eliminates XSS on all row values |

---

## Migration Path

### Option A – Drop-in (fastest, minimal risk)
1. Copy `appserver/static/password-crud.js` into your app, replacing the original.
2. Copy the updated `default/data/ui/views/credential_management.xml`.
3. Delete `appserver/static/bootstrap-dropdown.js`, `bootstrap-table.js`,
   `bootstrap-table-contextmenu.js` and the three CSS files.  They are no longer
   referenced and will just bloat the app package.
4. Deploy and test.  No `app.conf` changes needed.

### Option B – React custom page (recommended for long-term)
1. Scaffold a new Splunk app package with `npx @splunk/create`.
2. Install deps:
   ```
   npm install @splunk/react-ui @splunk/splunk-utils react react-dom
   ```
3. Drop `src/CredentialManager.jsx` into `src/`.
4. Add a page entry point (`src/main.jsx`):
   ```jsx
   import React from 'react';
   import ReactDOM from 'react-dom';
   import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
   import CredentialManager from './CredentialManager';

   ReactDOM.render(
     <SplunkThemeProvider family="enterprise" colorScheme="light" density="comfortable">
       <CredentialManager />
     </SplunkThemeProvider>,
     document.getElementById('root')
   );
   ```
5. Configure your bundler (`webpack.config.js` or `vite.config.js`) to mark
   `react` and `react-dom` as externals (Splunk provides them at runtime).
6. Delete `appserver/static/password-crud.js` and all bundled bootstrap files.
7. Replace `credential_management.xml` with a page entry pointing at your bundle.

---

## Preserved Behaviours (intentional)

- **Two-step ACL pattern on create/update:** Setting `sharing=app` before
  applying the real sharing value is a splunkd requirement when the target
  sharing is `user`. Both files preserve this.
- **Realm immutable on update:** The `storage/passwords` REST endpoint does not
  allow realm changes post-creation. Both files disable the realm field in
  update forms.
- **Sharing bump before show-password:** For user-scoped credentials, sharing
  must be temporarily set to `app` before the clear-text read is possible.
  Both files replicate the original logic.
- **ACL removal before DELETE:** The original set ACLs before the DELETE call
  to ensure a predictable URI. Both files preserve this.

---

## Remaining Gaps (not in scope for this pass)

| Gap | Recommendation |
|---|---|
| `ui-tour.conf` image paths with `:` in directory name | Rename `img/credential_management-tour:enterprise/` → `img/credential_management-tour/`; update `ui-tour.conf` paths |
| No `python.version = python3` in `app.conf` | Add under `[launcher]` even with no Python scripts; required for Splunkbase Cloud vetting |
| `check_for_updates = 1` in `app.conf` | Set to `0` if not publishing to Splunkbase; avoids unnecessary outbound calls |
| No `appserver/templates` Mako template | Low priority; relevant only if you add server-side rendered pages |
