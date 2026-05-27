---
title: "feat: Password Expiry Notifications"
type: feat
status: draft
date: 2026-05-26
origin: "feature request — visibility into credentials approaching or past rotation deadlines"
---

# feat: Password Expiry Notifications

## Summary

Add an "Expiry Dashboard" view showing credentials grouped by rotation status (overdue, due-soon, ok, none) with configurable thresholds, stats cards, color-coded rows, and optional email alerts through Splunk saved searches.

---

## Problem Frame

Admins set expiry dates but have no way to see what's expiring at a glance. The "Expired only" filter toggle only surfaces overdue — not "due soon." A dedicated dashboard gives at-a-glance visibility and proactive email alerting.

---

## Requirements

- **R1.** "Expiry Dashboard" navigation tab — toggles between main table and dashboard in `bundle.jsx`
- **R2.** Configurable "due soon" threshold (`localStorage`, 1–30 days, default 7) — updates `getRotationStatus()` to use dynamic threshold
- **R3.** Stats bar: 4 cards showing total / overdue / due-soon / ok counts (exclude `none` — no expiry set)
- **R4.** Table sorted by expiry date (soonest first) with numeric "days remaining" indicator (negative = overdue)
- **R5.** Color-coded rows: red (overdue), amber (due-soon), green (ok), gray (none)
- **R6.** Auto-refresh toggle (5 min default, localStorage persisted)
- **R7.** "View in table" button: navigates back to main table with `isExpired` filter applied
- **R8.** Email alert config: create/manage Splunk saved search with `alert_actions=email`, cron schedule, configurable recipients
- **R9.** Threshold settings: shared between dashboard display and email alert config

---

## Scope Boundaries

- No automated rotation — expiry is advisory only
- No per-credential custom notification rules (one global threshold)
- No SMS/Slack/SNS — email only via Splunk alert actions
- No escalation workflows or ticket creation
- Realm format `baseRealm;expiry_YYYY-MM-DD` is DO NOT BREAK

---

## Context & Research

### Existing Infrastructure

| Component | Location | Detail |
|---|---|---|
| `parseExpiryFromRealm(realm)` | `api.js` ~L1702 | Parses `baseRealm;expiry_YYYY-MM-DD`, `expiry_YYYY-MM-DD`, `expiry:YYYY-MM-DD` |
| `buildRealmWithExpiry(baseRealm, expiryDate)` | `api.js` ~L1746 | Combines base realm + expiry with semicolon delimiter |
| `getRotationStatus(expiryDate)` | `api.js` ~L1757 | Returns `'ok' \| 'due-soon' \| 'overdue' \| 'none'` — **hardcoded 7-day threshold** |
| Credential enrichment | `bundle.jsx` ~L449 | Maps each cred with `rotationStatus`, `expiryDate`, `rotationLabel` |
| `getRotationLabel()` | `bundle.jsx` ~L481 | Human-readable label ("Expired on May 26, 2026" / "Expires May 26, 2026") |

### Splunk Email Alerting via Saved Searches

- **Endpoint:** `POST /servicesNS/admin/search/saved/searches` — create saved search
- **Query:** Parse credentials via REST, filter by expiry realm pattern
- **Key fields:** `name` (unique identifier), `search` (SPL query), `cron_schedule` (unix crontab), `alert_actions=email`, `alert_email.to`, `alert_compression=gzip`
- **Status check:** `GET /servicesNS/admin/search/saved/searches/credential-expiry-alert`
- **Delete:** `DELETE /servicesNS/admin/search/saved/searches/credential-expiry-alert`
- **Capabilities required:** `admin_all_objects` for creating managed saved searches

### Current Navigation Model

`bundle.jsx` renders a single `CredentialTable` component. No tab system exists yet — the entire app is one view. The plan adds a `viewMode` state (`'table' | 'dashboard'`) with a SegmentedControl-style toggle.

---

## Implementation Plan

### Phase 1: Configurable Threshold (api.js)

**File:** `api.js`

Make `getRotationStatus()` use a dynamic threshold from `localStorage` instead of the hardcoded 7-day window.

