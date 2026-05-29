# Fix Plan — Expiry Intermittent Failure

**Date:** 2026-05-28  
**Scope:** `ensureCollection`, `setExpiryForCredential`, `handleCreateCredential`, `handleUpdateCredential`  
**Root cause:** Collection initialization race + silent error swallowing

---

## Problem Summary

```
ensureCollection creates collection
→ No delay for initialization  
→ POST to KVStore data fails (500)
→ Error propagates to handleCreateCredential  
→ Swallowed silently
→ User sees "Credential Created" — expiry is gone
```

Two bugs:
1. `ensureCollection` (api.js:2348) creates the collection but returns immediately — the KVStore index hasn't finished building
2. `handleCreateCredential` and `handleUpdateCredential` (bundle.jsx) catch expiry errors and log to console — user never sees the failure

---

## Files to modify

| File | Purpose |
|------|---------|
| `api.js` (2828 lines) | Fix `ensureCollection` race + add retry in `setExpiryForCredential` |
| `bundle.jsx` | Surface expiry/tag errors via `showWarning` |

---

## Fix 1: Deduplicate in-flight `ensureCollection` calls (api.js)

**Location:** Before `ensureCollection` at line ~2348  
**Add:** Module-level promise map to prevent concurrent creation attempts

```javascript
// Deduplicate in-flight collection creation requests
var collectionCreationPromises = {};
```

**Current `ensureCollection` (lines 2348-2378):**

```javascript
async function ensureCollection(name) {
    var configUrl = KVSTORE_CONFIG + '/' + name;
    try {
        await splunkdRequest(configUrl, { method: 'GET' });
        return true;
    } catch (e) {
        if (e.status === 404) {
            try {
                await splunkdRequest(KVSTORE_CONFIG, {
                    method: 'POST',
                    body: { name: name },
                });
                console.log('[TAGS] Created KVStore collection:', name);
                return true;
            } catch (createErr) {
                if (createErr.status === 409) {
                    console.log('[TAGS] Collection', name, 'already exists (race condition resolved)');
                    return true;
                }
                console.error('[TAGS] Failed to create collection', name, ':', createErr.message);
                throw createErr;
            }
        }
        throw e;
    }
}
```

**New `ensureCollection`:**

```javascript
async function ensureCollection(name) {
    var configUrl = KVSTORE_CONFIG + '/' + name;
    try {
        await splunkdRequest(configUrl, { method: 'GET' });
        return true; // Collection exists
    } catch (e) {
        if (e.status !== 404) throw e;

        // If another request is already creating this collection, wait for it
        if (collectionCreationPromises[name]) {
            try {
                await collectionCreationPromises[name];
                return true;
            } catch (waitErr) {
                // Creation failed, fall through to try ourselves
            }
            delete collectionCreationPromises[name];
        }

        var createPromise = (async function() {
            try {
                await splunkdRequest(KVSTORE_CONFIG, {
                    method: 'POST',
                    body: { name: name },
                });
                // Wait for the collection to finish initializing
                await waitForCollectionReady(name);
                console.log('[KVSTORE] Created collection:', name);
            } catch (createErr) {
                if (createErr.status === 409) {
                    // Someone else created it — wait for it to be ready too
                    console.log('[KVSTORE] Collection', name, 'created by another request');
                    await waitForCollectionReady(name);
                    return;
                }
                throw createErr;
            }
        })();

        collectionCreationPromises[name] = createPromise;
        try {
            await createPromise;
        } finally {
            delete collectionCreationPromises[name];
        }
        return true;
    }
}
```

**Add `waitForCollectionReady` before `ensureCollection` (~line 2348):**

```javascript
/**
 * Poll the KVStore config endpoint until the collection reports "created" state.
 * Splunk 10.2: after POST to /storage/collections/config, the collection needs
 * a moment to initialize its internal index. During this window, data POSTs fail with 500.
 */
async function waitForCollectionReady(name, maxAttempts, intervalMs) {
    maxAttempts = maxAttempts || 10;   // Up to 2 seconds
    intervalMs = intervalMs || 200;
    var configUrl = KVSTORE_CONFIG + '/' + name;

    for (var i = 0; i < maxAttempts; i++) {
        try {
            var config = await splunkdRequest(configUrl, { method: 'GET' });
            var state = null;
            // Splunk returns { entry: [{ content: { state: "created" } }] }
            if (config && config.entry && config.entry[0]) {
                state = config.entry[0].content.state;
            }
            if (state === 'created') {
                return true;
            }
        } catch (e) {
            // Collection still initializing — GET may 500 or 404 briefly
        }
        await new Promise(function(resolve) { setTimeout(resolve, intervalMs); });
    }
    // Last resort: collection exists but state unknown — assume it's ready
    // The retry loop in setExpiryForCredential will catch any remaining issues
    console.warn('[KVSTORE] Collection', name, 'state not "created" after polling — proceeding anyway');
    return true;
}
```

