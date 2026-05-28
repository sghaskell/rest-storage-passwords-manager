# Refactor: Remove in-app tabs → Route via Splunk top nav

## Current state

`bundle.jsx` mounts a single `CredentialManager` component that internally switches views via a `viewMode` state and in-app tab buttons:
- `table` → `CredentialTable` (main CRUD view)
- `dashboard` → `ExpiryDashboard`
- `role-access` → `RoleAccessDashboard`

`nav/default.xml` only has two items: `credential_management` and `audit_log`.

## Target state

Each dashboard gets its own Splunk nav item. No in-app tab bar.

**Splunk top nav:**
1. **Credential Management** → main CRUD table
2. **Expiry Dashboard** → expiry stats + table
3. **Role Access** → role×credential matrix
4. **Audit Log** → already its own view

## Changes

### 1. `default/data/ui/nav/default.xml` — add nav items

Add `expiry_dashboard` and `role_access` as top-level nav items.

```xml
<nav search_view="credential_management" color="#65A637">
  <view name="credential_management" />
  <view name="expiry_dashboard" />
  <view name="role_access" />
  <view name="audit_log" />
</nav>
```

### 2. Create `default/data/ui/views/expiry_dashboard.xml`

New Splunk dashboard view, same pattern as `credential_management.xml`:
- Loads `react/bundle.js`
- Contains `<div id="expiry-dashboard-app">`
- Theme: dark

### 3. Create `default/data/ui/views/role_access.xml`

Same pattern:
- Loads `react/bundle.js`
- Contains `<div id="role-access-app">`
- Theme: dark

### 4. `appserver/static/react/bundle.jsx` — remove tabs, add smart mounting

**Remove:**
- `viewMode` / `setViewMode` state (line 192)
- Tab button row (lines 1225-1253) — the "Credentials | Expiry Dashboard | Role Access" bar + "Alert Settings" and "Password Policy" buttons
- Conditional rendering of `ExpiryDashboard` and `RoleAccessDashboard` (lines ~1406-1425)
- `setViewMode('table')` calls used for navigation back to table (lines 1412, 1428)

**Change:**
- The existing `init()` mounts `CredentialManager` into `#credential-manager-app` — this stays for the Credential Management view
- Add new init blocks for `#expiry-dashboard-app` and `#role-access-app` containers
- Each new container mounts its own dedicated component:
  - `ExpiryDashboard` gets `credentials` loaded from `API.getAllCredentials()` (same enrichment logic)
  - `RoleAccessDashboard` gets `credentials` + `rolesWithCapabilities` (same ref data fetch)

**Details for ExpiryDashboard mount:**
- `ExpiryDashboard` currently receives props: `credentials`, `onNavigateToTable`, `onOpenAlertConfig`, `onRefresh`
- `onNavigateToTable` → replace with a Splunk nav redirect: `window.location.href = relativeWebUrl('credential_management')`
- `onOpenAlertConfig` → we need a way to open Alert Settings. Options:
  - Add an `ExpiryAlertConfig` modal inside the ExpiryDashboard mount
  - Or add a settings button that navigates to Credential Management (where Alert Settings lives)
  - **Recommendation:** keep Alert Settings as a button in Credential Management only. Expiry Dashboard has a "⚙ Configure" button that opens the `ExpiryAlertConfig` modal directly — wrap the mount in a small wrapper component.

**Details for RoleAccessDashboard mount:**
- Currently receives: `credentials`, `rolesWithCapabilities`, `onOpenBulkAssign`, `onViewCredential`
- `onViewCredential` → replace with Splunk nav redirect: `window.location.href = relativeWebUrl('credential_management')` and set a search token OR filter via URL hash
- `onOpenBulkAssign` → keep inline (modal works fine within the view)

### 5. `appserver/static/react/components/ExpiryDashboard.jsx` — update callback props

- `onNavigateToTable` prop becomes optional; if not provided, use Splunk nav redirect
- `onOpenAlertConfig` prop: if not provided, remove the "Alert Settings" button or make it navigate to Credential Management

### 6. `appserver/static/react/components/RoleAccessDashboard.jsx` — update callback props

- `onViewCredential` prop: if not provided, use Splunk nav redirect
- `onOpenBulkAssign` stays (modal-based, view-scoped)

## Risk assessment

- **Low risk**: Each component is already self-contained; the data fetching logic is shared via the `API` module
- **Medium risk**: `ExpiryDashboard`'s `onNavigateToTable` currently sets `activeFilters` to show expired credentials — this cross-view state transfer breaks. User will navigate to Credential Management without the expired filter. Acceptable trade-off (or we use URL params to restore the filter)
- **No data loss**: No backend changes. The `API` module is untouched.

## File manifest

| File | Action | Description |
|------|--------|-------------|
| `default/data/ui/nav/default.xml` | Edit | Add `expiry_dashboard` and `role_access` nav items |
| `default/data/ui/views/expiry_dashboard.xml` | Create | New Splunk view for Expiry Dashboard |
| `default/data/ui/views/role_access.xml` | Create | New Splunk view for Role Access |
| `appserver/static/react/bundle.jsx` | Edit | Remove tab bar, add mount logic for new containers |
| `appserver/static/react/components/ExpiryDashboard.jsx` | Edit | Make `onNavigateToTable` optional, fallback to nav redirect |
| `appserver/static/react/components/RoleAccessDashboard.jsx` | Edit | Make `onViewCredential` optional, fallback to nav redirect |

## Testing checklist

- [ ] Navigate between all 4 views via Splunk top nav — no in-app tabs visible
- [ ] Credential Management: CRUD still works (create, edit, delete, bulk delete, import, export)
- [ ] Expiry Dashboard: stats render correctly, "Show Expired Credentials" navigates to Credential Management
- [ ] Role Access: matrix/table renders, "View Credential" navigates to Credential Management
- [ ] Audit Log: unchanged, still works
- [ ] Dark theme applies correctly in all 4 views
- [ ] Modal dialogs work within each view (bulk assign, alert config, password policy)
- [ ] Keyboard shortcuts (? for help, Escape to close modals) still work
- [ ] Column presets persist across view changes (localStorage)
