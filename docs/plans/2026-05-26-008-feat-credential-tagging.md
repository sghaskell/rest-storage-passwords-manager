---
title: "feat: Credential Tagging"
type: feat
status: draft
date: 2026-05-26
origin: "feature request — flexible metadata tags on credentials via Splunk kvstore"
---

# feat: Credential Tagging

## Summary

Add flexible metadata tags to credentials via Splunk kvstore collections. Tags appear as colored pills in the table, support filtering, autocomplete, and bulk operations.

---

## Problem Frame

Credentials grow to hundreds or thousands. Realm alone is insufficient for categorization (e.g., "prod" realm doesn't tell you it's "web-tier" or "payment-related"). Tags provide flexible, user-defined metadata without modifying the realm format.

---

## Requirements

- **R1.** Two kvstore collections: `credential_tags` (cred→tags mapping) and `tag_definitions` (tag→color)
- **R2.** 1-5 tags per credential, max 50 chars each, case-insensitive, alphanumeric + hyphens + underscores
- **R3.** Tag input in `CredentialForm.jsx`: free-text with Enter-to-add, autocomplete from existing tags
- **R4.** Tags column in `CredentialTable.jsx`: colored pills, clickable to filter by tag
- **R5.** Tag CRUD: `setTagsForCredential()`, `getTagsForCredential()`, `removeTagsForCredential()`, `getAllTagsData()`
- **R6.** Bulk tag operations on selected rows: add/remove tags via bulk modal
- **R7.** Tags persist across edits — cleaned up on credential delete
- **R8.** Auto-assign colors based on tag name hash (consistent across sessions)
- **R9.** Tag Definitions modal: rename, delete, manage colors for all tags

---

## Scope Boundaries

- Tags are stored in kvstore only — NOT embedded in credential data (realm format DO NOT BREAK)
- No nested tags or tag hierarchies
- No tag inheritance or tag-based ACL rules
- Tag names are free-form — no predefined taxonomy
- kvstore collections created lazily on first use

---

## Context & Research

### Existing Infrastructure

| Component | Location | Detail |
|---|---|---|
| `splunkdRequest(path, options)` | `api.js` ~L109 | Generic REST proxy — handles CSRF, form encoding, JSON/XML responses |
| Credential CRUD | `api.js` | `createCredential()`, `updateCredential()`, `deleteCredential()` |
| `CredentialForm.jsx` | `components/` | Form modal — field layout uses `gridRow()` and `formField()` helpers |
| `CredentialTable.jsx` | `components/` | Table with columns, chip filters, row selection, sorting |
| `Chip` component | `@splunk/react-ui/Chip` | Already used for filter pills in table — reusable for tags |
| `CredentialTable` columns | `CredentialTable.jsx` | `COLUMNS` array — `tags` column would be added here |
| Bulk operations | `bundle.jsx` | `BulkEditModal` in `Modal.jsx` — pattern for bulk actions |

### Splunk kvstore API

**Collections endpoint:** `/servicesNS/admin/search/data/collections/`

| Operation | Method | Endpoint | Body |
|---|---|---|---|
| Create collection | POST | `/servicesNS/admin/search/data/collections/` | `name=collection_name&fields=field1:string,field2:string` |
| List collections | GET | `/servicesNS/admin/search/data/collections/` | — |
| Get collection schema | GET | `/servicesNS/admin/search/data/collections/collection_name` | — |
| Insert document | POST | `/servicesNS/admin/search/data/collections/collection_name` | `field1=value1&field2=value2` |
| Get documents | GET | `/servicesNS/admin/search/data/collections/collection_name` | — |
| Update document | POST | `/servicesNS/admin/search/data/collections/collection_name/{_key}` | `field=value` |
| Delete document | DELETE | `/servicesNS/admin/search/data/collections/collection_name/{_key}` | — |

**Note:** kvstore documents use `_key` as the primary key. For our use case, `_key` = unique credential identifier.

