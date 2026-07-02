# Expiry Alert Scope and Search App Default Fixes

**Date:** 2026-05-29
**Module:** api.js, CredentialForm.jsx
**Tags:** expiry, alert, search, app-default, kvstore

## Bug 1: Credential expiry alert search too narrow

- **File:** `api.js` — `createOrUpdateExpiryAlert()`
- **Problem:** The saved search used `rest /servicesNS/nobody/rest-storage-passwords-manager/storage/passwords` which only queries the `nobody` namespace in the `rest-storage-passwords-manager` app. This missed:
  - User-scoped credentials (owned by local users like `admin`, not `nobody`)
  - Credentials in other apps
- **Impact:** Expiry alerts only fire for app-scoped credentials in the manager app. User-scoped and cross-app credentials were invisible.
- **Fix:** Changed to `rest /servicesNS/-/-/configs/conf-passwords count=0` which queries ALL namespaces (all users, all apps). Added SPL to parse `name` field (`credential:realm:username:`) to extract `realm` and `username`, matching the credential key format used by the KV Store.

## Bug 2: New credentials default to `search` app instead of current app

- **File:** `CredentialForm.jsx` + `api.js`
- **Problem:** The form hardcoded `'search'` as the default app value:
  - `useState('search')` for initial state
  - `setApp('search')` when creating a new credential
  - `credential.app || 'search'` fallback when editing
  - API `createCredential` also used `app || 'search'`
- **Impact:** When creating credentials, the app dropdown defaulted to `search`. Users had to manually change it to `rest-storage-passwords-manager`. If they didn't notice, the credential was created in the wrong app.
- **Fix:** Changed all `'search'` defaults to `getCurrentApp() || 'search'`:
  - Form initial state: `useState(getCurrentApp() || 'search')`
  - New credential reset: `setApp(getCurrentApp() || 'search')`
  - Edit fallback: `setApp(credential.app || getCurrentApp() || 'search')`
  - API fallback: `app || getCurrentApp() || 'search'`
