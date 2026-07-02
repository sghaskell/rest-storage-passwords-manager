# KV Store Collections Remediation — Full Agent Handoff Summary

## Date
2026-05-29

## Problem Statement
The app uses 4 KV store collections that were all created dynamically at runtime in the `search` app namespace instead of being pre-defined and scoped to `rest-storage-passwords-manager`. Additionally, the app uses `_key` (the CouchDB document ID) as the primary identifier for joining data via `inputlookup` — but `_key` is a Splunk reserved system field that is NOT returned by `inputlookup` queries. This breaks the password rotation alert SPL query which joins credentials to expiry data using `_key`.

## Research Done
- Read Splunk 10.2.0 `collections.conf` reference (https://help.splunk.com/en/data-management/splunk-enterprise-admin-manual/10.2/configuration-file-reference/10.2.0-configuration-file-reference/collections.conf)
- Confirmed: `field.<name>` syntax (not `fields.`), valid types are `number|bool|string|time` (not `boolean`)
- Confirmed: `_key` is a reserved CouchDB document ID — required for CRUD operations, NOT returned by `inputlookup`
- Confirmed: No `quality` attribute exists in collections.conf
- Identified all KV store code in `appserver/static/react/api.js` (the source; `bundle.js` is compiled)

## Collections Inventory

| Collection | `_key` value | Custom lookup field | Purpose |
|---|---|---|---|
| `credential_expiry` | `realm|name|app|owner|sharing` | `credential_key` | Expiry dates per credential |
| `credential_tags` | `realm|name|app|owner|sharing` | `credential_key` | Tag labels per credential |
| `tag_definitions` | tag name string | `tag_name` | Tag name → color mapping |
| `password_policy` | `"default"` (single doc) | `policy_key` | Password policy config |

## Files Created

### `default/data/lookup/collections.conf`
Pre-defines all 4 KV store collections with field type declarations. Uses `field.<name>` syntax per Splunk 10.2.0 spec. No `quality` attribute. Field types: `string`, `bool`, `number`.

## Files Modified

### `appserver/static/react/api.js` (9 edits)

1. **Line ~2329 — `KVSTORE_CONFIG` URL**: `/servicesNS/nobody/search/...` → `/servicesNS/nobody/rest-storage-passwords-manager/...`

2. **Line ~2330 — `KVSTORE_DATA` URL**: `/servicesNS/nobody/search/...` → `/servicesNS/nobody/rest-storage-passwords-manager/...`

3. **Lines ~2320-2326 — Comments**: Updated comments referencing `nobody/search` to `nobody/rest-storage-passwords-manager`

4. **Line ~1858-1863 — SPL alert query** (`createOrUpdateExpiryAlert`):
   - `| rest /servicesNS/nobody/search/storage/passwords` → `| rest /servicesNS/nobody/rest-storage-passwords-manager/storage/passwords`
   - `eval _key=realm...` → `eval credential_key=realm...`
   - `join type=left _key` → `join type=left credential_key`
   - `fields _key expiry_date` → `fields credential_key expiry_date`

5. **Line ~2001 — `savePolicyToKVStore`**: Added `policy_key: 'default'` alongside `_key: 'default'`

6. **Line ~2116 — `setExpiryForCredential`**: Added `credential_key: key` alongside `_key: key`

7. **Lines ~2163-2164 — `getAllExpiryData`**: Changed `doc._key` → `doc.credential_key` (both in condition and assignment)

8. **Line ~2552 — `setTagsForCredential` (tag definitions)**: Added `tag_name: tag` alongside `_key: tag`

9. **Line ~2559 — `setTagsForCredential` (credential tags)**: Added `credential_key: key` alongside `_key: key`

10. **Line ~2619 — `getAllTagDefinitions`**: Changed `doc._key` → `doc.tag_name`

11. **Lines ~2640-2641 — `getAllTagsData`**: Changed `doc._key` → `doc.credential_key` (both in condition and assignment)

12. **Comment update**: Changed "collections are schema-less" comment to reference `collections.conf`

### `appserver/static/react/bundle.js`
Rebuilt via `npm run build` — webpack 5 compiled with 3 warnings (all size-related, pre-existing).

## Key Design Decisions

1. **`_key` is preserved for API calls** — It's the CouchDB document ID required by Splunk's KV store REST API for create/update/delete. You cannot replace it.

2. **Custom fields duplicate the `_key` value** — `credential_key`, `tag_name`, `policy_key` carry the same value as `_key` but ARE returned by `inputlookup` because they are regular fields defined in `collections.conf`.

3. **No `lookups.conf` needed** — When a collection is defined in `collections.conf`, Splunk auto-generates the lookup definition. `inputlookup credential_expiry` works directly against the collection.

4. **`ensureCollection()` still exists** — The runtime fallback handles cases where the collection hasn't been deployed yet or Splunk hasn't initialized it. It's a safety net, not the primary creation mechanism.

## What Was NOT Changed
- `password-crud.js` — Does not use KV store collections (it uses `storage/passwords` REST API only)
- `bundle.jsx` — Entry point file, no KV store logic
- React components — They call the `api.js` functions; no direct KV store references

## Migration Impact
Existing documents in the `search` app's KV store collections will NOT automatically migrate to the new app namespace. The `collections.conf` defines collections scoped to `rest-storage-passwords-manager`. New writes will populate the custom fields (`credential_key`, `tag_name`, `policy_key`). Existing documents in the old `search` collections will lack these custom fields until they are updated.

## Build Command
```
npm run build
```
Entry: `appserver/static/react/bundle.jsx` → Output: `appserver/static/react/bundle.js`