### Tag Color Generation

Use a simple hash function to generate consistent colors from tag names:

```javascript
function hashToColor(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var h = Math.abs(hash) % 360;
    // Pick from a fixed palette to ensure readable colors
    var palette = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
        '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
        '#e11d48', '#84cc16', '#a855f7', '#0ea5e9', '#d946ef',
    ];
    return palette[Math.abs(hash) % palette.length];
}
```

---

## Implementation Plan

### Phase 1: kvstore Collection Management (api.js)

```javascript
// Collection names — constant so all callers reference the same names
const TAGS_COLLECTION = 'credential_tags';
const TAG_DEFS_COLLECTION = 'tag_definitions';

// ─── Collection initialization ───────────────────────────────────────────

async function ensureCollection(name, fields) {
    try {
        await splunkdRequest('/servicesNS/admin/search/data/collections/' + name, { method: 'GET' });
        return true; // exists
    } catch (e) {
        if (e.status === 404) {
            // Create collection
            var fieldStr = fields.map(function(f) { return f.name + ':' + f.type; }).join(',');
            try {
                await splunkdRequest('/servicesNS/admin/search/data/collections', {
                    method: 'POST',
                    body: { name: name, fields: fieldStr },
                });
                return true;
            } catch (createErr) {
                if (createErr.status === 409) return true; // already created by race
                throw createErr;
            }
        }
        throw e;
    }
}

async function ensureTagCollections() {
    await ensureCollection(TAGS_COLLECTION, [
        { name: 'cred_key', type: 'string' },  // unique cred identifier
        { name: 'tags', type: 'string' },       // JSON array of tag strings
    ]);
    await ensureCollection(TAG_DEFS_COLLECTION, [
        { name: 'tag_name', type: 'string' },    // tag name (lowercase)
        { name: 'color', type: 'string' },        // hex color code
    ]);
}

// ─── Tag CRUD operations ─────────────────────────────────────────────────

/**
 * Unique key for a credential — matches credKey() pattern in bundle.jsx but
 * uses the stanzaKey format for kvstore compatibility (no special chars in key).
 */
function tagCredKey(cred) {
    return (cred.realm || '') + ':' + (cred.name || '') + ':' +
           (cred.app || 'search') + ':' +
           (cred.namespaceOwner || cred.owner || 'nobody') + ':' +
           (cred.sharing || 'app');
}

/**
 * Set tags for a credential (replaces all existing tags).
 * @param {Object} credential - Credential object
 * @param {string[]} tags - Array of tag strings
 */
async function setTagsForCredential(credential, tags) {
    await ensureTagCollections();
    var key = tagCredKey(credential);
    var cleanTags = tags
        .map(function(t) { return t.trim().toLowerCase(); })
        .filter(Boolean)
        .slice(0, 5); // max 5 tags

    // Ensure tag definitions exist
    for (var i = 0; i < cleanTags.length; i++) {
        var tag = cleanTags[i];
        // Validate: alphanumeric, hyphens, underscores only
        if (!/^[a-z0-9_-]{1,50}$/.test(tag)) {
            throw new Error('Invalid tag name: ' + tag + ' — use only letters, numbers, hyphens, underscores (max 50 chars)');
        }
    }

    // Upsert tag definitions for any new tags
    var existingDefs = await getAllTagDefinitions();
    for (var j = 0; j < cleanTags.length; j++) {
        var tag = cleanTags[j];
        if (!existingDefs.some(function(d) { return d.tag_name === tag; })) {
            await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAG_DEFS_COLLECTION, {
                method: 'POST',
                body: { tag_name: tag, color: hashToColor(tag), _key: tag },
            });
        }
    }

    // Upsert credential tags document
    await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
        method: 'POST',
        body: { cred_key: key, tags: JSON.stringify(cleanTags), _key: key },
    });

    return cleanTags;
}

/**
 * Get tags for a credential.
 * @param {Object} credential - Credential object
 * @returns {string[]} Array of tag strings
 */
async function getTagsForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        var data = await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'GET',
        });
        var entry = data.entry ? data.entry[0] : null;
        if (entry && entry.content && entry.content.tags) {
            return JSON.parse(entry.content.tags);
        }
    } catch (e) {
        if (e.status !== 404) throw e;
    }
    return [];
}

/**
 * Remove a specific tag from a credential.
 * @param {Object} credential - Credential object
 * @param {string} tagToRemove - Tag name to remove
 */
async function removeTagFromCredential(credential, tagToRemove) {
    var existing = await getTagsForCredential(credential);
    var updated = existing.filter(function(t) { return t !== tagToRemove.toLowerCase(); });
    if (updated.length === existing.length) return existing; // not found
    return setTagsForCredential(credential, updated);
}

/**
 * Get all tag definitions (tag→color mapping).
 * @returns {Array} Array of { tag_name, color } objects
 */
async function getAllTagDefinitions() {
    try {
        var data = await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAG_DEFS_COLLECTION + '?count=0', {
            method: 'GET',
        });
        return (data.entry || []).map(function(e) {
            return { tag_name: e.content.tag_name, color: e.content.color };
        });
    } catch (e) {
        if (e.status === 404) return [];
        throw e;
    }
}

/**
 * Get all tag-to-credential mappings (batch fetch for enrichment).
 * Returns Map: cred_key → [tags]
 * @returns {Object} Map of credential keys to tag arrays
 */
async function getAllTagsData() {
    try {
        var data = await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAGS_COLLECTION + '?count=0', {
            method: 'GET',
        });
        var result = {};
        (data.entry || []).forEach(function(e) {
            var content = e.content;
            if (content.tags) {
                result[content.cred_key] = JSON.parse(content.tags);
            }
        });
        return result;
    } catch (e) {
        if (e.status === 404) return {};
        throw e;
    }
}

/**
 * Delete tags for a credential (called on credential delete).
 * @param {Object} credential - Credential object
 */
async function deleteTagsForCredential(credential) {
    var key = tagCredKey(credential);
    try {
        await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAGS_COLLECTION + '/' + encodeURIComponent(key), {
            method: 'DELETE',
        });
    } catch (e) {
        if (e.status !== 404) throw e;
    }
}

/**
 * Delete a tag definition.
 * @param {string} tagName - Tag name to delete
 */
async function deleteTagDefinition(tagName) {
    await splunkdRequest('/servicesNS/admin/search/data/collections/' + TAG_DEFS_COLLECTION + '/' + encodeURIComponent(tagName), {
        method: 'DELETE',
    });
}

// Helper — hash tag name to consistent color
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
```

