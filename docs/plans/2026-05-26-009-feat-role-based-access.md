---
title: "feat: Role-Based Access at Scale"
type: feat
status: draft
date: 2026-05-26
origin: "feature request — dashboard showing which roles have access to which credentials, with bulk assignment and least-privilege auditing"
---

# feat: Role-Based Access at Scale

## Summary

Add a "Role Access" dashboard showing which roles have read/write access to which credentials, with bulk role assignment, least-privilege auditing, and a role×credential matrix view.

---

## Problem Frame

As credential counts grow, admins lose visibility into who can access what. Credentials with `* (all)` read roles are security risks — anyone can read them. No audit trail shows which credentials are overly permissive. A dedicated role access view closes this gap.

---

## Requirements

- **R1.** Navigation tab in `bundle.jsx` — toggles between main table and "Role Access" view
- **R2.** Credentials table with read/write role columns, filterable by role
- **R3.** Least privilege audit: flag credentials with `readRoles = *` (open access) and admin-writable credentials
- **R4.** `getRolesWithCapabilities()` — fetches roles + their capabilities, flags `admin_all_objects`
- **R5.** `aggregateByRole()` — builds role→credentials map for matrix view
- **R6.** `setCredentialRoles()` / `bulkAssignRoles()` — bulk ACL updates via `_setAcl()`
- **R7.** Role matrix view toggle (roles × credentials grid with R/W indicators)
- **R8.** `BulkRoleAssignmentModal` — read/write role checkboxes, replace/add mode
- **R9.** Summary stats: total open-access credentials, admin-writable count, role distribution

---

## Scope Boundaries

- Read-only audit view — no ACL modifications from the dashboard itself (modals handle changes)
- No custom role creation (uses existing Splunk roles only)
- No role hierarchy visualization (e.g., "admin inherits power inherits user")
- Role matrix view limited to 50 roles × 200 credentials (performance cap)
- Realm format `baseRealm;expiry_YYYY-MM-DD` is unaffected

---

## Context & Research

### Existing Infrastructure

| Component | Location | Detail |
|---|---|---|
| `getRoles()` | `api.js` ~L743 | Fetches role list from `/servicesNS/-/-/authorization/roles/` — returns `['* (all)', ...roleNames]` |
| `_setAcl(aclPath, sharing, readRoles, writeRoles, owner)` | `api.js` ~L318 | Two-step ACL write for configs/conf-passwords (handles user-scoped bump-to-app) |
| `buildAclPath(stanzaKey, owner, app)` | `api.js` ~L223 | Builds ACL path: `/servicesNS/{owner}/{app}/configs/conf-passwords/credential:{stanzaKey}/acl` |
| `CredentialTable` columns | `CredentialTable.jsx` | Already has `aclRead` and `aclWrite` columns with pill chips and filter support |
| Bulk operations | `bundle.jsx` | `BulkEditModal` — pattern for bulk form + apply |
| `flattenConfigEntry()` | `api.js` ~L264 | Extracts `aclRead`/`aclWrite` from `perms.read`/`perms.write` as comma-separated strings |

### Splunk Roles API

**Endpoint:** `GET /servicesNS/-/-/authentication/roles/`

Returns all roles with their capabilities. Key fields:
- `name`: role name
- `capabilities`: array of capability strings
- `import_passwords`: bool — can import passwords
- `manage_passwords`: bool — can manage passwords

**Admin capability detection:** A role is "admin" level if it has `admin_all_objects` in its capabilities array.

**ACL endpoint for roles:** When setting ACL, use `POST /servicesNS/{owner}/{app}/configs/conf-passwords/{stanza}/acl` with body:
```
perms.read=read1,read2,read3
perms.write=write1,write2
sharing=app
owner=nobody
```

### Existing Role Column in Table

`CredentialTable.jsx` already renders `aclRead` and `aclWrite` columns with colored pills. Each pill is clickable to filter by that role. This infrastructure is reused — the Role Access view adds aggregation and matrix views on top.

---

## Implementation Plan

### Phase 1: Role Capabilities & Audit Helpers (api.js)

