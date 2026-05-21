# REST storage/passwords Manager for Splunk

## About

An intuitive, full-featured React-based CRUD interface to the [Splunk storage/passwords REST endpoint](https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTaccess#storage.2Fpasswords). If you're an app developer looking to securely store passwords for APIs, Custom Alert Actions, Modular Inputs, or any resource that requires a password, this is your tool.

Create, update, copy, delete, and import credentials — plus manage permissions, sharing scope, app context, and audit trails — all from a single dashboard without touching the Splunk CLI or the REST API directly.

## Features

- **Full CRUD** — create, edit, copy, and delete credentials from a single table view
- **Bulk operations** — multi-select and bulk delete credentials; CSV import for bulk creation (up to 500 rows)
- **CSV import/export** — download a template, import via drag-and-drop, and export credentials for backup
- **Password reveal** — view and copy clear-text passwords in a secure modal
- **Live filtering and sorting** — filter by any field, sort by column, control visible columns
- **Pagination** — configurable rows per page (10/25/50/100)
- **ACL management** — granular read/write role pickers with `* (all)` wildcard; least-privilege defaults (`admin`, `power`)
- **Audit log** — separate view showing all credential activity with HTTP status correlation
- **Inline help** — collapsible help modal accessible via `?` button or `Shift+/` keyboard shortcut
- **Splunk Cloud compatible** — passes AppInspect `--included-tags cloud` vetting

## Dependencies

To store passwords a user must have the `admin_all_objects` capability enabled within an assigned role. To read passwords a user must have the `list_storage_passwords` capability enabled within an assigned role. Grant `list_storage_passwords` carefully — users with this capability can view credentials across any app where they have read access.

## Usage

The **Credential Management** dashboard provides a CRUD interface to create, update, and delete credentials.

### Create Credential

Click **Create Credential** to open the form. Fill in a username and password. Optionally add a realm (e.g. `prod`, `dev`) — the realm cannot be changed after creation. The form pre-fills with secure defaults for owner, read/write roles, app scope, and sharing.

### Edit Credential

Click the pencil icon in a row's Actions column to open the edit form. You can change the password, app, owner, sharing, and read/write roles. The username and realm are locked.

### Copy Credential

Click the copy icon to duplicate a credential with a date-suffixed username.

### Delete Credential

Single delete: click the trash icon in a row's Actions column and confirm.

Bulk delete: select rows with checkboxes, then click the "Delete Selected (N)" button in the toolbar.

### Reveal Clear Password

Click the eye icon in a row's Actions column to display the plain-text password in a modal with a copy button.

### Filter, Sort, and Customize Columns

Search across all fields — or narrow to a specific field using the dropdown next to the search box. Click any column header to sort. Click "Show/Hide Columns" to toggle which columns are visible (saved per browser).

### CSV Import

Click **Download Template** to get a CSV template. Click **Import CSV** and drag or select your file. A preview table shows the parsed rows before any credentials are created. Maximum file size is 512 KB, with a limit of 500 rows.

### CSV Export

Click **Export CSV** to download a CSV of all credentials. Passwords are not included — Splunk does not return them in list responses. Add passwords back and re-import if needed.

### Audit Log

The **Audit Log** view (separate tab) shows all REST activity against storage/passwords — creates, updates, deletes, ACL changes, and view events. Filter by time range, specific users, or free-text search.

## Using Stored Passwords

See the [Splunk dev documentation](https://dev.splunk.com/enterprise/docs/developapps/manageknowledge/secretstorage/) for details on reading stored credentials from your app's Python or JavaScript code.

## Support

### Feature Requests
Please [submit feature requests through GitHub](https://github.com/sghaskell/rest-storage-passwords-manager/labels/enhancement) using the `enhancement` label.

### Bugs
Please [submit bugs through GitHub](https://github.com/sghaskell/rest-storage-passwords-manager/labels/bug) using the `bug` label.

###### For all other inquiries
Scott Haskell — [Code hosted at GitHub](https://github.com/sghaskell/rest-storage-passwords-manager)