```javascript
// ─── Expiry threshold configuration ──────────────────────────────────────────

const DEFAULT_DUE_SOON_DAYS = 7;
const STORAGE_KEY = 'expiry-threshold-days';

function getDueSoonThreshold() {
    try {
        var stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            var days = parseInt(stored, 10);
            if (days >= 1 && days <= 30) return days;
        }
    } catch (e) {
        console.warn('[expiry] Failed to read threshold:', e);
    }
    return DEFAULT_DUE_SOON_DAYS;
}

function setDueSoonThreshold(days) {
    var clamped = Math.max(1, Math.min(30, Math.round(days)));
    try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch (e) {}
    return clamped;
}

// Update existing getRotationStatus — replace hardcoded 7 with dynamic threshold
function getRotationStatus(expiryDate, thresholdDays) {
    if (!expiryDate) return 'none';
    var effectiveThreshold = thresholdDays !== undefined ? thresholdDays : getDueSoonThreshold();
    var expiryTime = new Date(expiryDate + 'T00:00:00').getTime();
    var now = Date.now();
    var dueSoonMs = effectiveThreshold * 86400000;
    if (now > expiryTime) return 'overdue';
    if (expiryTime - now < dueSoonMs) return 'due-soon';
    return 'ok';
}
```

**Note:** `getRotationStatus()` signature gains an optional `thresholdDays` param for callers that want to bypass the default. All existing callers (enrichment in `bundle.jsx`, `CredentialTable.jsx`) continue to work — they call `getRotationStatus(expiryDate)` and get the dynamic threshold behavior automatically.

### Phase 2: ExpiryDashboard Component (new file)

**File:** `components/ExpiryDashboard.jsx`

**Props:** `{ credentials, onNavigateToTable }`

**Internal state:**
- `autoRefresh` toggle (boolean, default `true`, persisted in `localStorage`)
- `autoRefreshInterval` (default 5 min, persisted in `localStorage`)
- `thresholdDays` (shared with `api.js` localStorage key, with a slider to update it)

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  [← Back to Table]  [↻ Refresh]  [⏱ Auto-refresh: ON/OFF]        │
│  Threshold: ─────────●──── 7 days                                  │
├────────┬────────┬─────────┬──────────────────────────────────────┤
│Total:  │Overdue │Due Soon│ Remaining: 14 days (green)             │
│   47   │   5    │   8    │ (color-coded per row)                 │
├────────┴────────┴─────────┴──────────────────────────────────────┤
│ Username │ Realm │ Expiry Date │ Days Remaining │ Status          │
│──────────│───────│─────────────│────────────────│────────────────│
│ svc-1    │ prod  │ 2026-05-20  │ -6             │ Overdue        │
│ api-key  │ dev  │ 2026-05-28  │ 2              │ Due Soon       │
│ backup   │      │ 2026-07-01  │ 35             │ OK             │
│ ...      │ ...  │ ...         │ ...            │ ...            │
└─────────────────────────────────────────────────────────────────────┘
```

**Sorting:** By `expiryDate` ascending (soonest first). Credentials with `none` status appear at the bottom.

**Days remaining calculation:**

```javascript
function getDaysRemaining(expiryDate) {
    if (!expiryDate) return null;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var expiry = new Date(expiryDate + 'T00:00:00');
    var diffMs = expiry - now;
    return Math.round(diffMs / 86400000);
}
```

**Color coding:** Same palette as existing `CredentialTable.jsx` rotation column — `#d32f2f` (overdue), `#f59e0b` (due-soon), `#0d8469` (ok), `#9e9e9e` (none).

**Auto-refresh logic:**

```javascript
const AUTO_REFRESH_KEY = 'expiry-auto-refresh-enabled';
const AUTO_REFRESH_INTERVAL_KEY = 'expiry-auto-refresh-interval';

// In component:
React.useEffect(function() {
    if (!autoRefresh) return;
    var interval = getAutoRefreshInterval(); // in ms
    var timer = setInterval(function() {
        loadCredentials(); // call parent's reload
    }, interval);
    return function() { clearInterval(timer); };
}, [autoRefresh]);
```