```javascript
// Cache for role capabilities — avoid re-fetching on every load
var _rolesCapabilitiesCache = null;
var _rolesCapabilitiesCacheTime = 0;
var ROLES_CACHE_TTL = 300000; // 5 min

/**
 * Fetch all roles with their capabilities.
 * Returns array of { name, capabilities: [], isAdmin: bool }
 * Cached for 5 minutes.
 */
async function getRolesWithCapabilities() {
    // Use cache if fresh
    if (_rolesCapabilitiesCache && (Date.now() - _rolesCapabilitiesCacheTime < ROLES_CACHE_TTL)) {
        return _rolesCapabilitiesCache;
    }

    try {
        var data = await splunkdRequest('/servicesNS/-/-/authorization/roles', { method: 'GET' });
        var roles = (data.entry || []).map(function(e) {
            var caps = e.content?.capabilities || [];
            var isAdmin = caps.indexOf('admin_all_objects') !== -1;
            return {
                name: e.name,
                capabilities: caps,
                isAdmin: isAdmin,
            };
        });
        _rolesCapabilitiesCache = roles;
        _rolesCapabilitiesCacheTime = Date.now();
        return roles;
    } catch (err) {
        console.warn('Failed to fetch roles with capabilities:', err.message);
        return [];
    }
}

/**
 * Clear the roles capabilities cache (call after role changes).
 */
function clearRolesCapabilitiesCache() {
    _rolesCapabilitiesCache = null;
    _rolesCapabilitiesCacheTime = 0;
}

/**
 * Aggregate credentials by role — builds role → credentials map.
 * @param {Array} credentials - Enriched credentials array
 * @param {Array} roleNames - Array of role names to check (from getRoles)
 * @returns {Object} { roleMap: { roleName: { read: [creds], write: [creds] } }, openAccessCount, adminWritableCount }
 */
function aggregateByRole(credentials, roleNames) {
    var roleMap = {};
    var openAccessCount = 0;
    var adminWritableCount = 0;

    // Initialize role map
    roleNames.forEach(function(r) {
        roleMap[r] = { read: [], write: [] };
    });

    credentials.forEach(function(cred) {
        var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
        var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);

        // Check for open access (wildcard read)
        if (readRoles.indexOf('*') !== -1 || readRoles.indexOf('* (all)') !== -1) {
            openAccessCount++;
        }

        // Check for admin-writable (any admin role can write)
        // This is checked at render time when capabilities are available
        // For now, flag if 'admin' is in write roles
        if (writeRoles.indexOf('admin') !== -1) {
            adminWritableCount++;
        }

        // Map each role to its credentials
        readRoles.forEach(function(r) {
            var normalized = r === '*' ? '* (all)' : r;
            if (roleMap[normalized]) {
                roleMap[normalized].read.push(cred);
            }
        });
        writeRoles.forEach(function(r) {
            var normalized = r === '*' ? '* (all)' : r;
            if (roleMap[normalized]) {
                roleMap[normalized].write.push(cred);
            }
        });
    });

    return {
        roleMap: roleMap,
        openAccessCount: openAccessCount,
        adminWritableCount: adminWritableCount,
    };
}

/**
 * Set roles for a credential (read and write).
 * @param {Object} credential - Credential object
 * @param {string[]} readRoles - Array of role names for read access
 * @param {string[]} writeRoles - Array of role names for write access
 */
async function setCredentialRoles(credential, readRoles, writeRoles) {
    var aclPath = buildAclPath(
        credential.stanzaKey || ((credential.realm || '') + ':' + (credential.name || '') + ':'),
        credential.namespaceOwner || credential.owner || 'nobody',
        credential.app || 'search'
    );
    var sharing = credential.sharing || 'app';
    var owner = credential.namespaceOwner || credential.owner || 'nobody';
    return _setAcl(aclPath, sharing, readRoles, writeRoles, owner);
}

/**
 * Bulk assign roles to multiple credentials.
 * @param {Array} credentials - Array of credential objects
 * @param {string[]} readRoles - Read roles to assign
 * @param {string[]} writeRoles - Write roles to assign
 * @param {string} mode - 'replace' (replace existing) or 'add' (add to existing)
 * @param {Function} onProgress - Optional progress callback(index, total)
 * @returns {Array} Results array: { credential, success, error }
 */
async function bulkAssignRoles(credentials, readRoles, writeRoles, mode, onProgress) {
    var results = [];
    for (var i = 0; i < credentials.length; i++) {
        var cred = credentials[i];
        if (onProgress) onProgress(i, credentials.length);

        try {
            var finalRead = readRoles;
            var finalWrite = writeRoles;

            if (mode === 'add') {
                // Merge with existing roles
                var existingRead = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
                var existingWrite = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
                finalRead = Array.from(new Set(existingRead.concat(readRoles)));
                finalWrite = Array.from(new Set(existingWrite.concat(writeRoles)));
            }

            await setCredentialRoles(cred, finalRead, finalWrite);
            results.push({ credential: cred, success: true, error: null });
        } catch (err) {
            results.push({ credential: cred, success: false, error: err });
        }
    }
    return results;
}

/**
 * Get admin-writable credentials — credentials where any admin role has write access.
 * @param {Array} credentials - Enriched credentials
 * @param {Array} adminRoles - Array of role names that have admin_all_objects
 * @returns {Array} Credentials writable by admin roles
 */
function getAdminWritableCredentials(credentials, adminRoles) {
    return credentials.filter(function(cred) {
        var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); });
        // Wildcard write means everyone (including admins) can write
        if (writeRoles.indexOf('*') !== -1 || writeRoles.indexOf('* (all)') !== -1) return true;
        // Check if any admin role is in write list
        return adminRoles.some(function(ar) { return writeRoles.indexOf(ar) !== -1; });
    });
}
```

