# Plan: Tag Management Dashboard + Bulk Tag Operations

## Goal

Build a tag management dashboard and bulk tag operations so admins can:
- Create, rename, color, and delete tag definitions
- See usage counts per tag
- Bulk-add or bulk-remove tags from selected credentials

## Current state

**Tag storage:**
- KVStore collection `tags` — one entry per credential, value is an array of tag names
- KVStore collection `tag_definitions` — one entry per tag definition with `tag_name` and `color`
- Tags are assigned per-credential via `api.js::setTagsForCredential` / `getTagsForCredential`
- `CredentialForm.jsx` shows tag pills with autocomplete from existing definitions (max 5 tags)

**What's missing:**
- No UI to manage tag definitions (create/rename/delete/color)
- No bulk tag operations (add/remove tags across selected credentials)
- No tag usage counts or orphan tag cleanup

## Component: `TagManagementDashboard.jsx`

A new component (pattern: like `RoleAccessDashboard.jsx` — table + stats + filters).

### Tag Definition List (table view)

Columns:
| Name | Color | Usage | Actions |
|------|-------|-------|---------|
| `production` | 🔴 | 42 creds | Rename · Color · Delete |
| `api-key` | 🔵 | 17 creds | Rename · Color · Delete |

- **Color swatch**: 16px circle with tag color, clickable to open color picker
- **Usage count**: how many credentials have this tag (queried from `tags` KVStore collection)
- **Actions** column: rename (inline or modal), color picker, delete with confirmation

### Create Tag

Row at the top of the table:
- Tag name input (validates: lowercase alphanumeric + hyphens + underscores, max 50 chars)
- Color picker (default: auto via `hashToColor`)
- "Create" button

### Rename Tag

- Inline edit: click "Rename" → input appears in-place
- API: POST to `tag_definitions` collection with old `tag_name` in URL and new `tag_name` in body
- **Cascade**: rename the tag in ALL credential entries in the `tags` collection

### Delete Tag

- Click "Delete" → confirmation modal: "Delete tag 'X'? This removes it from all N credentials."
- API: DELETE tag definition + cascade-remove from all `tags` collection entries

### Tag Colors

- Use existing `api.js::hashToColor(tagName)` as default
- Allow override via native `<input type="color">`
- Store chosen color in `tag_definitions` collection

## Component: `BulkTagModal.jsx`

A modal for bulk tag operations. Two modes: **Add** and **Remove**.

### Add Mode

Triggered from credential table toolbar: "Add Tag" button (only visible when rows are selected).

UI:
- "Add to N selected credential(s)" header
- Tag selector: multi-select dropdown of existing tag definitions
- "Or create new:" text input + color picker + "Create & Add" button
- "Apply" button → progress bar → results summary

API: For each selected credential, read existing tags, append new tags (deduplicated), write back via `setTagsForCredential`.

### Remove Mode

Triggered from credential table toolbar: "Remove Tag" button.

UI:
- "Remove from N selected credential(s)" header
- Tag selector: multi-select dropdown showing only tags that exist on at least one selected credential
- "Apply" button → progress bar → results summary

API: For each selected credential, read existing tags, filter out selected tags, write back.

## Integration: `bundle.jsx`

### New toolbar buttons

When `selectedRows.length > 0` and `!loading`:
- "Add Tag" → opens `BulkTagModal` in add mode
- "Remove Tag" → opens `BulkTagModal` in remove mode

### New view/nav

Add a "Tags" tab or nav button (consistent with existing tabs: Credentials · Expiry · Roles · Audit).

Or: keep it as a modal/dashboard that replaces the current view, with a "← Back" button (like `ExpiryDashboard`).

## Integration: `api.js`

New functions:

```javascript
// Tag definition CRUD
async function createTagDefinition(tagName, color)
async function updateTagDefinition(oldName, newColor)  // color change
async function renameTagDefinition(oldName, newName)     // cascades to all credentials
async function deleteTagDefinition(tagName)              // cascades + removes definition
async function getAllTagDefinitions()                    // already exists
async function getTagUsageCount(tagName)                 // scan tags collection

// Bulk tag operations
async function bulkAddTags(credentials, tagNames, progressCallback)
async function bulkRemoveTags(credentials, tagNames, progressCallback)
```

## File changes

| File | Change |
|------|--------|
| `components/TagManagementDashboard.jsx` | **new** — tag definition CRUD table |
| `components/BulkTagModal.jsx` | **new** — add/remove tags modal |
| `api.js` | Add tag definition CRUD + bulk tag functions |
| `bundle.jsx` | Import new components, add toolbar buttons, add nav/tab |

## Implementation order

1. `api.js` — tag definition CRUD + bulk ops
2. `TagManagementDashboard.jsx` — standalone component
3. `BulkTagModal.jsx` — standalone component
4. `bundle.jsx` — wire up nav + toolbar buttons + modals