### Phase 2: Credential Enrichment (bundle.jsx)

**Enhance `loadCredentials()` to include tag data:**

```javascript
async function loadCredentials() {
    setData(prev => ({ ...prev, loading: true, error: null }));
    try {
        const fetched = await API.getAllCredentials();

        // Fetch all tag data in batch — one API call for all credentials
        const allTags = await API.getAllTagsData();
        const tagDefs = await API.getAllTagDefinitions();
        var tagColorMap = {};
        tagDefs.forEach(function(d) { tagColorMap[d.tag_name] = d.color; });

        var enriched = fetched.map(function(cred) {
            var expiryInfo = API.parseExpiryFromRealm(cred.realm || '');
            var rotationStatus = API.getRotationStatus(expiryInfo.expiryDate);
            var credKey = cred.stanzaKey + ':' + cred.app + ':' +
                          (cred.namespaceOwner || cred.owner || '') + ':' + cred.sharing;
            var tags = allTags[credKey] || [];

            // Enrich tags with color info
            var enrichedTags = tags.map(function(t) {
                return { name: t, color: tagColorMap[t] || API.hashToColor(t) };
            });

            return Object.assign({}, cred, {
                expiryDate: expiryInfo.expiryDate || '',
                rotationStatus: rotationStatus,
                rotationLabel: getRotationLabel(expiryInfo.expiryDate, rotationStatus),
                tags: enrichedTags,
            });
        });

        setData(prev => ({ ...prev, credentials: enriched }));
        API.clearDuplicateCache();
    } catch (err) {
        console.error('Error loading credentials:', err);
        setData(prev => ({ ...prev, error: getErrorMessage(err) }));
    } finally {
        setData(prev => ({ ...prev, loading: false }));
    }
}
```