### Phase 2: RoleAccessDashboard Component (new file)

**File:** `components/RoleAccessDashboard.jsx`

**Props:** `{ credentials, rolesWithCapabilities, onOpenBulkAssign, onViewCredential }`

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Role Access Dashboard                                                       │
│                                                                             │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│ │ Total Creds  │ │ Open Access  │ │ Admin-Writable│ │ Unique Roles│        │
│ │    142       │ │      23      │ │      15      │ │     12      │        │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                                             │
│ [Table View]  [Matrix View]                                                  │
│                                                                             │
│ Search: [________________]  Filter by role: [▼ All Roles]                   │
│ Show open access only: [checkbox]  Show admin-writable only: [checkbox]      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Username  │ Realm  │ Read Roles                    │ Write Roles │ Admin?  │
│───────────│────────│───────────────────────────────│─────────────│─────────│
│ svc-1     │ prod   │ [* (all)] (⚠ open)            │ [admin]     │  [✓]    │
│ api-key   │ dev    │ [power, user]                   │ [power]    │  [ ]    │
│ backup    │ prod   │ [admin, power]                  │ [admin]    │  [✓]    │
│ ...       │ ...    │ ...                             │ ...         │ ...    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Table sorting:** Default sort by open access (⚠ at top), then by credential name.

**Matrix view (toggle):**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Role Matrix (Roles × Credentials)                                           │
│                                                                             │
│              │ svc-1 │ api-key │ backup │ monitor │ ...                     │
│ ──────────── │───────│─────────│────────│─────────│───                      │
│ admin       │   R   │    -    │   RW   │    -    │ ...                     │
│ power       │   R   │   RW    │   R    │   RW    │ ...                     │
│ user        │   R   │   R     │    -   │   R     │ ...                     │
│ * (all)     │  ✓   │    -    │    -   │    -    │ ...                     │
│                                                                             │
│ Legend: R=Read, W=Write, RW=Both, ✓=Wildcard (open), -=No access            │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```javascript
function RoleAccessDashboard({
    credentials,
    rolesWithCapabilities,
    onOpenBulkAssign,
    onViewCredential,
}) {
    const [viewMode, setViewMode] = React.useState('table'); // 'table' | 'matrix'
    const [filterRole, setFilterRole] = React.useState('');
    const [showOpenAccess, setShowOpenAccess] = React.useState(false);
    const [showAdminWritable, setShowAdminWritable] = React.useState(false);

    // Compute audit data
    var adminRoleNames = rolesWithCapabilities
        .filter(function(r) { return r.isAdmin; })
        .map(function(r) { return r.name; });

    var allRoleNames = rolesWithCapabilities.map(function(r) { return r.name; });
    // Add '* (all)' sentinel
    if (!allRoleNames.some(function(r) { return r === '* (all)'; })) {
        allRoleNames.unshift('* (all)');
    }

    var aggregation = aggregateByRole(credentials, allRoleNames);

    // Filtered credentials
    var filteredCreds = React.useMemo(function() {
        return credentials.filter(function(cred) {
            var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
            var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);

            // Role filter — show credentials that have the selected role
            if (filterRole) {
                var hasRole = readRoles.indexOf(filterRole) !== -1 || writeRoles.indexOf(filterRole) !== -1;
                if (!hasRole) return false;
            }

            // Open access filter
            if (showOpenAccess) {
                var isOpenAccess = readRoles.indexOf('*') !== -1 || readRoles.indexOf('* (all)') !== -1;
                if (!isOpenAccess) return false;
            }

            // Admin-writable filter
            if (showAdminWritable) {
                var isAdminWritable = writeRoles.indexOf('admin') !== -1 ||
                    writeRoles.indexOf('*') !== -1 || writeRoles.indexOf('* (all)') !== -1;
                if (!isAdminWritable) return false;
            }

            return true;
        });
    }, [credentials, filterRole, showOpenAccess, showAdminWritable]);

    // Sort: open access credentials first, then by name
    filteredCreds.sort(function(a, b) {
        var aOpen = hasOpenAccess(a) ? 0 : 1;
        var bOpen = hasOpenAccess(b) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return (a.name || '').localeCompare(b.name || '');
    });
}
```

