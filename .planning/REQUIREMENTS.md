# Requirements

## Validated

- ✓ User can list all credentials in a table format
- ✓ User can create new credentials with username, password, and optional realm
- ✓ User can update credential passwords and permissions
- ✓ User can delete credentials
- ✓ User can reveal clear-text passwords in a modal dialog
- ✓ User can filter credentials by username, realm, or app (case-insensitive)
- ✓ User can bulk import credentials from CSV files (max 512KB)
- ✓ User can download a CSV template with documentation
- ✓ ACL controls use separate pickers for read roles, write roles, and owner
- ✓ Default permissions are least-privilege (`admin`, `power` roles)
- ✓ Splunk Cloud compatible (passes AppInspect `--included-tags cloud`)
- ✓ No third-party JS/CSS dependencies
- ✓ Direct REST API calls (no search pipeline)
- ✓ CSRF token included in all mutating requests

## Active

- [ ] **R1: React Component Architecture**
  - Split the monolithic `password-crud.js` into separate React components
  - Components: `CredentialManager`, `CredentialTable`, `CredentialForm`, `Modal`
  - Each component in its own file under `appserver/static/react/components/`

- [ ] **R2: Vite Build Tooling**
  - Configure Vite to build an IIFE bundle for Splunk compatibility
  - Output to `appserver/static/react/bundle.js`
  - Sourcemaps disabled for production
  - Minify with Terser, drop console statements

- [ ] **R3: Dev Server Support**
  - Enable `npm run dev` for local development
  - Dev server on port 5173
  - Hot reload not required (Splunk reloads the page)

- [ ] **R4: Bundle Output**
  - Production build generates `appserver/static/react/bundle.js`
  - Bundle includes all React code and components
  - Uses globals: `React`, `ReactDOM`, `SplunkReact`

- [ ] **R5: Component Functionality Match**
  - All v2.x features implemented in React version
  - Create credential form with validation
  - Inline row updates (accordion expansion)
  - Multi-select with checkbox header
  - Pagination (10 rows per page)
  - Live filter without page reload
  - CSV import modal with drag/drop
  - Password reveal modal

- [ ] **R6: Security Features**
  - No XSS vulnerabilities (use `textContent`, not `innerHTML`)
  - CSRF tokens in all mutating requests
  - Passwords never logged or exposed in URLs
  - `list_storage_passwords` capability check for read access

## Out of Scope

- Not changing the dashboard XML structure (`credential_management.xml`)
- Not adding new credential fields beyond realm/username/password
- Not changing the ACL permission model
- Not removing legacy `password-crud.js` (keep for backward compatibility)
- Not implementing real-time sync or websockets
- Not adding analytics or telemetry
- Not implementing user authentication (uses Splunk session)
