---
title: "Test Plan — Features #006–#009"
date: 2026-05-27
---

# Test Plan: 4 New Features

All features accessible at `http://localhost:8000/en-US/app/rest-storage-passwords-manager/credential_management`

---

## Feature #006 — Expiry Notifications

### Test Cases

| # | Action | Expected |
|---|--------|----------|
| 6.1 | Click "Expiry" tab (new navigation) | ExpiryDashboard renders with stats cards (total/expiring/expired/ok) |
| 6.2 | Verify rows color-coded | Red = expired, yellow = expiring soon, green = ok |
| 6.3 | Set threshold to 14 days (slider) | Stats update immediately; `localStorage` persists across refresh |
| 6.4 | Open "Alert Config" (gear icon or toolbar button) | ExpiryAlertConfig modal opens with email fields |
| 6.5 | Save alert config locally | Form closes; config stored in `localStorage` |
| 6.6 | Save alert config to Splunk | `createOrUpdateExpiryAlert` called; kvstore entry created |
| 6.7 | Wait ~60s on Expiry tab | Auto-refresh triggers; data reloaded silently |
| 6.8 | Switch back to "Credentials" tab | Original table view still works; no state loss |

### Setup
```bash
# Create test credentials with varying expiry dates for dashboard data
curl -k -u admin:A00mast3r -X POST \
  "https://localhost:8089/servicesNS/admin/search/storage/passwords/test-expiry-10" \
  -d "password=test123&app=search&sharing=app&roles=admin&owner=admin&realm=default;expiry_$(date -d '+10 days' +%Y-%m-%d)" 2>/dev/null
```

---

## Feature #007 — Password Policy Enforcement

### Test Cases

| # | Action | Expected |
|---|--------|----------|
| 7.1 | Click "Policy Settings" toolbar button | PasswordPolicySettings modal opens; policy **disabled** by default |
| 7.2 | Enable policy, set minLength=8 | Toggle switches on; slider sets value |
| 7.3 | Click "Save Locally" | Policy saved to `localStorage`; modal closes |
| 7.4 | Create credential with password "abc" (3 chars) | **Submit blocked** — red banner: "Password must be at least 8 characters" |
| 7.5 | Create credential with "Str0ngP@ss!" (11 chars) | Submit succeeds; credential created |
| 7.6 | Enable "Require uppercase" + "Require number" | Generator panel adjusts; validation applies |
| 7.7 | Add "admin123" to Banned Passwords textarea | Submitting "admin123" shows "Password is in the banned list" error |
| 7.8 | Click "Save & Apply to Splunk" | `updateSplunkValidator()` called; if endpoint not available, graceful error |
| 7.9 | Verify existing credentials | No existing creds affected; policy only applies to **new** creates |

---

## Feature #008 — Credential Tagging

### Test Cases

| # | Action | Expected |
|---|--------|----------|
| 8.1 | Create credential, type `production` + Enter in tag input | Colored pill appears; autocomplete suggests existing tags |
| 8.2 | Try uppercase tag `Production` | Validation error — "Tags must be lowercase alphanumeric" |
| 8.3 | Add 5 tags, try 6th | "Maximum 5 tags" error |
| 8.4 | Click pill × button | Tag removed from list |
| 8.5 | Submit form | `setTagsForCredential()` saves to kvstore; `tag_definitions` updated |
| 8.6 | Switch to "Credentials" table | Tags column shows colored pills for tagged credentials |
| 8.7 | Click a tag pill in the table | Filters to show only credentials with that tag |
| 8.8 | Select 3 creds → Bulk Edit → add tag `staging` | `BulkEditModal` saves tag to all 3 credentials |
| 8.9 | Delete a tagged credential | `deleteTagsForCredential()` cleans up kvstore |
| 8.10 | Delete a tag definition | `deleteTagDefinition()` removes from kvstore + any credential refs |

### kvstore Verification
```bash
# Verify collections created
curl -k -u admin:A00mast3r \
  "https://localhost:8089/servicesNS/admin/search/kvstore/collections" 2>/dev/null

# Should list: credential_tags, tag_definitions
```

---

## Feature #009 — Role-Based Access at Scale

### Test Cases

| # | Action | Expected |
|---|--------|----------|
| 9.1 | Click "Role Access" tab | RoleAccessDashboard renders with stats cards |
| 9.2 | Check stats | Total credentials, open access count, admin-writable count |
| 9.3 | Filter: "Open Access" only | Table shows creds with `* (all)` in read ACL |
| 9.4 | Filter: "Admin Writable" only | Table shows creds writable by `admin` role |
| 9.5 | Switch to "Matrix" view | Role × credential grid with checkmarks |
| 9.6 | Click "Bulk Role Assign" toolbar button | BulkRoleAssignmentModal opens |
| 9.7 | Select 3 creds → assign `power` role | `bulkAssignRoles()` called in **Add** mode (default) |
| 9.8 | Same 3 creds → assign `user` in **Replace** mode | Previous ACLs replaced; only `user` role remains |
| 9.9 | Select `* (all)` role | Wildcard warning shown in modal |
| 9.10 | All 3 tabs co-exist | Credentials / Expiry / Role Access — no conflicts |

### Roles Setup
```bash
# Verify roles loaded with capabilities
curl -k -u admin:A00mast3r \
  "https://localhost:8089/servicesNS/admin/search/admin-auth/roles" 2>/dev/null
```

---

## Regression Checks

| # | Action | Expected |
|---|--------|----------|
| R1 | Create credential (no expiry, no tags, no policy) | Works identically to pre-feature baseline |
| R2 | Edit existing credential | Realm format `baseRealm;expiry_YYYY-MM-DD` preserved |
| R3 | Bulk delete 5 creds | Tags cleaned from kvstore; normal delete flow |
| R4 | CSV import | No tag/policy enforcement on imported creds |
| R5 | Audit log | New activity entries visible for all 4 features |
| R6 | Dark theme | All new components match existing `GlobalStyles` |
| R7 | `npm run check:bundle-size` | Passes — bundle under 2 MB |

---

## Quick Smoke Test (10 min)

```
1. Open app → verify 3 tabs (Credentials / Expiry / Role Access)
2. Expiry tab → verify stats + color coding
3. Create cred → add 2 tags + short password → verify policy blocks
4. Create cred → pass policy → verify tags saved
5. Role Access tab → verify stats + matrix view
6. Bulk edit → add tag to 2 creds
7. Policy Settings → enable, set min 8 chars, test "abc" blocked
8. Refresh page → verify localStorage persistence
9. Navigate back to Credentials → verify normal table still works
10. Open browser DevTools → check for JS errors in console
```

---

## Known Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| `updateSplunkValidator()` endpoint not on all Splunk versions | Low | Catches error; falls back to localStorage |
| kvstore `ensureTagCollections()` fails silently | Medium | Check `splunkd.log` for kvstore errors |
| Auto-refresh interval too aggressive (30s) | Low | Configurable in localStorage |
| Tag autocomplete doesn't handle special chars | Low | Regex `^[a-z0-9_-]{1,50}$` limits valid chars |
