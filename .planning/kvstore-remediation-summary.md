# KV Store Collections Remediation — Summary

## Problem
- 4 KV store collections were created dynamically at runtime in the `search` app
- `_key` (CouchDB document ID) was used as the only identifier, but `_key` is a reserved field NOT returned by `inputlookup`
- The password rotation alert SPL query joined credentials to expiry data using `_key` — which was empty in the lookup results

## Root Cause
`_key` is the CouchDB document ID. It's required for KV store CRUD operations but is a reserved system field that `inputlookup` does not return.

## Solution
1. Keep `_key` for API operations (it's required by Splunk)
2. Duplicate the key value into a custom field that IS returned by lookups
3. Pre-define collections in `collections.conf` instead of creating them dynamically
4. Scope API calls to `rest-storage-passwords-manager` instead of `search`

## Files Changed

### Created
- `default/data/lookup/collections.conf` — Pre-defines 4 collections with `field.<name>` syntax

### Modified
- `appserver/static/react/api.js` — 9 changes:
  - KV store URLs: `nobody/search` → `nobody/rest-storage-passwords-manager`
  - SPL alert query: `_key` → `credential_key`, `rest /servicesNS/nobody/search` → `rest /servicesNS/nobody/rest-storage-passwords-manager`
  - `credential_expiry` writes: add `credential_key: key`
  - `credential_tags` writes: add `credential_key: key`
  - `tag_definitions` writes: add `tag_name: tag`
  - `password_policy` writes: add `policy_key: 'default'`
  - `getAllExpiryData` reads: `doc._key` → `doc.credential_key`
  - `getAllTagDefinitions` reads: `doc._key` → `doc.tag_name`
  - `getAllTagsData` reads: `doc._key` → `doc.credential_key`

- `appserver/static/react/bundle.js` — Rebuilt via `npm run build`

## Field Mapping

| Collection | `_key` (CouchDB ID) | Custom field (lookup-able) |
|---|---|---|
| `credential_expiry` | `realm\|name\|app\|owner\|sharing` | `credential_key` |
| `credential_tags` | `realm\|name\|app\|owner\|sharing` | `credential_key` |
| `tag_definitions` | tag name | `tag_name` |
| `password_policy` | `"default"` | `policy_key` |

## Migration Note
Existing data in `search` app collections will NOT automatically migrate. The collections now live in `rest-storage-passwords-manager` and the custom fields (`credential_key`, `tag_name`, `policy_key`) will be populated on subsequent writes. Existing documents will lack these fields until updated. A one-time migration can be done via a SPL command to copy `_key` → custom field for existing records.