### Phase 3: Email Alert Config Component (new file)

**File:** `components/ExpiryAlertConfig.jsx`

**Props:** `{ config, onSave, onTest, onDelete }`

**Layout:** Settings panel inside a Modal (same `FormModal` pattern as `CredentialForm`):

```
┌──────────────────────────────────────────────────────────┐
│ Email Alert Configuration                                  │
├──────────────────────────────────────────────────────────┤
│ Enable alerts:  [Switch ON/OFF]                         │
│                                                          │
│ Recipients: [admin@example.com, team@example.com]        │
│                                                          │
│ Schedule: Daily at [09:00] AM                             │
│                                                          │
│ Alert when credentials expire within: [7] days            │
│   (shared with dashboard threshold)                    │
│                                                          │
│ Include "due soon" credentials:  [Checkbox checked]      │
│                                                          │
│ Status: Last alert sent: 2026-05-26 09:00 AM             │
│                                                          │
│  [Save & Apply to Splunk]  [Save Locally]  [Delete Alert] │
└──────────────────────────────────────────────────────────┘
```

**API functions in `api.js`:**

```javascript
// Create or update Splunk saved search for expiry alerts
async function createOrUpdateExpiryAlert(config) {
    var body = {
        name: 'credential-expiry-alert',
        search: '| rest /servicesNS/-/-/storage/passwords count=0 | ' +
            'where like(realm, "%expiry_%") | ' +
            'eval expiry_date = substr(realm, match(realm, "expiry_(\\d{4}-\\d{2}-\\d{2})") + 7, 10) | ' +
            'eval days_remaining = round((strptime(strftime(expiry_date, "%s"), "%s") - now()) / 86400, 0) | ' +
            'where days_remaining <= ' + config.thresholdDays + ' | ' +
            'table username realm expiry_date days_remaining',
        disabled: !config.enabled,
        cron_schedule: config.cronMinute + ' ' + config.cronHour + ' * * *',
        alert_actions: 'email',
        alert_email_to: config.recipients,
        alert_compression: 'gzip',
        description: 'Alert when stored credentials approach or past their expiry date',
    };
    return splunkdRequest('/servicesNS/admin/search/saved/searches', {
        method: 'POST',
        body: body,
    });
}

// Fetch existing alert config
async function getExpiryAlert() {
    try {
        return await splunkdRequest('/servicesNS/admin/search/saved/searches/credential-expiry-alert', {
            method: 'GET',
        });
    } catch (e) {
        if (e.status === 404) return null;
        throw e;
    }
}

// Delete the saved search
async function deleteExpiryAlert() {
    return splunkdRequest('/servicesNS/admin/search/saved/searches/credential-expiry-alert', {
        method: 'DELETE',
    });
}
```

**Save modes:**
- "Save & Apply to Splunk": writes to `localStorage` AND calls `createOrUpdateExpiryAlert()` to push to Splunk
- "Save Locally": writes to `localStorage` only (preview/draft mode)

### Phase 4: Navigation Integration (bundle.jsx)

Add `viewMode` state and SegmentedControl-style toggle.

```javascript
// In CredentialManager():
const [viewMode, setViewMode] = React.useState('table'); // 'table' | 'dashboard'
const [alertConfigModalOpen, setAlertConfigModalOpen] = React.useState(false);

// Navigation toggle — render above the toolbar
var navigation = React.createElement('div', {
    style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }
},
    React.createElement(Button, {
        onClick: function() { setViewMode('table'); },
        appearance: viewMode === 'table' ? 'primary' : 'subtle',
        children: 'Credentials'
    }),
    React.createElement(Button, {
        onClick: function() { setViewMode('dashboard'); },
        appearance: viewMode === 'dashboard' ? 'primary' : 'subtle',
        children: 'Expiry Dashboard'
    }),
    React.createElement('div', { style: { marginLeft: 'auto' } },
        React.createElement(Button, {
            onClick: function() { setAlertConfigModalOpen(true); },
            appearance: 'subtle',
            children: '⚙ Alert Settings'
        })
    )
);
```