---

## Fix 2: Retry loop in `setExpiryForCredential` (api.js)

**Location:** Lines 2103-2129  
**Current:**

```javascript
async function setExpiryForCredential(credential, expiryDate) {
    await ensureExpiryCollection();
    var key = tagCredKey(credential);
    var body = {
        _key: key,
        expiry_date: expiryDate || '',
    };
    try {
        await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION, {
            method: 'POST',
            body: body,
            jsonBody: true,
        });
    } catch (e) {
        if (e.status === 409) {
            await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key), {
                method: 'POST',
                body: body,
                jsonBody: true,
            });
        } else {
            throw e;
        }
    }
    console.log('[EXPIRY][SAVE] key:', key, 'expiry_date:', expiryDate || '(cleared)');
}
```

**New:**

```javascript
async function setExpiryForCredential(credential, expiryDate) {
    await ensureExpiryCollection();
    var key = tagCredKey(credential);
    var body = {
        _key: key,
        expiry_date: expiryDate || '',
    };

    var maxAttempts = 3;
    var baseUrl = KVSTORE_DATA + '/' + EXPIRY_COLLECTION;
    var useKeyPath = false;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (useKeyPath) {
                // Update existing document
                await splunkdRequest(baseUrl + '/' + encodeURIComponent(key), {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
            } else {
                // Create new document
                await splunkdRequest(baseUrl, {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
            }
            console.log('[EXPIRY][SAVE] key:', key, 'expiry_date:', expiryDate || '(cleared)');
            return; // Success
        } catch (e) {
            if (e.status === 409) {
                // Document already exists — switch to update path
                useKeyPath = true;
                continue; // Retry immediately with the key path
            }
            if (attempt < maxAttempts - 1 && (e.status === 500 || e.status === 503)) {
                // Transient error (collection not ready, etc.) — retry with backoff
                var backoff = 200 * Math.pow(2, attempt);
                console.warn('[EXPIRY][SAVE] attempt', attempt + 1, 'failed:', e.message, '- retrying in', backoff, 'ms');
                await new Promise(function(resolve) { setTimeout(resolve, backoff); });
                continue;
            }
            // Max attempts reached or non-retryable error
            throw e;
        }
    }
}
```

---

## Fix 3: Same retry pattern for `setTagsForCredential` (api.js)

**Location:** Lines ~2427-2468  
**Current:** `setTagsForCredential` has two KVStore data POSTs (tag definitions + tag assignments) — both lack retry logic.

**Changes needed:**

For tag definitions POST (~line 2427):
```javascript
// Current:
await splunkdRequest(KVSTORE_DATA + '/' + TAG_DEFS_COLLECTION, {
    method: 'POST',
    body: { _key: tag, color: hashToColor(tag) },
    jsonBody: true,
});

// Change to retry-wrapped version (same pattern as setExpiryForCredential)
```

For tag assignments POST (~line 2449):
```javascript
// Current:
await splunkdRequest(postUrl, {
    method: 'POST',
    body: postBody,
    jsonBody: true,
});

// Change to retry-wrapped version
```

**Note:** Since both expiry and tags use the same pattern, we should extract a **generic retry helper**:

```javascript
/**
 * POST or update a document in a KVStore collection with retry logic.
 * Handles: 409 (duplicate → switch to key path), 500/503 (transient → retry with backoff).
 */
async function kvStoreSetDocument(collectionName, key, body) {
    var maxAttempts = 3;
    var baseUrl = KVSTORE_DATA + '/' + collectionName;
    var useKeyPath = false;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (useKeyPath) {
                await splunkdRequest(baseUrl + '/' + encodeURIComponent(key), {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
            } else {
                await splunkdRequest(baseUrl, {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
            }
            return; // Success
        } catch (e) {
            if (e.status === 409) {
                useKeyPath = true;
                continue;
            }
            if (attempt < maxAttempts - 1 && (e.status === 500 || e.status === 503)) {
                var backoff = 200 * Math.pow(2, attempt);
                console.warn('[KVSTORE] attempt', attempt + 1, 'failed for', collectionName + '/' + key, ':', e.message, '- retrying in', backoff, 'ms');
                await new Promise(function(resolve) { setTimeout(resolve, backoff); });
                continue;
            }
            throw e;
        }
    }
}
```

