# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Splunk Web (SplunkUI)                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  XML Dashboard (credential_management.xml)                        │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │  password-crud.js (Single-file SPA)                         │  │  │
│  │  │  ┌──────────────┬──────────────┬──────────────┐            │  │  │
│  │  │  │  Data Layer  │  UI Layer    │  ACL Layer   │            │  │  │
│  │  │  │  - fetch()   │  - DOM       │  - fetch()   │            │  │  │
│  │  │  │  - async/await│  - textContent │  - POST   │            │  │  │
│  │  │  └──────────────┴──────────────┴──────────────┘            │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ splunkd/__raw REST API
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Splunk REST API (splunkd)                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ storage/passwords│  │ configs/conf-    │  │ authorization/roles│ │
│  │  - CRUD creds    │  │ passwords/.../acl│  │  - List roles        │ │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘ │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐ │
│  │ apps/local       │  │ authentication/  │  │ configs/conf-        │ │
│  │  - List apps     │  │ users            │  │ passwords/move       │ │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              │ Encrypted Storage
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Splunk Storage (splunkd internal)                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Encrypted credential vault (conf-passwords)                    │   │
│  │  - AES-256 encryption                                           │   │
│  │  - Per-app isolation                                            │   │
│  │  - ACL-based access control                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Architecture Patterns

### 1. Direct REST Pattern (No Search Pipeline)
```
❌ OLD (v1.x): Search → | rest → credentials → clear text in job cache
✅ NEW (v2.x): fetch() → splunkd/__raw → credentials → never touches search tier
```

**Benefits**:
- No search artifacts left behind
- No clear text in job cache
- Faster (no search overhead)
- Splunk Cloud compatible

### 2. Two-Step ACL Pattern
```
For user-scoped credentials:
  1. POST /configs/conf-passwords/.../acl → sharing=app
  2. POST /configs/conf-passwords/.../acl → sharing=user

For app/global scoped credentials:
  1. POST /configs/conf-passwords/.../acl → sharing={app|global}
```

### 3. Module-Scoped State Pattern
```javascript
// OLD: window.sessionStorage (cross-tab pollution)
// NEW: Module-scoped variables (isolated per module load)
let isCreateFormOpen = false;
let allCredentials   = [];
let filterText       = '';
let currentPage      = 1;
const PAGE_SIZE      = 10;
```

## Data Model

### Credential Entity

```javascript
{
  username:    "api-user",          // Credential username
  realm:       "prod",              // Descriptor (e.g., environment)
  app:         "rest-storage-...",  // App context
  owner:       "admin",             // ACL owner
  acl_read:    "admin,power",       // Read roles (comma-separated)
  acl_write:   "admin,power",       // Write roles (comma-separated)
  acl_sharing: "app",               // Sharing scope (global|app|user)
  rest_uri:    "/servicesNS/.../storage/passwords/...", // Edit endpoint
  stanza:      "prod:api-user:"     // Full stanza key (realm:username:)
}
```

### ACL Entity

```javascript
{
  'perms.read':  "admin,power,*",   // Read permissions
  'perms.write': "admin,power",     // Write permissions
  sharing:       "app",             // global | app | user
  owner:         "nobody"           // Owner
}
```

## Security Architecture

### Attack Surface Mitigations

| Threat | Mitigation |
|--------|------------|
| **XSS via innerHTML** | All DOM creation uses `textContent` or `setAttribute()` |
| **Search pipeline exposure** | Direct REST calls only; no SPL `| rest` command |
| **CSRF attacks** | All mutating requests include `X-Splunk-Form-Key` token |
| **Password in URLs** | URI taken from API response, never reconstructed |
| **Cross-tab state bleed** | Module-scoped state, not sessionStorage |
| **Clear text in artifacts** | No search pipeline usage |

### Permission Model

| Operation | Required Capability | Default Roles |
|-----------|---------------------|---------------|
| Create credential | `admin_all_objects` | `admin`, `power` |
| Read credential passwords | `list_storage_passwords` | `admin`, `power` |

## Key Design Decisions

### 1. No Framework (Vanilla JS)
- Splunk 9.x+ deprecates `splunkjs/mvc`
- Splunk Cloud doesn't include all MVC components
- Native DOM + `fetch()` is lighter and more reliable

### 2. No Third-Party CSS
- Bootstrap 3 table/dropdown bundles removed
- Splunk's built-in CSS classes (`table`, `btn`, `modal`) sufficient

### 3. Single-File Implementation
- 1172-line `password-crud.js` handles everything
- Easier deployment (one file to maintain)
- No module bundler required

### 4. Client-Side Pagination
- Page size: 10 rows
- Cached in `allCredentials` array
- Filter applied before pagination

### 5. Inline Row Updates
- Click row → expand form (no page reload)
- Click again → collapse
- Prevents full page refreshes

## Data Flow Diagrams

### Create Credential Flow

```
User clicks "+ New Credential"
    ↓
toggleCreateForm() → show form
    ↓
User fills form → submits
    ↓
handleCreateCredential(formData)
    ↓
validate(formData) → errors? → showModal()
    ↓
createSingleCredential(formData)
    ↓
POST /storage/passwords → 201 Created
    ↓
POST /configs/conf-passwords/.../acl (2-step if sharing=user)
    ↓
refreshTable() → fetchCredentials()
    ↓
renderTable(allCredentials)
```

### Show Password Flow

```
User clicks eye icon on row
    ↓
handleShowPassword(row)
    ↓
if (sharing === 'user') → setSharing(row, 'app')
    ↓
fetchClearPassword(row.rest_uri)
    ↓
POST /storage/passwords/{stanza}?output_mode=json
    ↓
extract entry[0].content.clear_password
    ↓
if (sharing === 'user') → setSharing(row, 'user')
    ↓
showModal({ title, bodyHtml: clearPassword })
```

### Delete Credentials Flow

```
User clicks checkboxes → selects rows
    ↓
User clicks "Delete" button
    ↓
getSelectedRows() → array of credentials
    ↓
deleteCredentials(rows)
    ↓
For each row: DELETE /storage/passwords/{stanza}
    ↓
POST /configs/conf-passwords/.../acl (delete ACL)
    ↓
refreshTable()
```

### CSV Import Flow

```
User clicks "Import → Upload CSV"
    ↓
showImportDropZone() → drag/drop modal
    ↓
File selected → handleImportFile(file)
    ↓
validate(file.size < 512KB)
    ↓
CSV.parse() → rows
    ↓
filter comments (#) → preview data
    ↓
showPreviewModal(rows) → user confirms
    ↓
For each valid row: createSingleCredential(row)
    ↓
showResultsModal(results) → success/failure per row
```
