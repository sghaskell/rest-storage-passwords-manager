# Project Structure

## Directory Layout

```
/home/scott/Documents/code/rest-storage-passwords-manager/
├── .git/                           # Git repository
├── .planning/                      # Project planning artifacts (GSD)
│   └── codebase/                   # This directory - tech/arch docs
│       ├── STACK.md                # Technology stack
│       ├── INTEGRATIONS.md         # External system integrations
│       ├── ARCHITECTURE.md         # System architecture
│       └── STRUCTURE.md            # This file - project structure
├── appserver/                      # Web-accessible static assets
│   └── static/
│       └── password-crud.js        # Single-file CRUD implementation
├── bin/                            # Scripts
│   └── README                      # Script documentation placeholder
├── default/                        # App configuration (deployed to splunkd)
│   ├── app.conf                    # App manifest (version, labels)
│   ├── web.conf                    # Web UI configuration
│   ├── data/                       # Data files (empty in v2.1.1)
│   └── data/ui/                    # UI definitions
│       ├── views/                  # Dashboard definitions
│       │   ├── credential_management.xml   # Main dashboard
│       │   └── help.xml            # Help/documentation dashboard
│       ├── panels/                 # Panel definitions
│       │   └── credential-management.xml   # Panel mount points
│       └── nav/                    # Navigation menu
│           └── default.xml         # Nav bar configuration
└── metadata/                       # Metadata permissions
    └── default.meta                # Default permissions for views
```

## File-by-File Breakdown

### Configuration Files

| File | Purpose | Key Properties |
|------|---------|----------------|
| `default/app.conf` | App manifest and metadata | `version`, `label`, `id`, `python.version` |
| `default/web.conf` | Web UI configuration | `[expose:configs_conf-PASSWORDS_MOVE]` endpoint |
| `metadata/default.meta` | Default permissions | Access control for views, export rules |

### UI Files

| File | Purpose | Description |
|------|---------|-------------|
| `default/data/ui/views/credential_management.xml` | Main dashboard | XML dashboard with mount points for JS-rendered UI |
| `default/data/ui/views/help.xml` | Help dashboard | Documentation and usage instructions |
| `default/data/ui/panels/credential-management.xml` | Panel definition | Mount points: `create-user`, `update-user`, `context-menu`, `password-table` |
| `default/data/ui/nav/default.xml` | Navigation menu | Links to `credential_management` and `help` views |

### Static Assets

| File | Purpose | Size |
|------|---------|------|
| `appserver/static/password-crud.js` | Single-file SPA | ~1172 lines |
| `static/appIcon.png` | App icon (small) | 256x256 |
| `static/appIcon_2x.png` | App icon (Retina) | 512x512 |
| `static/appIconAlt.png` | Alternative app icon (small) | 256x256 |
| `static/appIconAlt_2x.png` | Alternative app icon (Retina) | 512x512 |
| `static/appLogo.png` | App logo (small) | 256x256 |
| `static/appLogo_2x.png` | App logo (Retina) | 512x512 |

### Documentation Files

| File | Purpose | Description |
|------|---------|-------------|
| `README.md` | Project overview | Feature list, usage instructions, support info |
| `CHANGELOG.md` | Version history | All notable changes since v1.0.9 |

## Key Entry Points

### Client-Side

| Entry Point | File | Trigger |
|-------------|------|---------|
| Dashboard Load | `credential_management.xml` | User visits dashboard |
| JS Bootstrap | `password-crud.js` | `splunkjs/mvc/simplexml/ready!` fires |
| Table Render | `renderTable()` | Initial load or refresh |
| Create Form | `toggleCreateForm()` | Click "+ New Credential" |
| Row Click | `toggleInlineUpdateForm()` | Click any credential row |

### Server-Side

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `servicesNS/{owner}/{app}/storage/passwords` | GET | List credentials |
| `servicesNS/{owner}/{app}/storage/passwords` | POST | Create credential |
| `servicesNS/nobody/{app}/storage/passwords/{stanza}` | POST | Update password |
| `servicesNS/{owner}/{app}/storage/passwords/{stanza}` | DELETE | Delete credential |
| `configs/conf-passwords/{stanza}/acl` | POST | Update ACL |

## Module Structure (password-crud.js)

```javascript
/**
 * Module: password-crud.js
 * 
 * Structure:
 *   1. Module-level state (lines 1-40)
 *   2. Helper functions (lines 42-150)
 *   3. Data fetchers (lines 152-220)
 *   4. Modal helper (lines 222-260)
 *   5. Table rendering (lines 262-400)
 *   6. Paginator (lines 402-420)
 *   7. Row building (lines 422-480)
 *   8. ACL helpers (lines 482-540)
 *   9. Create/Update/Delete handlers (lines 542-800)
 *   10. Import/Export handlers (lines 802-1100)
 *   11. Event handlers (lines 1102-1172)
 */
```

## Configuration Hierarchy

```
Splunk App Configuration (default/)
    ├── app.conf (app metadata)
    ├── web.conf (web endpoints)
    └── data/ui/
        ├── views/ (dashboard definitions)
        │   ├── credential_management.xml
        │   └── help.xml
        ├── panels/ (panel mount points)
        │   └── credential-management.xml
        └── nav/ (navigation menu)
            └── default.xml

Metadata Permissions (metadata/default.meta)
    ├── [views/credential_management] → read: [ * ]
    └── [views/help] → read: [ * ]

Static Assets (appserver/static/)
    └── password-crud.js (main application code)
```

## Version History Impact on Structure

| Version | Changes | Files Added/Removed |
|---------|---------|---------------------|
| v1.0.9 | Initial release | Bootstrap 3, splunkjs/mvc components |
| v2.0.0 | Major refactor | Removed: Bootstrap bundles, jQuery, MVC components |
| v2.0.1 | Bug fix | Credential URI handling |
| v2.0.2 | Feature | Select-all checkbox in table header |
| v2.1.0 | Feature | CSV import/export |
| v2.1.1 | Bug fix | CSV validation, file size limit |

## Dependencies Graph

```
password-crud.js
    ├── Splunk utilities (Splunk.util.getConfigValue)
    ├── DOM API (document.createElement, textContent)
    ├── Fetch API (fetch, Response.json)
    ├── Event API (addEventListener)
    ├── URL API (URLSearchParams)
    ├── splunkd REST API (endpoints listed above)
    └── jQuery ($ for modal behavior only - legacy support)
```

## Build/Deployment Flow

```
1. Developer writes code
   └── appserver/static/password-crud.js

2. App packaged (tar.gz)
   └── Contains all files in default/, appserver/, metadata/

3. App uploaded to Splunk
   └── splunkd extracts to $SPLUNK_HOME/etc/apps/rest-storage-passwords-manager/

4. App loaded on dashboard visit
   └── credential_management.xml loads password-crud.js

5. password-crud.js executes
   └── fetch() calls to splunkd/__raw endpoints
```