Then refactor:
- `setExpiryForCredential` → calls `kvStoreSetDocument(EXPIRY_COLLECTION, key, body)`
- `setTagsForCredential` → calls `kvStoreSetDocument(TAG_DEFS_COLLECTION, tag, body)` and `kvStoreSetDocument(TAGS_COLLECTION, key, body)`

---

## Fix 4: Surface errors to user in bundle.jsx

**Location:** `handleCreateCredential` ~line 641-644  
**Current:**

```javascript
await API.setExpiryForCredential(createExpiryCred, data.expiryDate);
} catch (expErr) {
    console.error('[EXPIRY][CREATE] failed:', expErr.message);
}
```

**New:**

```javascript
await API.setExpiryForCredential(createExpiryCred, data.expiryDate);
} catch (expErr) {
    console.error('[EXPIRY][CREATE] failed:', expErr.message);
    showWarning('Expiry Not Set', [
        'The credential was created, but the expiry date could not be saved.',
        'Error: ' + getErrorMessage(expErr),
    ]);
}
```

Same for tags (~line 651):
```javascript
await API.setTagsForCredential(createTagCred, data.tags);
} catch (tagErr) {
    console.error('[TAGS][CREATE] failed:', tagErr.message);
    showWarning('Tags Not Saved', [
        'The credential was created, but tags could not be saved.',
        'Error: ' + getErrorMessage(tagErr),
    ]);
}
```

**Location:** `handleUpdateCredential` ~line 708-710  
**Current:**

```javascript
} catch (expErr) {
    console.warn('[EXPIRY][UPDATE] failed (non-fatal):', expErr.message);
}
```

**New:**

```javascript
} catch (expErr) {
    console.warn('[EXPIRY][UPDATE] failed (non-fatal):', expErr.message);
    showWarning('Expiry Not Updated', [
        'The credential was updated, but the expiry change could not be saved.',
        'Error: ' + getErrorMessage(expErr),
    ]);
}
```

Same for tags.

---

## Fix 5: Fix `deleteExpiryForCredential` retry (api.js)

**Location:** ~line 2177-2184  
**Current:**

```javascript
async function deleteExpiryForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'DELETE',
        });
    } catch (e) {
        if (e.status !== 404 && e.status !== 400) throw e;
    }
}
```

**Change:** Add 500/503 retry (DELETE can also fail if collection is not ready):

```javascript
async function deleteExpiryForCredential(credential) {
    var key = tagCredKey(credential);
    var url = KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key);
    
    for (var attempt = 0; attempt < 3; attempt++) {
        try {
            await splunkdRequest(url, { method: 'DELETE' });
            return; // Success
        } catch (e) {
            if (e.status === 404 || e.status === 400) {
                return; // Not found or bad key — not an error
            }
            if (attempt < 2 && (e.status === 500 || e.status === 503)) {
                await new Promise(function(resolve) { setTimeout(resolve, 200 * Math.pow(2, attempt)); });
                continue;
            }
            throw e;
        }
    }
}
```

---

## Implementation Order

1. **api.js — add `kvStoreSetDocument` helper** (new function before `ensureCollection`)
2. **api.js — add `waitForCollectionReady`** (new function before `ensureCollection`)
3. **api.js — add `collectionCreationPromises` module var** (before `ensureCollection`)
4. **api.js — rewrite `ensureCollection`** (replace lines 2348-2378)
5. **api.js — rewrite `setExpiryForCredential`** (replace lines 2103-2129)
6. **api.js — rewrite `setTagsForCredential` to use `kvStoreSetDocument`** (replace lines ~2427-2468)
7. **api.js — rewrite `deleteExpiryForCredential`** (replace lines ~2177-2184)
8. **bundle.jsx — add `showWarning` calls for expiry** (lines ~641-644)
9. **bundle.jsx — add `showWarning` calls for tags** (lines ~651)
10. **bundle.jsx — add `showWarning` calls in `handleUpdateCredential`** (lines ~708-710)

---

## Rollback Plan

Each file is modified with exact text replacement. To roll back:

1. Run `git diff api.js bundle.jsx` to review changes
2. If rollback needed: `git checkout HEAD -- api.js bundle.jsx`
3. No database/migration changes — all fixes are in JavaScript logic
4. No breaking API changes — `setExpiryForCredential` signature unchanged

---

## Testing Checklist

- [ ] Create credential with expiry → expiry saved correctly
- [ ] Create credential with expiry → reload page → expiry persists
- [ ] Update credential expiry → change persists
- [ ] Create credential without expiry → no expiry set (no error)
- [ ] Create credential with tags → tags saved
- [ ] Delete credential → expiry + tags cleaned up
- [ ] Concurrent credential creation → no race conditions
- [ ] Error displayed when KVStore is unavailable
- [ ] No regression in existing credential CRUD operations
