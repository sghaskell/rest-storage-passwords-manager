# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] - 2026-03-21

### Added
- **Bulk CSV import** — upload a CSV file to create multiple credentials in one operation
  - Preview modal shows all rows to be imported (password masked as `••••••`) with validation errors highlighted
  - Row count summary: "X credentials ready to import, Y rows skipped"
  - Per-row results modal after import: each credential shows ✓ success or ✗ failure with error detail
  - 409 conflicts shown as "already exists" — other rows continue importing
  - **Download Template** — one-click download of a documented CSV template with header comments explaining each column, valid values, and quoting rules for multi-role fields
- Import dropdown in toolbar — **Import** toggle reveals "Upload CSV" and "Download Template" options; closes on outside click

### Changed
- `owner` column in CSV defaults to current user if blank or `*` (API rejects `*` as owner)
- `sharing` column in CSV defaults to `app` if blank or not one of `global`, `app`, `user`
- CSV parser skips lines beginning with `#` (comment lines used in the downloadable template)

## [2.0.2] - 2026-03-21

### Added
- Select-all checkbox in table header — checks/unchecks all visible rows; shows indeterminate state when only some rows are selected

## [2.0.1] - 2026-03-21

### Fixed
- Show password now works correctly for credentials with special characters in the realm or username, including AOB-style credentials (e.g. `__REST_CREDENTIAL__#APP#...``splunk_cred_sep``1`). The URL is now taken directly from Splunk's API response rather than being reconstructed from the realm/username fields.

## [2.0.0] - 2026-03-21

### Breaking Changes
- Removed Bootstrap 3 table plugin, dropdown, and context menu — no third-party JS dependencies remain
- Removed UI tour (images were outdated and no longer reflected the modernized UI)

### Added
- **Live filter bar** — type to filter credentials by username, realm, or app; updates instantly
- **Empty state message** — friendly prompt when no credentials exist or no filter results match
- **Animated loading spinner** — visual feedback while credentials load
- **App scope warning** — amber hint when creating credentials in the current app, explaining they will be lost if the app is uninstalled
- **Pagination** — credentials table paginates at 10 rows; Previous/Next controls shown when needed
- **Accordion row expansion** — click any row to expand an inline update form; no page reload required
- **409 conflict handling** — clear error when attempting to create a duplicate credential
- **Select All / Reset buttons** on role pickers — Reset always restores least-privilege defaults (`admin`, `power`)
- **Live selection counter** on multi-select role pickers

### Changed
- Replaced deprecated `splunkjs/mvc` components (SearchManager, DropdownView, MultiDropdownView) with native `fetch` + `async/await` + DOM methods
- Replaced jQuery `$.Deferred` chains with `async/await`
- Replaced `innerHTML` string injection (XSS vectors) with safe DOM methods
- **ACL controls** — Read Users and Write Users pickers now show roles only (+ `*`); Owner picker shows users only; matches what the `storage/passwords` REST endpoint actually accepts
- **Default permissions** changed from `* (all)` to `admin, power` (least privilege)
- `* (all)` wildcard is now mutually exclusive with named role selections
- Realm field is disabled in the update form — the REST endpoint does not allow realm changes after creation
- Version bumped to 2.0.0

### Fixed
- Reset button now correctly restores default selections in both create and edit workflows
- `+ New Credential` button label correctly restored after form close
- Username and realm inputs are trimmed of leading/trailing whitespace before submission
- AppInspect `--included-tags cloud` failures resolved: removed `[triggers]` stanza from `app.conf`, added global write ACL to `metadata/default.meta`

### Removed
- `appserver/static/bootstrap-table.js`
- `appserver/static/bootstrap-table-contextmenu.js`
- `appserver/static/bootstrap-dropdown.js`
- `appserver/static/bootstrap-table.css`
- `appserver/static/bootstrap-dropdown.css`
- `appserver/static/bootstrap-btn-danger.css`
- `appserver/static/Modal.js`
- `default/ui-tour.conf`
- `appserver/static/img/credential_management-tour_enterprise/` (14 PNG files)

### Documentation
- README rewritten for 2.0.0 — removed broken image references, stale context menu instructions, and outdated Bootstrap credits
- Help view (`help.xml`) rewritten to reflect current UI and updated instructions
- Added security note: `list_storage_passwords` grants visibility into credentials across all apps where the user has read access — grant carefully

## [1.0.9] - prior release

Initial public release with Bootstrap 3 table, jQuery, and `splunkjs/mvc` components.
