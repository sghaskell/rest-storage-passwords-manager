# REST storage/passwords Manager for Splunk

## About

An intuitive, full-featured JavaScript CRUD interface to the [Splunk storage/passwords REST endpoint](https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTaccess#storage.2Fpasswords). If you're an app developer looking to securely store passwords for APIs, Custom Alert Actions, Modular Inputs, or any resource that requires a password, this is your tool.

Create, update, delete, and view credentials — plus manage permissions, sharing scope, and app context — all from a single dashboard without touching the Splunk CLI or the REST API directly.

## What's New in 1.1.0

- **Modernized UI** — replaced deprecated `splunkjs/mvc` components, jQuery, and Bootstrap 3 table plugin with native DOM, `fetch`, and Splunk's built-in CSS classes. No third-party dependencies remain.
- **Splunk Cloud compatible** — passes AppInspect `--included-tags cloud` vetting.
- **Improved ACL controls** — separate role pickers (Read Users / Write Users) and user picker (Owner); `* (all)` wildcard is mutually exclusive with named roles; least-privilege defaults (`admin`, `power`).
- **App scope warning** — inline hint when creating credentials in the current app explains that credentials stored in an app are lost when that app is uninstalled.
- **Live filter** — type to filter the credentials table by username, realm, or app without a page reload.
- **Animated loading indicator** — spinner shown while credentials load.
- **Reset button** — restores least-privilege defaults after using Select All on role pickers.

## Dependencies

To store passwords a user must have the `admin_all_objects` capability enabled within an assigned role. To read passwords a user must have the `list_storage_passwords` capability enabled within an assigned role.

## Usage

The **Credential Management** dashboard provides a CRUD interface to create, update, and delete credentials.

### Create Credential

Click **+ New Credential** to reveal the creation form. Fill in a username, password, and optionally a realm (used as a descriptor, e.g., `prod` or `dev`). The form pre-fills with secure defaults for owner, read users, write users, app scope, and sharing — update them before clicking **Create**.

### Update Credential

Click any row in the table to expand it and reveal the inline update form. You can change the password, permissions, or app context. The realm cannot be changed after creation — this is a limitation of the `storage/passwords` REST endpoint.

### Delete Credential

Select one or more rows using the checkboxes, then click **Delete**. A confirmation dialog shows the credentials to be deleted before you confirm.

### Reveal Clear Password

Click the eye icon in the Password column to display the plain-text password in a modal.

### Filter Credentials

Type in the filter box at the top of the table to narrow results by username, realm, or app. The filter is case-insensitive and updates live as you type.

## Using Stored Passwords

See the [Splunk dev documentation](https://dev.splunk.com/enterprise/docs/developapps/manageknowledge/secretstorage/) for details on reading stored credentials from your app's Python or JavaScript code.

## Support

### Feature Requests
Please [submit feature requests through GitHub](https://github.com/sghaskell/rest-storage-passwords-manager/labels/enhancement) using the `enhancement` label.

### Bugs
Please [submit bugs through GitHub](https://github.com/sghaskell/rest-storage-passwords-manager/labels/bug) using the `bug` label.

###### For all other inquiries
Scott Haskell — [Code hosted at GitHub](https://github.com/sghaskell/rest-storage-passwords-manager)