### Phase 3: Tag Input in CredentialForm (components/CredentialForm.jsx)

**Add tag input section — between "Password Expiry" and "Action buttons":**

```javascript
// State additions:
const [currentTags, setCurrentTags] = React.useState([]);
const [tagInput, setTagInput] = React.useState('');
const [allTagDefinitions, setAllTagDefinitions] = React.useState([]);

// Load existing tags when credential changes:
React.useEffect(function() {
    if (credential) {
        async function loadTags() {
            var tags = await _API.getTagsForCredential(credential);
            setCurrentTags(tags);
        }
        loadTags();
    } else {
        setCurrentTags([]);
    }
}, [credential]);

// Load all tag definitions for autocomplete:
React.useEffect(function() {
    async function loadDefs() {
        var defs = await _API.getAllTagDefinitions();
        setAllTagDefinitions(defs);
    }
    loadDefs();
}, []);

// Tag input handler — Enter to add, autocomplete dropdown
function handleTagKeyDown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        var tag = tagInput.trim().toLowerCase();
        if (tag && /^[a-z0-9_-]{1,50}$/.test(tag) && currentTags.length < 5) {
            if (!currentTags.includes(tag)) {
                setCurrentTags(prev => [...prev, tag]);
            }
            setTagInput('');
        }
    }
    if (e.key === 'Backspace' && !tagInput) {
        setCurrentTags(prev => prev.slice(0, -1));
    }
}

function removeTag(tag) {
    setCurrentTags(prev => prev.filter(t => t !== tag));
}
```

**Render tag section:**

```javascript
// In form render — between expiry date picker and action buttons:
React.createElement('div', { style: { width: '100%' } },
    formField('Tags',
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },
            // Current tags as removable pills
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', minHeight: '28px', alignItems: 'center' } },
                currentTags.map(function(tag, i) {
                    var color = allTagDefinitions.find(function(d) { return d.tag_name === tag; })?.color || '#3b82f6';
                    return React.createElement('span', {
                        key: tag,
                        style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: color + '22',
                            color: color,
                            border: '1px solid ' + color + '40',
                        }
                    },
                        tag,
                        React.createElement('span', {
                            onClick: function() { removeTag(tag); },
                            style: { cursor: 'pointer', fontWeight: 'bold', marginLeft: '2px' },
                        }, '\u00d7')
                    );
                }),
                currentTags.length === 0 && React.createElement('span', { style: { fontSize: '11px', color: '#999' } },
                    'No tags — type and press Enter to add'
                )
            ),
            // Input + autocomplete
            React.createElement(Text, {
                value: tagInput,
                onChange: function(e, data) {
                    var val = data && typeof data.value === 'string' ? data.value : '';
                    setTagInput(val);
                },
                onKeyDown: handleTagKeyDown,
                placeholder: currentTags.length >= 5 ? 'Max 5 tags reached' : 'Type tag name, press Enter',
                disabled: currentTags.length >= 5,
            }),
            // Autocomplete suggestions
            tagInput && React.createElement('div', { style: { fontSize: '11px', color: '#666' } },
                'Suggestions: ' + allTagDefinitions
                    .filter(function(d) { return d.tag_name.indexOf(tagInput) !== -1 && !currentTags.includes(d.tag_name); })
                    .slice(0, 5)
                    .map(function(d) { return d.tag_name; })
                    .join(', ')
            )
        ),
        { helpText: 'Up to 5 tags per credential. Letters, numbers, hyphens, underscores only.' }
    )
),
```