### Phase 3: Bulk Role Assignment Modal (new file)

**File:** `components/BulkRoleAssignmentModal.jsx`

**Props:** `{ selectedRows, availableRoles, isOpen, onClose, onApply }`

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│ Bulk Role Assignment                                       │
│                                                              │
│ Selected: 15 credentials                                      │
│                                                              │
│ Mode: (○) Replace existing roles   (●) Add to existing      │
│                                                              │
│ Read Roles:                                                    │
│   [▼ MultiSelect — search roles]                              │
│   [Select All]  [Reset]                                        │
│                                                              │
│ Write Roles:                                                   │
│   [▼ MultiSelect — search roles]                              │
│   [Select All]  [Reset]                                        │
│                                                              │
│ ──────────────────────────────────────────────────────────── │
│                                                              │
│ ⚠ Warning: Assigning '*' grants access to ALL roles.        │
│    This is equivalent to "anyone with this role" access.     │
│                                                              │
│  [Cancel]  [Apply to 15 Credentials]                         │
└──────────────────────────────────────────────────────────────┘
```

**Implementation:**

```javascript
function BulkRoleAssignmentModal({
    selectedRows,
    availableRoles,
    isOpen,
    onClose,
    onApply,
}) {
    const [mode, setMode] = React.useState('replace'); // 'replace' | 'add'
    const [readRoles, setReadRoles] = React.useState([]);
    const [writeRoles, setWriteRoles] = React.useState([]);
    const [applying, setApplying] = React.useState(false);

    async function handleApply() {
        if (!readRoles.length || !writeRoles.length) return;
        setApplying(true);
        try {
            var results = await API.bulkAssignRoles(
                selectedRows,
                resolveRoles(readRoles),
                resolveRoles(writeRoles),
                mode,
                function(current, total) { /* progress feedback */ }
            );
            onApply(results);
        } catch (err) {
            console.error('Bulk role assignment failed:', err);
        } finally {
            setApplying(false);
        }
    }
}
```

### Phase 4: Navigation Integration (bundle.jsx)

```javascript
// Add to modals state:
const [modals, setModals] = React.useState({
    // ... existing ...
    roleAccess: false,
    bulkRoleAssignment: false,
});

// Add view mode state:
const [viewMode, setViewMode] = React.useState('table'); // 'table' | 'role-access'

// Navigation toggle — add to existing Expiry Dashboard navigation or as separate tab:
var navigation = React.createElement('div', {
    style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }
},
    React.createElement(Button, {
        onClick: function() { setViewMode('table'); },
        appearance: viewMode === 'table' ? 'primary' : 'subtle',
        children: 'Credentials'
    }),
    React.createElement(Button, {
        onClick: function() { setViewMode('role-access'); },
        appearance: viewMode === 'role-access' ? 'primary' : 'subtle',
        children: 'Role Access'
    }),
    // Expiry Dashboard button from Plan #006 (co-locate tabs)
);
```

**Role capabilities fetch — in existing `fetchReferenceData()`:**

```javascript
async function fetchReferenceData() {
    try {
        const [appsResult, usersResult, rolesResult, rolesCapabilitiesResult] = await Promise.allSettled([
            API.getApps(),
            API.getUsers(),
            API.getRoles(),
            API.getRolesWithCapabilities(),
        ]);
        // ... existing setRefData ...
        if (rolesCapabilitiesResult.status === 'fulfilled') {
            setRefData(prev => ({ ...prev, rolesWithCapabilities: rolesCapabilitiesResult.value }));
        }
    } catch (err) {
        console.warn('Failed to load reference data:', err.message);
    }
}
```

**Render role access dashboard:**

```javascript
{viewMode === 'role-access' &&
    React.createElement(RoleAccessDashboard, {
        credentials: credentials,
        rolesWithCapabilities: refData.rolesWithCapabilities,
        onOpenBulkAssign: function(creds) {
            setSelectedRows(creds);
            setModals(prev => ({ ...prev, bulkRoleAssignment: true }));
        },
        onViewCredential: function(cred) {
            setViewMode('table');
            setFilterText(cred.name);
        },
    })
}

