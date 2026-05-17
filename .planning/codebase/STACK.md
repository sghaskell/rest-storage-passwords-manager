# Technology Stack

## Platform

| Component | Technology |
|-----------|------------|
| **Platform** | Splunk Enterprise / Splunk Cloud |
| **App Type** | Splunk Custom App (SplunkUI/Classic Dashboard) |
| **Version** | 2.1.1 (as of 2026-03-21) |
| **Python Version** | Python 3 |

## Frontend Stack

| Component | Technology |
|-----------|------------|
| **Framework** | Vanilla JavaScript (ES6+) |
| **UI Library** | None (native DOM + Splunk CSS) |
| **HTTP Client** | `fetch()` API (no jQuery) |
| **State Management** | Module-scoped variables |
| **Dashboard Framework** | Splunk XML Dashboards (v1.1) |

## Backend / Integration

| Component | Technology |
|-----------|------------|
| **REST API** | Splunk REST API (`splunkd/__raw`) |
| **Credential Storage** | `storage/passwords` endpoint |
| **ACL Management** | `configs/conf-passwords/{stanza}/acl` |
| **Authentication** | Splunk session key / CSRF token |

## Removed Dependencies (v2.0.0 Migration)

| Component | Status | Reason |
|-----------|--------|--------|
| `splunkjs/mvc` | **Removed** | Deprecated in Splunk 9.x, absent in Cloud |
| jQuery | **Removed** | Replaced with native DOM methods |
| Bootstrap 3 | **Removed** | Splunk's native CSS classes sufficient |
| `bootstrap-table.js` | **Removed** | Custom table rendering |
| `bootstrap-dropdown.js` | **Removed** | Custom dropdown implementation |
| `splunkjs/mvc/simplexml/ready!` | **Kept** | Only used as lifecycle trigger |

## Build / Deployment

| Component | Technology |
|-----------|------------|
| **Package ID** | `rest-storage-passwords-manager` |
| **Manifest** | `default/app.conf` |
| **Metadata** | `metadata/default.meta` |
| **Validation** | Splunk AppInspect (`--included-tags cloud`) |

## Key Libraries (Inline)

| File | Purpose |
|------|---------|
| `appserver/static/password-crud.js` | Single-file CRUD implementation (~1172 lines) |

## Notes

- **No third-party JavaScript dependencies** remain (as of v2.0.0+)
- **No third-party CSS dependencies** - uses Splunk's built-in styles
- **No search pipeline usage** for credential data - direct REST calls only
- CSRF token required for all mutating requests (`X-Splunk-Form-Key`)