**Save tags on form submit — add to `handleSubmit()`:**

```javascript
// In handleSubmit(), AFTER validation passes and BEFORE credential save:
if (onSave) {
    var formData = {
        username: username.trim(),
        password: password || null,
        realm: realm.trim(),
        expiryDate: expiryDate,
        app: app,
        owner: owner,
        readRoles: resolveRoles(readRolesArray),
        writeRoles: resolveRoles(writeRolesArray),
        sharing: sharing,
        tags: currentTags,  // NEW
    };
    onSave(formData);
}
```

**In bundle.jsx `handleCreateCredential` / `handleUpdateCredential` — save tags:**

```javascript
// After credential create/update succeeds:
if (data.tags && data.tags.length > 0) {
    try {
        await API.setTagsForCredential({
            name: data.username,
            realm: realmToSave,
            app: data.app,
            namespaceOwner: data.owner,
            sharing: data.sharing,
            stanzaKey: (data.realm || '') + ':' + data.username + ':',
        }, data.tags);
    } catch (tagErr) {
        console.warn('Failed to save tags (non-fatal):', tagErr.message);
        // Don't block — credential was created/updated successfully
    }
}
```

### Phase 4: Tags Column in CredentialTable (components/CredentialTable.jsx)

**Add `tags` column to `COLUMNS`:**

```javascript
var COLUMNS = [
    // ... existing columns ...
    { key: 'tags',     label: 'Tags',       sortable: false, fixed: false },
];
```

**Data cell builder for tags:**

```javascript
if (col.key === 'tags') {
    var tags = cred.tags || [];
    if (tags.length === 0) {
        return React.createElement(TableCell, null,
            React.createElement('span', {
                style: { fontSize: '11px', color: '#999', fontStyle: 'italic' },
            }, 'No tags')
        );
    }
    return React.createElement(TableCell, null,
        React.createElement('div', {
            style: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }
        },
            tags.map(function(tag, i) {
                return React.createElement('span', {
                    key: i,
                    onClick: function() { handleAddFilter('tag', tag.name); },
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: tag.color + '22',
                        color: tag.color,
                        border: '1px solid ' + tag.color + '40',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                    }
                }, tag.name);
            })
        )
    );
}
```

**Filter support — add `tag` field to `FILTER_FIELDS` and `COLUMN_TO_FILTER`:**

```javascript
var FILTER_FIELDS = [
    // ... existing ...
    { key: 'tag', label: 'Tag' },
];

// In filter logic (filteredCredentials useMemo):
if (f.field === 'tag') {
    var credTags = cred.tags ? cred.tags.map(function(t) { return t.name || t; }) : [];
    if (credTags.indexOf(val) === -1) return false;
}
```

### Phase 5: Bulk Tag Operations

**In `BulkEditModal` (components/Modal.jsx) — add tag operations:**

Add "Add Tags" and "Remove Tags" buttons to the bulk edit modal. These operate on selected rows via `setTagsForCredential()` for each credential.

```javascript
// In bundle.jsx, add bulk tag handler:
async function handleBulkAddTags(tagsToAdd) {
    var successMessages = [];
    var errorMessages = [];

    for (var i = 0; i < selectedRows.length; i++) {
        var cred = selectedRows[i];
        try {
            var existing = await API.getTagsForCredential(cred);
            var merged = existing.concat(tagsToAdd).filter(function(t, idx, arr) {
                return arr.indexOf(t) === idx; // dedupe
            }).slice(0, 5); // cap at 5
            await API.setTagsForCredential(cred, merged);
            successMessages.push('Updated ' + escapeHtml(cred.name));
        } catch (err) {
            errorMessages.push(escapeHtml(cred.name) + ': ' + err.message);
        }
    }

    await loadCredentials();
    // Show result modal
    if (errorMessages.length === 0) {
        showSuccess('Bulk Tag Update', successMessages);
    } else {
        showError('Bulk Tag Update — Partial', successMessages.concat(errorMessages));
    }
}
```

