# KV Store Update Bugs & Realm Expiry Removal

**Date:** 2026-05-29
**Module:** bundle.jsx, api.js, CredentialForm.jsx, CredentialTable.jsx, ExpiryDashboard.jsx
**Tags:** kvstore, expiry, tags, update, bug, cleanup, realm

## Bugs Fixed (from prior investigation)

### BUG 1: Tags NOT deleted when all tags cleared (handleUpdateCredential)
- **File:** `bundle.jsx`
- **Problem:** Only saved tags when `data.tags.length > 0`, leaving old tags in KV Store
- **Fix:** Added `else` branch calling `API.deleteTagsForCredential()` when tags are empty

### BUG 2: `resolveExpiryDate` called without `expiryMap` (handleUpdateCredential)
- **File:** `bundle.jsx`
- **Problem:** `API.resolveExpiryDate(credential)` without map returns `null`
- **Fix:** Changed to `credential.expiryDate || ''` (already enriched by `loadCredentials`)

### BUG 3: `resolveExpiryDate` called without `expiryMap` (rotatePasswords)
- **File:** `api.js`
- **Problem:** Same as BUG 2 — "extend-original" expiry strategy broken
- **Fix:** Changed to `cred.expiryDate || null`

## Realm-Based Expiry Code Removed

All code that stored expiry dates in the realm string has been removed. Expiry is now KV Store only.

### Removed from api.js:
- `parseExpiryFromRealm()` — parsed `expiry_` and `expiry:` from realm strings
- `buildRealmWithExpiry()` — built combined `"baseRealm;expiry_DATE"` strings
- `resolveBaseRealm()` — extracted base realm from combined format
- `migrateExpiryFromRealm()` — migration function to move expiry from realm to KV Store
- `resolveExpiryDate()` realm fallback — now KV Store only
- Stale comments referencing combined realm+expiry format
- Exports for all removed functions

### Removed from bundle.jsx:
- `handleMigrateExpiry()` — migration handler function
- "Migrate Expiry to KV Store" menu item in the dropdown
- `API.parseExpiryFromRealm()` calls in realm filter (line ~401)
- `API.parseExpiryFromRealm()` calls in RoleAccessView (lines ~2039, ~2089)

### Removed from CredentialForm.jsx:
- Imports of `parseExpiryFromRealm` and `resolveBaseRealm`
- `resolveBaseRealm()` call when initializing form from credential
- Fallback to `parseExpiryFromRealm()` for expiry date pre-population

### Removed from CredentialTable.jsx:
- `_parseRealmForDisplay()` — local function that parsed expiry from realm
- 3 call sites replaced with direct `credential.realm` / `cred.expiryDate`

### Removed from ExpiryDashboard.jsx:
- `API.parseExpiryFromRealm()` call for realm display
