# Expiry Intermittent Failure — Deep Analysis

**Date:** 2026-05-28
**Scope:** `setExpiryForCredential`, `ensureCollection`, `handleCreateCredential`, `handleUpdateCredential`

---

## Verdict on the 3 candidates

### Issue #1: `jsonBody: true` missing `output_mode=json` — **MISDIAGNOSED**

The previous analysis correctly identified the code asymmetry but drew the wrong conclusion.

**Fact:** KVStore **data** endpoints (`/storage/collections/data/<name>`) always return `Content-Type: application/json` regardless of `output_mode`. This is hardcoded in Splunk's KVStore data API — `output_mode` is irrelevant for data endpoints.

The response handler in `splunkdRequest` (lines 173-182) checks the response content-type:
- If `application/json` → parses JSON directly
- Otherwise → falls back to `parseSplunkXml()`

Since KVStore data returns JSON content-type, the JSON parser is always used. The missing `output_mode` has **zero impact** on KVStore data writes.

`output_mode=json` IS needed for Splunk **config** endpoints (POST `/storage/collections/config`, POST `/storage/passwords`) which default to XML. These use the form-encoded branch which correctly injects it (line 147).

**Verdict:** Not a bug. The jsonBody branch works correctly because the response content-type drives the parser selection, and KVStore data always returns JSON.

---

### Issue #2: Race in `ensureCollection` — **REAL BUG (primary root cause)**

`ensureCollection` (line 2348) creates the collection but does NOT wait for it to be ready:

```javascript
// Line 2359
await splunkdRequest(KVSTORE_CONFIG, { method: 'POST', body: { name: name } });
// ← No wait for collection to be ready
```

**The race scenario:**
1. First `setExpiryForCredential` calls `ensureExpiryCollection()` — collection doesn't exist, creates it
2. Immediately returns, then `setExpiryForCredential` tries to POST data to the collection
3. Collection exists in config but the internal index hasn't finished building
4. Splunk returns 500 (collection not ready) or the POST silently fails
5. Error propagates up, gets swallowed by the try/catch in `handleCreateCredential`

This is also triggered by concurrent `loadCredentials()` + `setExpiryForCredential()`:
- User creates a credential → `handleCreateCredential` calls `setExpiryForCredential`
- `loadCredentials()` also calls `ensureExpiryCollection()` (if it runs concurrently)
- The second POST to config gets 409, but by then the first collection creation may still be initializing

**Evidence from setExpiryForCredential (line 2103):**
```javascript
async function setExpiryForCredential(credential, expiryDate) {
    await ensureExpiryCollection();
    // ... immediately POSTs to data
    await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION, {
        method: 'POST',
        body: body,
        jsonBody: true,
    });
}
```

No retry, no delay, no readiness check.

---

### Issue #3: Silent error swallowing — **CONFIRMED (makes the bug invisible)**

In `handleCreateCredential` (line 641-644):
```javascript
await API.setExpiryForCredential(createExpiryCred, data.expiryDate);
} catch (expErr) {
    console.error('[EXPIRY][CREATE] failed:', expErr.message);
}
// ← No user-facing error. Expiry is silently lost.
```

In `handleUpdateCredential` (line 710):
```javascript
} catch (expErr) {
    console.warn('[EXPIRY][UPDATE] failed (non-fatal):', expErr.message);
}
```

**Impact:** The credential is created successfully. User sees "Credential Created — ACLs applied successfully." The expiry silently fails. On page reload, `loadCredentials()` fetches fresh from Splunk + KVStore. Expiry is missing. User has no idea what happened.

Tags have the same pattern.

---

## Actual root cause chain

```
ensureCollection creates collection
→ No delay for initialization
→ POST to KVStore data fails (500 or timeout)
→ Error propagates to handleCreateCredential
→ try/catch swallows it silently
→ Credential created without expiry
→ User sees no error
```

The `jsonBody: true` issue is a red herring. The real issue is the **initialization race** combined with **silent error swallowing**.