// Bulk role assignment modal
modals.bulkRoleAssignment && React.createElement(BulkRoleAssignmentModal, {
    isOpen: modals.bulkRoleAssignment,
    selectedRows: selectedRows,
    availableRoles: refData.roles,
    onClose: function() {
        setModals(prev => ({ ...prev, bulkRoleAssignment: false }));
        handleDeselectAll();
    },
    onApply: function(results) {
        setModals(prev => ({ ...prev, bulkRoleAssignment: false }));
        handleDeselectAll();
        loadCredentials(); // reload to get updated ACLs
        var successCount = results.filter(function(r) { return r.success; }).length;
        var failCount = results.length - successCount;
        if (failCount === 0) {
            showSuccess('Roles Updated', ['Updated ' + successCount + ' credential(s)']);
        } else {
            showError('Partial Update', ['Updated ' + successCount + ', failed ' + failCount]);
        }
    },
})
```

---

## Files to Modify

| File | Change |
|---|---|
| `api.js` | Add `getRolesWithCapabilities()`, `clearRolesCapabilitiesCache()`, `aggregateByRole()`, `setCredentialRoles()`, `bulkAssignRoles()`, `getAdminWritableCredentials()` |
| `api.js` | Export new functions in `module.exports` |
| `components/RoleAccessDashboard.jsx` | **New file** — dashboard with table + matrix views |
| `components/BulkRoleAssignmentModal.jsx` | **New file** — bulk role assignment form |
| `bundle.jsx` | Import new components, add `viewMode` state, add `roleAccess`/`bulkRoleAssignment` modal states, navigation toggle, reference data fetch for capabilities |

---

## Data Model

```javascript
// Role with capabilities (cached)
{
    name: 'admin',
    capabilities: ['admin_all_objects', 'change_own_password', ...],
    isAdmin: true,
}

// Aggregation result
{
    roleMap: {
        'admin': { read: [cred1, cred2], write: [cred1] },
        'power': { read: [cred1, cred3], write: [cred3] },
        '* (all)': { read: [cred5, cred6], write: [] },
    },
    openAccessCount: 23,
    adminWritableCount: 15,
}

// Bulk assignment result
[
    { credential: { name: 'svc-1', realm: 'prod' }, success: true, error: null },
    { credential: { name: 'api-key', realm: 'dev' }, success: false, error: { status: 403, message: '...' } },
]

// Matrix cell data
{
    role: 'admin',
    credential: { name: 'svc-1', realm: 'prod' },
    accessLevel: 'RW', // 'R' | 'W' | 'RW' | 'WILDCARD' | 'NONE'
}
```

---

## Testing Plan

1. **Open access detection** — verify `* (all)` in read roles flags as open access
2. **Admin-writable detection** — verify admin role in write roles flags correctly
3. **Role→credential aggregation** — verify credentials correctly mapped to roles
4. **Matrix view** — verify R/W indicators correct for each role×credential intersection
5. **Filter by role** — verify only credentials with that role show
6. **Show open access only** — filter works correctly
7. **Show admin-writable only** — filter works correctly
8. **Bulk role assignment (replace mode)** — existing roles fully replaced
9. **Bulk role assignment (add mode)** — new roles merged with existing
10. **Wildcard warning** — verify warning appears when `*` is selected
11. **Cache invalidation** — verify `clearRolesCapabilitiesCache()` works
12. **Performance** — verify matrix view renders correctly with 50+ roles and 200+ credentials
13. **Error handling** — verify individual ACL failures don't abort bulk operation
14. **Navigation** — "View credential" links back to main table with name filter

---

## Dependencies

- `getRoles()` in `api.js` — base role list, reused
- `_setAcl()` in `api.js` — ACL write mechanism, reused by `setCredentialRoles()` and `bulkAssignRoles()`
- `buildAclPath()` in `api.js` — reused for ACL path construction
- `CredentialTable.jsx` aclRead/aclWrite columns — visual pattern reused
- `MultiSelector` from `@splunk/react-ui` — used in role selection (already used in CredentialForm)
- Splunk admin permissions (`admin_all_objects`) for role capability fetch and ACL writes
- No new npm deps
