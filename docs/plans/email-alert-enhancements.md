# Plan: Email Alert Configuration Enhancements

## Goal

Enhance `ExpiryAlertConfig.jsx` to support additional email alert parameters and a test-send feature.

## Current state

`ExpiryAlertConfig.jsx` stores these fields in localStorage:
```js
{ enabled, recipients, cronHour, cronMinute, thresholdDays, includeDueSoon, lastSent }
```

`api.js::createOrUpdateExpiryAlert` sends:
```js
{ actions: 'email', 'action.email': '1', 'action.email.to': recipients, ... }
```

Missing from the Splunk REST API spec:
- `action.email.cc` — CC email addresses
- `action.email.subject` — Custom email subject
- `action.email.send_if_no_results` — Send email even when search returns 0 results
- `action.email.results_type` — Results format (table, csv, json, etc.)
- `action.email.inline` — Include results inline in the email body

## Changes to `ExpiryAlertConfig.jsx`

### New config fields

Add to `getDefaultConfig()` and `loadLocalConfig()`:

```js
{
  // ... existing fields ...
  ccRecipients: '',           // action.email.cc
  emailSubject: '',           // action.email.subject (empty = default Splunk subject)
  sendIfNoResults: false,     // action.email.send_if_no_results
  includeResultsInline: true, // action.email.inline
}
```

### New form fields

After the "Recipients" field, add:

1. **CC Recipients** — text input, comma-separated (same pattern as "Recipients")
2. **Email Subject** — text input with placeholder "Credential Expiry Alert"
3. **Send if no results** — Switch toggle
4. **Include results in email body** — Switch toggle

### Load from Splunk

Parse additional fields from the Splunk response in `handleLoadFromSplunk()`:
- `alert_email_cc` → `ccRecipients`
- `alert_email_subject` → `emailSubject`
- `alert_email_send_if_no_results` → `sendIfNoResults`
- `alert_email_inline` → `includeResultsInline`

## Changes to `api.js`

### `createOrUpdateExpiryAlert`

Add to the body object:

```js
'action.email.cc': config.ccRecipients,
'action.email.subject': config.emailSubject || 'Credential Expiry Alert',
'action.email.send_if_no_results': config.sendIfNoResults ? '1' : '0',
'action.email.inline': config.includeResultsInline ? '1' : '0',
```

### New function: `dispatchSavedSearch`

```js
async function dispatchSavedSearch(name) {
  await splunkdRequest(
    `/servicesNS/nobody/rest-storage-passwords-manager/saved/searches/${encodeURIComponent(name)}/dispatch`,
    { method: 'POST' }
  );
}
```

## Test-send feature

Add a "Test Send" button to the modal footer (between "Load from Splunk" and "Delete Alert").

Behavior:
1. On click: call `createOrUpdateExpiryAlert(config)` to ensure the saved search exists with current config
2. Then call `dispatchSavedSearch('credential-expiry-alert')` to trigger a one-time execution
3. Show a toast or status message: "Test email sent" or "Failed to dispatch: ..."

## File changes

| File | Change |
|------|--------|
| `components/ExpiryAlertConfig.jsx` | Add 4 new config fields, 4 new form fields, parse new fields on load, add test-send button |
| `api.js` | Add new `action.email.*` params to body, add `dispatchSavedSearch` function |

## Implementation order

1. Add new fields to `getDefaultConfig()` and `loadLocalConfig()`
2. Add form fields to `ExpiryAlertConfig.jsx`
3. Update `createOrUpdateExpiryAlert` body in `api.js`
4. Update `handleLoadFromSplunk` parsing
5. Add `dispatchSavedSearch()` + test-send button