---

## Proposed fixes

### Fix 1: Wait for collection readiness after creation

In `ensureCollection`, after POSTing to create the collection, poll until it's ready:

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
                // Wait for the collection to be ready before returning
                await waitForCollectionReady(name);
                return true;
            } catch (createErr) {
                if (createErr.status === 409) {
                    return true; // Another request created it
                }
                throw createErr;
            }
        }
        throw e;
    }
}

async function waitForCollectionReady(name, maxAttempts = 5, intervalMs = 200) {
    for (var i = 0; i < maxAttempts; i++) {
        try {
            var configUrl = KVSTORE_CONFIG + '/' + name;
            var config = await splunkdRequest(configUrl, { method: 'GET' });
            var state = config && config.entry ? config.entry[0].content.state : null;
            if (state === 'creaded') {
                return true;
            }
        } catch (e) {
            // Collection not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error('Collection ' + name + ' did not become ready in time');
}
```

### Fix 2: Retry in `setExpiryForCredential`

Add a retry loop with exponential backoff:

```javascript
async function setExpiryForCredential(credential, expiryDate) {
    await ensureExpiryCollection();
    var key = tagCredKey(credential);
    var body = { _key: key, expiry_date: expiryDate || '' };

    for (var attempt = 0; attempt < 3; attempt++) {
        try {
            await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION, {
                method: 'POST',
                body: body,
                jsonBody: true,
            });
            break; // Success
        } catch (e) {
            if (e.status === 409) {
                // Key exists — update via POST with key
                await splunkdRequest(KVSTORE_DATA + '/' + EXPIRY_COLLECTION + '/' + encodeURIComponent(key), {
                    method: 'POST',
                    body: body,
                    jsonBody: true,
                });
                break; // Success
            }
            if (attempt < 2 && (e.status === 500 || e.status === 503)) {
                // Retry on transient errors (collection not ready, etc.)
                await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, attempt)));
                continue;
            }
            throw e;
        }
    }
    console.log('[EXPIRY][SAVE] key:', key, 'expiry_date:', expiryDate || '(cleared)');
}
```

### Fix 3: Bubble up errors to the user

In `handleCreateCredential`, surface the expiry error:

```javascript
try {
    await API.setExpiryForCredential(createExpiryCred, data.expiryDate);
} catch (expErr) {
    console.error('[EXPIRY][CREATE] failed:', expErr.message);
    showWarning('Expiry Not Set', [
        `Credential was created, but the expiry date could not be saved.`,
        `Error: ${getErrorMessage(expErr)}`,
    ]);
    // Still proceed — credential is created, just without expiry
}
```

Same pattern for `handleUpdateCredential` and tag operations.

### Fix 4: Prevent concurrent `ensureCollection` calls

Use a promise map to deduplicate in-flight collection creation requests:

```javascript
var collectionCreationPromises = {};

async function ensureCollection(name) {
    var configUrl = KVSTORE_CONFIG + '/' + name;
    try {
        await splunkdRequest(configUrl, { method: 'GET' });
        return true;
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

        var createPromise = (async () => {
            try {
                await splunkdRequest(KVSTORE_CONFIG, {
                    method: 'POST',
                    body: { name: name },
                });
                await waitForCollectionReady(name);
            } catch (createErr) {
                if (createErr.status === 409) {
                    return; // Someone else created it
                }
                throw createErr;
            }
        })();

        collectionCreationPromises[name] = createPromise;
        await createPromise;
        delete collectionCreationPromises[name];
        return true;
    }
}
```

---

## Priority

1. **Fix 1** (waitForCollectionReady) — prevents the root cause
2. **Fix 4** (deduplicate in-flight requests) — prevents concurrent race
3. **Fix 2** (retry logic) — adds resilience for transient failures
4. **Fix 3** (surface errors to user) — makes failures visible

Fix 1 + 4 together eliminate the race. Fix 2 adds resilience. Fix 3 prevents silent data loss from going unnoticed.
