---
title: "fix: Credential Tagging — Switch to KVStore"
type: fix
status: draft
date: 2026-05-27
origin: "tagging feature uses broken conf-tags endpoint; revert to KVStore (original plan)"
---

# fix: Credential Tagging — KVStore Implementation

## Problem Summary

The tagging feature was implemented twice:
1. **Committed code** (`4d3fa08`): KVStore collections (`credential_tags`, `tag_definitions`) — correct approach
2. **Uncommitted changes**: Switched to `configs/conf-tags` — broken, never committed

The switch happened during local debugging when KVStore endpoints failed testing. `conf-tags` (Splunk's `tags.conf`) was tried as a workaround but is the wrong abstraction — it's designed for event classification, not application data storage.

## Why conf-tags Fails

| Issue | Detail |
|---|---|
| Wrong config type | `conf-tags` requires `tags.conf` schema — arbitrary stanzas with `tag` field are hacky |
| Colons in names | Stanza names like `cred:prod:api:search:admin:app` may conflict with Splunk config parsing |
| `_reload` required | Writes don't appear in GET without explicit `_reload` POST — production code doesn't call this |
| Silent failures | POST to `conf-tags` may succeed (201) but entries not retrievable |
| No transactional semantics | `conf-tags` is for Splunk internal use — behavior may change between versions |

## Why KVStore Failed (Original Attempt)

The debug test files reveal the investigation:

| Test File | Purpose | Likely Failure |
|---|---|---|
| `test-tags-debug.spec.js` | KVStore via browser session | Collection creation failed (404/403) |
| `test-tags-debug2.spec.js` | Endpoint discovery | Mapped all `/servicesNS/*/data/*` paths |
| `test-kvstore-debug.spec.js` | Direct KVStore CRUD | Collection POST failed |
| `test-kvstore-direct.spec.js` | `/storage/collections/data` endpoint | Alternative endpoint tested |
| `test-conf-tags-debug.spec.js` | conf-tags workaround | Attempted as fallback |
| `test-tags-e2e.spec.js` | conf-tags E2E | Full CRUD on conf-tags |
| `test-tags-end-to-end.spec.js` | Custom `conf-credential-tags` | Last-resort custom config |

**Root cause**: KVStore endpoints accessed through `splunkd/__raw` proxy likely had one of these issues:
- **CSRF token not sent** on collection creation POST
- **`output_mode=json` not appended** to GET requests for `/data/collections/`
- **`_key` field not set** on document POST (required for upsert)
- **409 conflict handling** — POST to same `_key` should update, not error

## KVStore API — Correct Usage

### Endpoints (through `splunkd/__raw` proxy)

| Operation | Method | Path | Notes |
|---|---|---|---|
| List collections | GET | `/servicesNS/-/-/data/collections` | Check if collection exists |
| Create collection | POST | `/servicesNS/-/-/data/collections` | `name=X&fields=field1:type1,field2:type2` |
| Schema | GET | `/servicesNS/-/-/data/collections/NAME` | Returns collection schema |
| List docs | GET | `/servicesNS/-/-/data/collections/NAME` | Returns all documents |
| Get doc | GET | `/servicesNS/-/-/data/collections/NAME/KEY` | Get by `_key` |
| Insert doc | POST | `/servicesNS/-/-/data/collections/NAME` | `field=value&_key=UNIQUE_KEY` |
| Update doc | POST | `/servicesNS/-/-/data/collections/NAME/KEY` | `field=new_value&_key=KEY` |
| Delete doc | DELETE | `/servicesNS/-/-/data/collections/NAME/KEY` | Delete by `_key` |

**Critical**: All endpoints use `/servicesNS/-/-/data/collections/...` (wildcard namespace). The original code used `/servicesNS/admin/search/data/collections/...` which may have caused permission issues.

### Collection Schema

```
credential_tags:
  _key: string (unique credential identifier)
  tags: string (JSON array of tag strings)

tag_definitions:
  _key: string (lowercase tag name)
  color: string (hex color code)
```

## Implementation Plan

### Phase 1: Restore KVStore API Functions (`api.js`)

Replace the `conf-tags` section with corrected KVStore functions. Key changes from the original attempt:

1. **Use wildcard namespace** (`/servicesNS/-/-/`) instead of `admin/search`
2. **Always include `_key`** on document POST for upsert behavior
3. **Handle 409 conflicts** — POST to existing `_key` updates, not errors
4. **No `_reload` needed** — KVStore is immediately consistent

```javascript
// ─── Credential Tagging (KVStore) ─────────────────────────────────────────

const TAGS_COLLECTION = 'credential_tags';
const TAG_DEFS_COLLECTION = 'tag_definitions';

// Base path — use wildcard namespace for admin access
const KVSTORE_BASE = '/servicesNS/-/-/data/collections';

/**
 * Hash tag name to consistent color from fixed palette.
 */
function hashToColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var palette = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
        '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
        '#e11d48', '#84cc16', '#a855f7', '#0ea5e9', '#d946ef',
    ];
    return palette[Math.abs(hash) % palette.length];
}

/**
 * Ensure a KVStore collection exists. Create if missing.
 * Returns true if collection is available.
 */
async function ensureCollection(name, fields) {
    try {
        // Check if collection exists
        await splunkdRequest(KVSTORE_BASE + '/' + name, { method: 'GET' });
        return true;
    } catch (e) {
        if (e.status === 404) {
            // Create collection
            var fieldStr = fields.map(function(f) {
                return f.name + ':' + f.type;
            }).join(',');
            try {
                await splunkdRequest(KVSTORE_BASE, {
                    method: 'POST',
                    body: {
                        name: name,
                        fields: fieldStr,
                    },
                });
                return true;
            } catch (createErr) {
                if (createErr.status === 409 || createErr.status === 403) {
                    // Collection already exists or permission denied — try to use it
                    return true;
                }
                throw createErr;
            }
        }
        throw e;
    }
}

/**
 * Initialize tag collections lazily.
 */
async function ensureTagCollections() {
    await ensureCollection(TAGS_COLLECTION, [
        { name: 'tags', type: 'string' },
    ]);
    await ensureCollection(TAG_DEFS_COLLECTION, [
        { name: 'color', type: 'string' },
    ]);
}

/**
 * Build unique key from credential object.
 * Format: realm:name:app:owner:sharing
 * URL-safe — no special chars that break KVStore paths.
 */
function tagCredKey(cred) {
    return (cred.realm || '') + '|' + (cred.name || '') + '|' +
           (cred.app || 'search') + '|' +
           (cred.namespaceOwner || cred.owner || 'nobody') + '|' +
           (cred.sharing || 'app');
}

/**
 * Set tags for a credential (replace all existing tags).
 */
async function setTagsForCredential(credential, tags) {
    await ensureTagCollections();
    var key = tagCredKey(credential);
    var cleanTags = tags
        .map(function(t) { return t.trim().toLowerCase(); })
        .filter(Boolean)
        .slice(0, 5);

    // Validate tag names
    for (var i = 0; i < cleanTags.length; i++) {
        var tag = cleanTags[i];
        if (!/^[a-z0-9_-]{1,50}$/.test(tag)) {
            throw new Error('Invalid tag name: ' + tag + ' — use only lowercase letters, numbers, hyphens, underscores (max 50 chars)');
        }
    }

    // Upsert tag definitions for new tags
    var existingDefs = await getAllTagDefinitions();
    for (var j = 0; j < cleanTags.length; j++) {
        var tag = cleanTags[j];
        if (!existingDefs.some(function(d) { return d._key === tag; })) {
            try {
                await splunkdRequest(KVSTORE_BASE + '/' + TAG_DEFS_COLLECTION, {
                    method: 'POST',
                    body: {
                        _key: tag,
                        color: hashToColor(tag),
                    },
                });
            } catch (tagErr) {
                if (tagErr.status === 409) continue; // already exists
                throw tagErr;
            }
        }
    }

    // Upsert credential tags document
    // POST to collection with _key = upsert (creates or updates)
    try {
        await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION, {
            method: 'POST',
            body: {
                _key: key,
                tags: JSON.stringify(cleanTags),
            },
        });
    } catch (e) {
        if (e.status === 409) {
            // Already exists — use PUT-style update via doc endpoint
            await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
                method: 'POST',
                body: {
                    _key: key,
                    tags: JSON.stringify(cleanTags),
                },
            });
        } else {
            throw e;
        }
    }

    return cleanTags;
}

/**
 * Get tags for a credential.
 */
async function getTagsForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        var data = await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'GET',
        });
        // KVStore returns { items: [...] }
        var items = data.items || [];
        if (items.length > 0 && items[0].tags) {
            return JSON.parse(items[0].tags);
        }
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    return [];
}

/**
 * Remove a specific tag from a credential.
 */
async function removeTagFromCredential(credential, tagToRemove) {
    var existing = await getTagsForCredential(credential);
    var updated = existing.filter(function(t) {
        return t !== tagToRemove.toLowerCase();
    });
    if (updated.length === existing.length) return existing;
    return setTagsForCredential(credential, updated);
}

/**
 * Get all tag definitions (tag name → color mapping).
 */
async function getAllTagDefinitions() {
    try {
        var data = await splunkdRequest(KVSTORE_BASE + '/' + TAG_DEFS_COLLECTION, {
            method: 'GET',
        });
        return (data.items || []).map(function(doc) {
            return { _key: doc._key, color: doc.color };
        });
    } catch (e) {
        if (e.status === 404) return [];
        throw e;
    }
}

/**
 * Get all tag-to-credential mappings (batch fetch for enrichment).
 * Returns Object: cred_key → [tag strings]
 */
async function getAllTagsData() {
    try {
        var data = await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION, {
            method: 'GET',
        });
        var result = {};
        (data.items || []).forEach(function(doc) {
            if (doc._key && doc.tags) {
                result[doc._key] = JSON.parse(doc.tags);
            }
        });
        return result;
    } catch (e) {
        if (e.status === 404) return {};
        throw e;
    }
}

/**
 * Delete tags for a credential (cleanup on credential delete).
 */
async function deleteTagsForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'DELETE',
        });
    } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
    }
}

/**
 * Delete a tag definition.
 */
async function deleteTagDefinition(tagName) {
    try {
        await splunkdRequest(KVSTORE_BASE + '/' + TAG_DEFS_COLLECTION + '/' + encodeURIComponent(tagName), {
            method: 'DELETE',
        });
    } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
    }
}
```

### Phase 2: Fix `bundle.jsx` Key Consistency

**Current bug**: `loadCredentials()` builds `credKey` from `cred.realm` which includes the full realm string (with expiry: `"prod;expiry_2026-06-01"`). But `tagCredKey()` in `setTagsForCredential()` also uses `cred.realm`.

The fix: use `|` delimiter instead of `:` to avoid ambiguity with realm colons, and ensure `tagCredKey()` is called consistently everywhere.

**Changes in `bundle.jsx`:**

```javascript
// In loadCredentials() — use tagCredKey from API for consistency
var allTags = await API.getAllTagsData();
var tagDefs = await API.getAllTagDefinitions();
var tagColorMap = {};
tagDefs.forEach(function(d) { tagColorMap[d._key] = d.color; });

var enriched = fetched.map(function(cred) {
    // ... existing expiry/rotation logic ...
    var credKey = API.tagCredKey(cred);  // Use API function — consistent key
    var tags = allTags[credKey] || [];
    // ... rest unchanged ...
});
```

```javascript
// In handleCreateCredential — use tagCredKey from API
if (data.tags && data.tags.length > 0) {
    try {
        var createTagCred = {
            name: data.username,
            realm: realmToSave,
            app: data.app,
            namespaceOwner: data.owner,
            sharing: data.sharing || 'app',
        };
        await API.setTagsForCredential(createTagCred, data.tags);
    } catch (tagErr) {
        console.error('[TAGS][CREATE] failed:', tagErr.message);
        // Tag failure is non-fatal — credential was created
    }
}
```

```javascript
// In handleUpdateCredential — same pattern, cleanup old tags if realm changed
// (tagCredKey changes when realm changes)
if (data.tags && data.tags.length > 0) {
    try {
        var updateTagCred = {
            name: data.username,
            realm: newRealm,
            app: data.app,
            namespaceOwner: data.owner,
            sharing: data.sharing || 'app',
        };
        await API.setTagsForCredential(updateTagCred, data.tags);
    } catch (tagErr) {
        console.error('[TAGS][UPDATE] failed:', tagErr.message);
    }
}
```

**Key consistency rule**: `tagCredKey()` must be the SINGLE source of truth for credential→tag mapping. All callers use `API.tagCredKey(cred)`. Never inline the key construction.

### Phase 3: `CredentialForm.jsx` — No Changes Needed

The tag UI (input, autocomplete, pills) is already implemented and doesn't depend on storage backend. Just ensure it calls the correct API functions (`getTagsForCredential`, `getAllTagDefinitions`).

### Phase 4: `CredentialTable.jsx` — No Changes Needed

Tags column, pills, and tag filter are already implemented. No storage-backend dependency.

### Phase 5: Error Handling Improvements

**Current issue**: Tag save failures are silently swallowed. Users never know if tags were actually saved.

**Fix**: Show a non-blocking toast/warning when tag operations fail:

```javascript
// In handleCreateCredential:
} catch (tagErr) {
    console.error('[TAGS][CREATE] failed:', tagErr.message);
    // Non-fatal — credential saved, tags may need retry
}

// After credential save success, show warning if tags failed
showWarning('Tags', ['Tags could not be saved. ' + tagErr.message + '. Try saving again.']);
```

### Phase 6: KVStore Graceful Degradation

If KVStore is not available (e.g., Splunk instance without KVStore app):

```javascript
var _kvstoreAvailable = null;

async function checkKVStoreAvailable() {
    if (_kvstoreAvailable !== null) return _kvstoreAvailable;
    try {
        await splunkdRequest(KVSTORE_BASE, { method: 'GET' });
        _kvstoreAvailable = true;
    } catch (e) {
        if (e.status === 404 || e.status === 403) {
            _kvstoreAvailable = false;
        }
        throw e;
    }
    return true;
}
```

If KVStore is unavailable, show a UI warning: "Tagging requires Splunk KVStore — feature disabled."

### Phase 7: Cleanup

Remove uncommitted `conf-tags` code and debug test files:

| File | Action |
|---|---|
| `default/credential_tags.conf` | Delete (empty, unused) |
| `default/restconf` | Delete |
| `tests/test-tags-debug.spec.js` | Delete (KVStore debug) |
| `tests/test-tags-debug2.spec.js` | Delete (endpoint discovery) |
| `tests/test-kvstore-debug.spec.js` | Delete |
| `tests/test-kvstore-direct.spec.js` | Delete |
| `tests/test-conf-tags-debug.spec.js` | Delete |
| `tests/test-tags-e2e.spec.js` | Delete (conf-tags E2E) |
| `tests/test-tags-end-to-end.spec.js` | Delete (custom config) |
| `tests/test-direct-rest.spec.js` | Delete |
| `tests/test-splunkd-endpoints.spec.js` | Delete |
| `tests/test-splunkd-proxy.spec.js` | Delete |
| `tests/test-splunk-configs.spec.js` | Delete |

## Files to Modify

| File | Change |
|---|---|
| `appserver/static/react/api.js` | Replace `conf-tags` section with KVStore functions |
| `appserver/static/react/bundle.jsx` | Use `API.tagCredKey()` consistently; fix key construction |
| `appserver/static/react/components/CredentialForm.jsx` | No changes (storage-agnostic) |
| `appserver/static/react/components/CredentialTable.jsx` | No changes (storage-agnostic) |

## Data Model (Unchanged from Original Plan)

```javascript
// credential_tags collection (KVStore)
{
    _key: "prod|api-user|search|nobody|app",
    tags: '["production","api","critical"]',
}

// tag_definitions collection (KVStore)
{
    _key: "production",
    color: "#3b82f6",
}

// Enriched credential shape (in memory)
{
    name: 'api-user',
    realm: 'prod',
    tags: [
        { name: 'production', color: '#3b82f6' },
        { name: 'api', color: '#10b981' },
    ],
}
```

## Testing Plan

1. **KVStore availability** — check `/data/collections` returns 200
2. **Collection creation** — POST creates `credential_tags` and `tag_definitions`
3. **Tag CRUD** — create, read, update, delete tags for a credential
4. **Key consistency** — `tagCredKey()` produces same key at create, update, and load
5. **Realm with expiry** — tags persist correctly when realm includes expiry date
6. **409 handling** — POST to existing `_key` updates, doesn't error
7. **Graceful degradation** — UI warning when KVStore unavailable
8. **Tag limit** — verify max 5 tags enforced
9. **Tag validation** — reject invalid characters
10. **Bulk operations** — add/remove tags on selected rows
11. **Credential delete cleanup** — tag document removed on credential delete
12. **Edit persistence** — tags persist across credential edits

## Rollout Steps

1. Restore KVStore code in `api.js` (replace `conf-tags` section)
2. Fix `bundle.jsx` to use `API.tagCredKey()` consistently
3. Clean up stale debug test files
4. Build and deploy
5. Test against Splunk instance — verify KVStore endpoints work
6. If KVStore still fails, investigate specific error (log full response)
