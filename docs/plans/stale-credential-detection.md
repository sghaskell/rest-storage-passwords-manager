# Plan: Stale Credential Detection

## Goal

Flag credentials that haven't been modified in N days (configurable threshold). Surface stale credentials via a "Stale" column in the main table, a filter toggle, and a stat card in the Expiry Dashboard.

## Current state

- `mtime` (modification time) is already displayed in the credential table via `formatMtime()` in `CredentialTable.jsx`
- No concept of "stale" exists — only "expired" (based on user-set `expiryDate`)
- The expiry dashboard classifies by `rotationStatus` (overdue, due-soon, ok, none) which is purely expiry-date driven
- `mtime` is an epoch timestamp from Splunk's REST API

## Changes

### 1. `api.js` — Stale classification helpers

Add three new functions:

```js
function getStaleThreshold() {
    // localStorage key: 'stale-threshold-days', default: 90
}

function setStaleThreshold(days) {
    // Clamp to 7–365 range
}

function getStaleStatus(mtime, thresholdDays) {
    // Returns 'stale' or 'ok'
    // mtime is epoch seconds from Splunk REST
    // Compares: (now - mtime) / 86400 > thresholdDays
}
```

### 2. `bundle.jsx` — Enrich credentials with stale status

In `loadCredentials()`, alongside the existing `rotationStatus` / `rotationLabel` enrichment:

```js
var staleStatus = API.getStaleStatus(cred.mtime, staleThreshold);
var staleDays = cred.mtime ? Math.round((Date.now() / 1000 - cred.mtime) / 86400) : null;

return Object.assign({}, cred, {
    // ... existing enrichment ...
    staleStatus: staleStatus,
    staleDays: staleDays,
});
```

### 3. `CredentialTable.jsx` — Stale indicator

#### New column: "Stale"

Add a new column definition to `COLUMNS`:

```js
{ key: 'stale', label: 'Stale', sortable: true }
```

Display:
- `'stale'` → amber pill showing "X days ago" where X = staleDays
- `'ok'` → grey pill showing "X days ago"

#### New filter toggle

Add a "Stale only" toggle button alongside existing "Duplicates only" and "Expired only" toggles:
- Only visible when at least one credential is stale
- Toggles `isStale` filter field

#### New filter field

Add `isStale` to `FILTER_FIELDS`:
```js
{ key: 'isStale', label: 'Stale' }
```

#### Stale indicator on name column

Add a stale warning icon (clock with amber color `#f59e0b`) next to the credential name, similar to the existing duplicate/expiry indicators. This appears when `staleStatus === 'stale'`.

### 4. `ExpiryDashboard.jsx` — Stale stat card

Add a "Stale" stat card alongside the existing Total/Overdue/Due-Soon/OK/No Expiry cards:
- Color: amber `#f59e0b`
- Count: number of credentials with `staleStatus === 'stale'`

### 5. Settings — Stale threshold control

Add a "Stale threshold" slider to the Expiry Dashboard toolbar, alongside the existing "Due-soon within" slider:
- Label: "Stale after"
- Range: 7–365 days
- Default: 90 days
- Saved to localStorage via `API.setStaleThreshold()`

## File changes

| File | Change |
|------|--------|
| `api.js` | Add `getStaleThreshold`, `setStaleThreshold`, `getStaleStatus` |
| `bundle.jsx` | Enrich credentials with `staleStatus`/`staleDays` in `loadCredentials()` |
| `components/CredentialTable.jsx` | Add stale column, stale indicator on name, "Stale only" filter toggle |
| `components/ExpiryDashboard.jsx` | Add "Stale" stat card, stale threshold slider |

## Implementation order

1. `api.js` — Add stale threshold helpers + classification function
2. `bundle.jsx` — Enrich credentials with stale status
3. `CredentialTable.jsx` — Add stale column + indicator + filter toggle
4. `ExpiryDashboard.jsx` — Add stale stat card + threshold slider

## Risks

- `mtime` is epoch seconds — ensure consistent formatting with existing `formatMtime()` helper
- Stale threshold is independent of expiry threshold — make this clear in the UI to avoid confusion
- A credential can be both "overdue" and "stale" — show both indicators independently