### Phase 6: Cleanup on Credential Delete

**In `handleDeleteCredential` and `handleBulkDeleteConfirm`:**

```javascript
// Before deleting credential:
await API.deleteTagsForCredential(selectedCredential);

// In bulk delete:
for (var k = 0; k < uniqueRows.length; k++) {
    await API.deleteTagsForCredential(uniqueRows[k]);
    // ... then delete credential ...
}
```

---

## Files to Modify

| File | Change |
|---|---|
| `api.js` | Tag CRUD functions (`setTagsForCredential`, `getTagsForCredential`, `removeTagFromCredential`, `getAllTagsData`, `getAllTagDefinitions`, `deleteTagsForCredential`, `deleteTagDefinition`, `ensureTagCollections`, `hashToColor`) |
| `api.js` | Export new functions in `module.exports` |
| `components/CredentialForm.jsx` | Tag input section with autocomplete, tag state management, save tags on submit |
| `components/CredentialTable.jsx` | `tags` column in `COLUMNS`, tag pills in data cell builder, tag filter in `FILTER_FIELDS` |
| `bundle.jsx` | Tag enrichment in `loadCredentials()`, tag cleanup on delete, bulk tag operations |
| `components/Modal.jsx` | Tag operations in `BulkEditModal` |

---

## Data Model

```javascript
// credential_tags collection (kvstore)
{
    _key: "prod:svc-api::search:nobody:app",
    cred_key: "prod:svc-api::search:nobody:app",
    tags: '["production","api","critical"]',  // JSON string array
}

// tag_definitions collection (kvstore)
{
    _key: "production",
    tag_name: "production",
    color: "#3b82f6",  // auto-assigned by hash
}

// Enriched credential shape (in memory, after loadCredentials)
{
    name: 'svc-api',
    realm: 'prod',
    tags: [
        { name: 'production', color: '#3b82f6' },
        { name: 'api', color: '#10b981' },
        { name: 'critical', color: '#ef4444' },
    ],
    // ... other fields ...
}

// Tag input state (CredentialForm)
{
    currentTags: ['production', 'api'],
    tagInput: 'cr',  // partial input for autocomplete
}
```

---

## Testing Plan

1. **Tag creation** — add 1-5 tags, verify they save to kvstore and reappear after reload
2. **Tag limit** — verify 6th tag is rejected (max 5)
3. **Tag validation** — verify special chars, >50 chars, empty strings are rejected
4. **Case insensitivity** — "Prod" and "prod" treated as same tag
5. **Autocomplete** — verify suggestions appear for partial matches
6. **Auto-color** — verify same tag name always gets same color across sessions
7. **Filter by tag** — click tag pill in table, verify filter applies correctly
8. **Bulk add tags** — select multiple credentials, add tag, verify all updated
9. **Credential delete cleanup** — delete credential, verify tag document removed
10. **Edit credential persistence** — edit ACLs on tagged credential, verify tags persist
11. **Copy credential** — copy a tagged credential, verify tags are NOT copied (new credential)
12. **kvstore collection creation** — first run creates collections, second run uses existing
13. **Race conditions** — two tabs adding same tag to same credential simultaneously

---

## Dependencies

- `splunkdRequest()` in `api.js` — reused for kvstore CRUD
- `CredentialForm.jsx` — form structure reused, tag section added
- `CredentialTable.jsx` — column system reused, tags column added
- `Modal.jsx` — `BulkEditModal` extended with tag operations
- Splunk admin permissions for kvstore collection creation
- No new npm deps — kvstore uses standard REST API via `splunkdRequest()`
