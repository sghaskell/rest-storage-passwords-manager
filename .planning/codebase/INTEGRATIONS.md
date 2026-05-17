# Integrations

## External Systems

### Splunk REST API (`splunkd`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/servicesNS/{owner}/{app}/storage/passwords` | GET | Fetch all credentials visible to user |
| `/servicesNS/{owner}/{app}/storage/passwords` | POST | Create new credential |
| `/servicesNS/nobody/{app}/storage/passwords/{stanza}` | POST | Update credential password |
| `/servicesNS/{owner}/{app}/storage/passwords/{stanza}` | DELETE | Delete credential |
| `/servicesNS/{owner}/{app}/configs/conf-passwords/{stanza}/acl` | POST | Update ACL/permissions |
| `/servicesNS/-/-/apps/local` | GET | Fetch installed apps list |
| `/servicesNS/-/-/authorization/roles` | GET | Fetch roles for ACL pickers |
| `/servicesNS/-/-/authentication/users` | GET | Fetch users for Owner picker |

### Splunk Security Model

| Capability | Required For | Description |
|------------|--------------|-------------|
| `admin_all_objects` | Write credentials | Must have this to store passwords |
| `list_storage_passwords` | Read credentials | Must have this to view passwords; grants visibility into credentials across all apps where user has read access |

**Security Note**: `list_storage_passwords` should be granted carefully because users with this capability can view credentials across any app where they have read access.

## Data Flow

### Credential Operations

```
User Action → fetch() → splunkd/__raw → storage/passwords → JSON → DOM
```

### ACL Operations

```
User Action → fetch() → splunkd/__raw → configs/conf-passwords/{stanza}/acl → JSON
```

## APIs Consumed

### 1. storage/passwords (Primary)
- **Purpose**: Store and retrieve encrypted credentials
- **Path Pattern**: `/servicesNS/{owner}/{app}/storage/passwords`
- **Data**: Encrypted passwords (clear text returned only via dedicated endpoint)
- **Key Fields**: `username`, `realm`, `clear_password`, `eai:acl`

### 2. configs/conf-passwords (ACL Management)
- **Purpose**: Manage access control for credentials
- **Path Pattern**: `/servicesNS/{owner}/{app}/configs/conf-passwords/credential%3A{stanza}%3A/acl`
- **Fields**: `perms.read`, `perms.write`, `sharing`, `owner`

### 3. apps/local (App Discovery)
- **Purpose**: Populate app scope dropdown
- **Path**: `/servicesNS/-/-/apps/local?search=disabled%3D0`
- **Data**: App label, name, version

### 4. authorization/roles (Role Discovery)
- **Purpose**: Populate Read/Write ACL role pickers
- **Path**: `/servicesNS/-/-/authorization/roles`
- **Data**: Role names

### 5. authentication/users (User Discovery)
- **Purpose**: Populate Owner picker
- **Path**: `/servicesNS/-/-/authentication/users`
- **Data**: Username, real name

## External References

| Reference | URL | Purpose |
|-----------|-----|---------|
| Splunk storage/passwords REST | https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTaccess#storage.2Fpasswords | API documentation |
| Splunk credential storage dev docs | https://dev.splunk.com/enterprise/docs/developapps/manageknowledge/secretstorage/ | Developer guide |
| Splunk AppInspect | https://docs.splunk.com/Documentation/Splunk/latest/Develop/RunAppInspect | App validation |

## Import/Export Integration

| Feature | Format | Endpoint/Method |
|---------|--------|-----------------|
| CSV Import | CSV (UTF-8, max 512KB) | Direct POST to `storage/passwords` |
| CSV Template | Downloadable CSV | `Download CSV` button → template file |
| Preview | Inline modal | Client-side CSV parsing |

**CSV Schema**:
- `username` (required): Credential username
- `password` (required): Clear text password
- `realm` (optional): Descriptor (e.g., `prod`, `dev`)
- `owner` (optional, defaults to current user)
- `app` (optional, defaults to current app)
- `sharing` (optional, defaults to `app`; valid: `global`, `app`, `user`)
- `read` (optional, comma-separated roles)
- `write` (optional, comma-separated roles)
- Comment lines: Lines starting with `#` are skipped
