# Tag Feature — Why It's Not Working

## TL;DR

**Two critical bugs, both rooted in the KVStore collection schema.** The code creates collections without declaring `_key` as a field. Depending on Splunk version, this either silently auto-generates a GUID (Splunk 8.2+) or rejects the insert entirely (older). In **every case, tag data is permanently lost** — saves appear to succeed, but the stored documents use keys the code can never look up.

---

## Bug #1 (Critical): `_key` Not Declared in Schema

### The Schema

```javascript
// api.js L2068-2073
async function ensureTagCollections() {
    await ensureCollection(TAGS_COLLECTION, [
        { name: 'tags', type: 'string' },    // ← _key is MISSING
    ]);
    await ensureCollection(TAG_DEFS_COLLECTION, [
        { name: 'color', type: 'string' },   // ← _key is MISSING
    ]);
}
```

The collections are created with only `tags` and `color` fields. **`_key` is not declared.**

### Why This Kills the Feature

`_key` is the Splunk KVStore primary key — it's the mechanism by which documents are identified, looked up, updated, and deleted. From the [Splunk REST API docs](https://dev.splunk.com/enterprise/docs/developapps/manageknowledge/kvstore):

> All collections must have a field named `_key` with the data type `string`. If this field is not specified, the field `_key` is automatically created.

When `_key` is **auto-created** (not explicitly declared), Splunk auto-generates a **UUID** for every insert. You **cannot control** the value.

When `_key` is **explicitly declared** in the schema, you **can set custom values** for `_key` during insert, and look up documents by that exact key.

### What Happens in Practice

**The save path** (`setTagsForCredential`):
```javascript
// api.js L2129-2134
await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION, {
    method: 'POST',
    body: {
        _key: key,              // ← custom key like "prod|api-user|search|admin|app"
        tags: JSON.stringify(cleanTags),
    },
});
```

Because `_key` was not declared in the schema, Splunk **ignores the custom `_key` value** and auto-generates a UUID. The document IS created, but with a GUID like `a1b2c3d4-e5f6-...`. **No error is thrown** — the POST returns 200/201. The code logs `[TAGS][SAVE] tags saved successfully`.

**The load path** (`getTagsForCredential`):
```javascript
// api.js L2157-2165
var key = tagCredKey(credential);  // → "prod|api-user|search|admin|app"
var data = await splunkdRequest(KVSTORE_BASE + '/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
    method: 'GET',
});
```

The code looks up by the **custom key** `"prod|api-user|search|admin|app"`. The document was stored under a **UUID**. **404 — document not found.** Returns `[]`.

**`getAllTagsData`** (batch enrichment):
```javascript
// api.js L2207-2215
(data.items || []).forEach(function(doc) {
    result[doc._key] = JSON.parse(doc.tags);  // ← doc._key is a GUID, NOT our cred key
});
```

This fetches all documents. The keys are GUIDs. When `loadCredentials` does `allTags[credKey]` with the credential's computed key, there's no match. **All tags return empty.**

### User Experience

```
User types "production" → presses Enter → saves credential
  ↓
POST to KVStore → Splunk creates doc with _key = "uuid-a1b2c3d4" → 201 OK
  ↓
Console: "[TAGS][SAVE] tags saved successfully ['production']"
  ↓
User refreshes page
  ↓
GET /collections/credential_tags/prod|api-user|search|admin|app → 404
  ↓
User sees zero tags. Tags are gone forever.
```

### Fix

Add `_key` to the schema:
```javascript
await ensureCollection(TAGS_COLLECTION, [
    { name: '_key', type: 'string' },   // ← THIS IS REQUIRED
    { name: 'tags', type: 'string' },
]);
await ensureCollection(TAG_DEFS_COLLECTION, [
    { name: '_key', type: 'string' },   // ← THIS IS REQUIRED
    { name: 'color', type: 'string' },
]);
```

---

## Bug #2 (Medium): `tagColorMap` Key Mismatch

### The Bug

```javascript
// api.js L2189-2195 — getAllTagDefinitions returns this shape:
return (data.items || []).map(function(doc) {
    return { tag_name: doc._key, color: doc.color };
});
// Object shape: { tag_name: "production", color: "#3b82f6" }
```

```javascript
// bundle.jsx L483 — but this code accesses the WRONG property:
tagDefs.forEach(function(d) { tagColorMap[d._key] = d.color; });
//                                        ^^^^^^
// d._key is undefined! Should be d.tag_name
```

### Impact

`tagColorMap[undefined] = "#3b82f6"` for every tag definition. All tag color lookups fall through to `API.hashToColor(t)`, which generates a consistent color from the tag name hash anyway.

**Tags display correctly** — the fallback `hashToColor` produces the same color as `tagColorMap` would have. This is cosmetic, not functional. But it means tag definition colors are never actually used.

### Fix

```javascript
tagDefs.forEach(function(d) { tagColorMap[d.tag_name] = d.color; });
```

---

## Bug #3 (Medium): `ensureCollection` Error Masking

### The Bug

```javascript
// api.js L2013-2029
try {
    await splunkdRequest(schemaUrl, { method: 'GET' });
    exists = true;
} catch (e) {
    if (e.status !== 404) {
        // Non-404 error — falls back to document list check
        try {
            var listResult = await splunkdRequest(KVSTORE_BASE + '/' + name, { method: 'GET' });
            exists = true;
        } catch (listErr) {
            if (listErr.status === 404) {
                exists = false;
            } else {
                // Non-404 on BOTH checks → exists = true (WRONG!)
                exists = true;  // ← Collection doesn't exist, but code thinks it does
            }
        }
    }
}

if (exists) return true;  // ← Returns early, never creates collection
```

If both the schema check AND the document list check throw non-404 errors (500, 503, network error), the code sets `exists = true` and returns without creating the collection. The collection never gets created, and no one knows.

### Impact

Only triggers if KVStore itself is unavailable (e.g., KV Store service not running). In that case, collection creation is silently skipped, document inserts fail with non-404 errors, and the errors are caught by callers as tag save failures.

### Fix

Return `false` or throw when both checks fail with non-404:
```javascript
} catch (listErr) {
    if (listErr.status === 404) {
        exists = false;
    } else {
        // KVStore itself may be unavailable — don't lie
        exists = false;  // Let downstream handle the error
    }
}
```

---

## Summary of All Issues

| Bug | Severity | Impact | Root Cause |
|-----|----------|--------|-----------|
| `_key` not in schema | **CRITICAL** | Tags silently lost — saves succeed, loads return empty | Collection schema missing `_key:string` declaration |
| `tagColorMap[d._key]` | Low | Tag colors use fallback (functionally identical) | Property name mismatch (`_key` vs `tag_name`) |
| `ensureCollection` masking | Medium | Collection creation skipped on non-404 errors | Logic treats non-404 errors as "collection exists" |
| Silent save failures | Medium | User sees no feedback when tags fail | `handleCreateCredential` catches tag errors, logs only |
| No KVStore availability check | Low | Feature crashes on first use if KVStore unavailable | No pre-flight check before lazy collection creation |

---

## The Fix (Prioritized)

1. **Add `_key` to collection schemas** — this is the ONLY way custom `_key` values work in Splunk KVStore
2. **Fix `tagColorMap` key** — cosmetic but wrong
3. **Fix `ensureCollection` error handling** — don't mask non-404 errors
4. **Add user feedback** — show toast when tag save fails
5. **Add KVStore availability check** — disable tag UI if KVStore not available