**Conditional rendering:**

```javascript
// In render return:
{viewMode === 'table' &&
    React.createElement(CredentialTable, { ...existingProps })
}

{viewMode === 'dashboard' &&
    React.createElement(ExpiryDashboard, {
        credentials: credentials,
        onNavigateToTable: function() {
            setViewMode('table');
            // Apply "expired only" filter when navigating back
            setActiveFilters([{ field: 'isExpired', value: 'true' }]);
        },
        onOpenAlertConfig: function() { setAlertConfigModalOpen(true); },
    })
}
```

**Alert config modal:**

```javascript
alertConfigModalOpen && React.createElement(ExpiryAlertConfig, {
    isOpen: alertConfigModalOpen,
    onClose: function() { setAlertConfigModalOpen(false); },
})
```

---

## Files to Modify

| File | Change |
|---|---|
| `api.js` | Add `getDueSoonThreshold()`, `setDueSoonThreshold()`, threshold param to `getRotationStatus()`, `createOrUpdateExpiryAlert()`, `getExpiryAlert()`, `deleteExpiryAlert()` |
| `api.js` | Export new functions in `module.exports` |
| `components/ExpiryDashboard.jsx` | **New file** — dashboard view component |
| `components/ExpiryAlertConfig.jsx` | **New file** — email alert settings modal |
| `bundle.jsx` | Add `viewMode` state, `ExpiryDashboard` import, navigation toggle, conditional rendering, `ExpiryAlertConfig` modal |
| `bundle.jsx` | Rebuild credential enrichment to use dynamic threshold |

---

## Data Model

```javascript
// Dashboard stats (computed from credentials array)
{
    total: 47,        // credentials with expiry set
    overdue: 5,       // rotationStatus === 'overdue'
    dueSoon: 8,       // rotationStatus === 'due-soon'
    ok: 34,           // rotationStatus === 'ok'
    none: 12,         // rotationStatus === 'none' (no expiry set)
}

// Alert config (localStorage + Splunk saved search)
{
    enabled: true,
    recipients: 'admin@example.com',
    cronHour: 9,
    cronMinute: 0,
    thresholdDays: 7,
    includeDueSoon: true,
    lastSent: '2026-05-26T09:00:00.000Z', // from Splunk saved search metadata
    savedSearchName: 'credential-expiry-alert',
}

// Threshold config (localStorage)
// Key: 'expiry-threshold-days' → value: '7' (string)
// Range: 1-30, default: 7

// Auto-refresh config (localStorage)
// Key: 'expiry-auto-refresh-enabled' → 'true' | 'false'
// Key: 'expiry-auto-refresh-interval' → '300000' (ms, default 5 min)
```

---

## Testing Plan

1. **Threshold slider** — adjust from 7 to 14 days, verify `getRotationStatus()` reclassifies credentials from `ok` → `due-soon`
2. **Dashboard stats** — create credentials with various expiry dates, verify counts match
3. **Days remaining** — verify calculation is accurate (same-day = 0, yesterday = -1, tomorrow = 1)
4. **Sorting** — verify sort is ascending by expiry date, with `none` at bottom
5. **Navigation** — "View in table" button applies `isExpired` filter and switches to table view
6. **Auto-refresh** — toggle on/off, verify credentials reload at specified interval
7. **Email alert** — create alert, verify saved search exists in Splunk UI, delete and verify cleanup
8. **Alert config persistence** — "Save Locally" does NOT touch Splunk, "Save & Apply" writes to Splunk
9. **Dark theme** — verify dashboard colors render correctly in dark mode
10. **Edge cases** — credentials with `expiry_` but no base realm, realm format preservation

---

## Dependencies

- `getRotationStatus()`, `parseExpiryFromRealm()` in `api.js` — reused, not replaced
- Credential enrichment in `bundle.jsx` — updated to pass dynamic threshold
- `CredentialTable.jsx` rotation column styling — color palette reused
- Splunk admin permissions for saved searches (`admin_all_objects`)
- Email server configured in Splunk for alert delivery (`alert_email_to`)
