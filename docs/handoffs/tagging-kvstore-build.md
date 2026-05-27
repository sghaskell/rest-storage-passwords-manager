# Handoff: Implement Credential Tagging — KVStore Build

**Status**: Ready to build
**Plan**: `docs/plans/2026-05-27-008-fix-credential-tagging-kvstore.md`

---

## Context

The tagging feature was committed using KVStore (`4d3fa08`) but local debugging switched the code to `configs/conf-tags` (uncommitted working directory changes). `conf-tags` is broken — it's Splunk's event classification config, not a data store. The uncommitted code needs to be reverted to KVStore with fixes for the original endpoint issues.

## What to Do

### 1. Replace Tagging Code in `appserver/static/react/api.js`

Find the `// ─── Credential Tagging (configs/conf-tags)` section and replace it entirely with the KVStore implementation from the plan.

**Key differences from the original (committed) KVStore code:**
- Base path: `/servicesNS/-/-/data/collections` (wildcard namespace, NOT `admin/search`)
- Delimiter: `|` in `tagCredKey()` (NOT `:` — avoids collision with realm strings like `prod;expiry_2026-06-01`)
- `ensureCollection` handles 403 gracefully (falls through to use collection)
- `setTagsForCredential` handles 409 by falling through to doc-level POST update
- `getAllTagDefinitions` returns `{ _key, color }` objects (KVStore `_key` field, not `tag_name`)
- `getTagsForCredential` parses `data.items[0]` (KVStore response format)
- `getAllTagsData` uses `data.items` array (KVStore list format)
- `deleteTagsForCredential` also handles 400 status code

### 2. Fix Key Consistency in `appserver/static/react/bundle.jsx`

**`loadCredentials()`** — replace inline key construction with `API.tagCredKey()`:

```javascript
// BEFORE (broken — inline key construction, : delimiter):
var credKey = (cred.realm || '') + ':' + (cred.name || '') + ':' + ...;

// AFTER:
var credKey = API.tagCredKey(cred);
```

Also update tag definition lookup:
```javascript
// BEFORE: tagColorMap[d.tag_name]
// AFTER:  tagColorMap[d._key]
```

**`handleCreateCredential()`** — use `API.tagCredKey()` and remove inline key logging:

```javascript
// BEFORE:
var createKey = (createTagCred.realm || '') + ':' + ...;
console.log('[TAGS][CREATE] saving tags', data.tags, 'key=', createKey);

// AFTER:
// Just call API.setTagsForCredential — it uses tagCredKey internally
await API.setTagsForCredential(createTagCred, data.tags);
```

**`handleUpdateCredential()`** — same pattern, use `API.tagCredKey()`.

### 3. Clean Up Stale Debug Test Files

Delete these untracked test files (all were created during debugging, not needed for production):

```
tests/test-tags-debug.spec.js
tests/test-tags-debug2.spec.js
tests/test-kvstore-debug.spec.js
tests/test-kvstore-direct.spec.js
tests/test-conf-tags-debug.spec.js
tests/test-tags-e2e.spec.js
tests/test-tags-end-to-end.spec.js
tests/test-direct-rest.spec.js
tests/test-splunkd-endpoints.spec.js
tests/test-splunkd-proxy.spec.js
tests/test-splunk-configs.spec.js
```

Also delete empty stubs:
```
default/credential_tags.conf
default/restconf
```

### 4. Verify `CredentialForm.jsx` Works with New API

No code changes needed, but verify:
- `getTagsForCredential` and `getAllTagDefinitions` still match the new API exports
- Tag input state (`currentTags`, `tagInput`, `allTagDefinitions`) is unchanged
- Form submit passes `tags: currentTags` correctly

### 5. Verify `CredentialTable.jsx` Works

No code changes needed, but verify:
- Tags column renders pills correctly
- Tag filter (`f.field === 'tag'`) still works
- `cred.tags` shape is `{ name, color }[]` — unchanged

### 6. Build & Test

```bash
# Build the React bundle
npm run build

# Run the app against your Splunk instance
# Test: add tags to a credential, verify they persist across reload
```

## Files Modified

| File | Lines | Change Summary |
|---|---|---|
| `appserver/static/react/api.js` | ~200 lines replaced | `conf-tags` → KVStore implementation |
| `appserver/static/react/bundle.jsx` | ~10 lines changed | Use `API.tagCredKey()` consistently |
| `tests/*.spec.js` | 11 files deleted | Remove debug test files |
| `default/*` | 2 files deleted | Remove empty stubs |

## Success Criteria

- Tags save to KVStore and persist across page reload
- Tag key construction is consistent between create, update, and load
- KVStore unavailable → graceful warning (no crash)
- No references to `conf-tags` remain in codebase
- All debug test files removed

## Risk

- KVStore may still fail if Splunk instance doesn't have KVStore app installed
- If that happens, the agent should log the exact error response and escalate — don't try another workaround
- The `|` delimiter change means existing tag entries (if any exist) won't match — this is acceptable since tags don't persist across app restarts anyway (KVStore was never working)

---

**Reference plan**: `docs/plans/2026-05-27-008-fix-credential-tagging-kvstore.md`
**Original commit**: `4d3fa08` (feat: credential tagging with kvstore)
**Current state**: Uncommitted `conf-tags` code in working directory
