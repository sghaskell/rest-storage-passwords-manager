# Bulk Edit Tag & Expiry Fixes

**Date:** 2026-05-29
**Module:** bundle.jsx, Modal.jsx (BulkEditModal)
**Tags:** bulk-edit, tags, expiry, kvstore

## Bugs Fixed

### BUG 1: "Edit Selected (1)" doesn't pre-populate expiry or tags
- **File:** `bundle.jsx` (line ~1258)
- **Problem:** When 1 credential selected, `setEditingCredential` only copied `name`, `realm`, `app`, `owner`, `sharing`, `aclRead`, `aclWrite` — missing `expiryDate`, `tags`, `namespaceOwner`, `rotationStatus`
- **Impact:** Modal opened empty for expiry and tags even though credential has them
- **Fix:** Pass the full `selectedRows[0]` object instead of a partial copy

### BUG 2: Bulk edit tag merge uses stale credential objects
- **File:** `bundle.jsx` (handleBulkEdit)
- **Problem:** Tags processed after `loadCredentials()` but used original `updates[]` objects (pre-ACL-change). If owner/sharing changed, the credential key is wrong
- **Fix:** Look up the reloaded credential by matching the new credential key, then merge existing tags with new tags

### BUG 3: Bulk edit tag merge was a replace, not a merge
- **File:** `bundle.jsx` (handleBulkEdit) + Modal.jsx (BulkEditModal)
- **Problem:** `setTagsForCredential(c, c._bulkTags)` replaced ALL tags. The modal says "Tags are ADDED" but the code replaced them
- **Fix:** In handleBulkEdit, read existing tags from the reloaded credential, then merge with `_bulkTags` before calling `setTagsForCredential`

### BUG 4: Bulk edit has no expiry date support
- **File:** Modal.jsx (BulkEditModal) + bundle.jsx (handleBulkEdit)
- **Problem:** Bulk edit modal had no expiry date field
- **Fix:** Added "Expiry Date" checkbox + date input to BulkEditModal. Added `_bulkExpiry` field processing in handleBulkEdit — calls `setExpiryForCredential` or `deleteExpiryForCredential`

## Changes Summary

**bundle.jsx:**
- `setEditingCredential(selectedRows[0])` instead of partial copy
- Tag merge: look up reloaded credential by key, read existing tags, merge before write
- Added expiry date processing: `setExpiryForCredential` / `deleteExpiryForCredential` for `_bulkExpiry`

**Modal.jsx (BulkEditModal):**
- Added `applyExpiry` / `expiryDate` state
- Added "Expiry Date" checkbox + date input UI
- Updated `canApply` validation to include expiry
- Added `_bulkExpiry` to the update object passed to handleBulkEdit
