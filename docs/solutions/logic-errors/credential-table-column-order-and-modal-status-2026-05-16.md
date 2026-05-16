---
title: Column order drift and result modal status misclassification in credential table
date: 2026-05-16
category: logic-errors
module: frontend
problem_type: logic_error
component: frontend_stimulus
severity: medium
symptoms:
  - Hidden column re-shown appends to end instead of canonical position
  - All-failed bulk delete shows partial-success orange instead of red error
  - Separator line rendered with green checkmark instead of visual divider
root_cause: logic_error
resolution_type: code_fix
tags:
  - credential-table
  - result-modal
  - column-order
  - status-classification
  - bulk-delete
  - react-components
---

# Column order drift and result modal status misclassification in credential table

## Problem

Re-showing a hidden column in the credential table appended it to the end instead of restoring its canonical position, causing the Actions column to drift from last to middle. Separately, the result modal misclassified status by counting `---` separators as successes and routing all-failed bulk deletes to a misleading "partial success" modal.

## Symptoms

- After hiding then re-showing a column, it appeared at the far right instead of its original position; the Actions column drifted from last to middle after repeated toggle cycles.
- Bulk delete where every item failed displayed an orange "partial success" modal instead of a red error modal.
- The `---` separator between success and error blocks rendered with a green checkmark icon instead of a horizontal rule.

## What Didn't Work

- **`prev.concat([colKey])`** — appending the restored column key to the end of the visible array lost the canonical order defined in `COLUMNS`. The column always appeared last, regardless of its intended position.
- **No `---` filtering** — the `---` separator passed through the `contentMessages` filter, counted as a non-error message, inflated the success count, and rendered with a green checkmark instead of an `<hr>`.
- **No all-failed branch** — bulk delete with zero successes fell through to the partial-success path (`showSuccess` with mixed messages), since only the zero-errors case had an explicit branch.

## Solution

### Column order restoration — `toggleColumnVisibility`

**Before:**
```javascript
return prev.concat([colKey]);
```

**After:**
```javascript
return COLUMNS.map(function(c) { return c.key; })
    .filter(function(k) { return k === colKey || prev.indexOf(k) !== -1; });
```

### Column order normalization on load — `loadVisibleColumns`

**Before:**
```javascript
return parsed.filter(function(k) { return validKeys.indexOf(k) !== -1; });
```

**After:**
```javascript
var valid = parsed.filter(function(k) { return validKeys.indexOf(k) !== -1; });
return COLUMNS.map(function(c) { return c.key; }).filter(function(k) { return valid.indexOf(k) !== -1; });
```

### Separator filtering in status classification

**Before:**
```javascript
var contentMessages = messages.filter(function(m) { return m !== '<br/>' && !m.startsWith('<br/>-'); });
```

**After:**
```javascript
var contentMessages = messages.filter(function(m) {
    return m !== '<br/>' && !m.startsWith('<br/>-') && m !== '---';
});
```

### All-failed bulk delete routing

**Before:**
```javascript
if (errorMessages.length === 0) {
    showSuccess('Bulk Delete Complete', successMessages);
} else {
    // Partial success — always hit showSuccess
```

**After:**
```javascript
if (errorMessages.length === 0) {
    showSuccess('Bulk Delete Complete', successMessages);
} else if (successMessages.length === 0) {
    showError('Bulk Delete Failed', errorMessages.map(function(m) { return 'ERROR: ' + m; }));
} else {
    // Partial success
```

### Divider rendering — `---` treated as `<hr>`

**Before:**
```javascript
if (msg === '<br/>' || msg.startsWith('<br/>-')) {
    return React.createElement('hr', ...);
}
```

**After:**
```javascript
if (msg === '<br/>' || msg.startsWith('<br/>-') || msg === '---') {
    return React.createElement('hr', ...);
}
```

## Why This Works

- **COLUMNS as source of truth**: Both `toggleColumnVisibility` and `loadVisibleColumns` now derive order from `COLUMNS.map(c => c.key)`, then filter to only the keys that should be visible. This guarantees canonical ordering regardless of how the visibility set was modified or stored.
- **Explicit all-failed branch**: The three-way split (all success / all failed / partial) covers every outcome. Previously, the `else` after `errorMessages.length === 0` conflated "all failed" with "partial success."
- **Separator exclusion**: Filtering `---` from `contentMessages` prevents it from inflating the non-error count, and including it in the divider condition ensures it renders as an `<hr>` without an icon.

## Prevention

- **Single source of truth for ordering**: Any derived list that must maintain a defined order should always reconstruct from the canonical definition (e.g., `COLUMNS`), never mutate the order in-place.
- **Explicit separator handling**: Define message types (success, error, divider, whitespace) at the point of message construction, rather than inferring type from string content at render time. A typed message array eliminates the need for `---` string matching in multiple places.
- **Exhaustive branching for multi-outcome operations**: Operations with N possible outcomes should have N explicit branches, not `if/else` chains where the final `else` silently absorbs an unconsidered case.

## Related Issues

- `docs/solutions/runtime-errors/splunk-react-dashboard-crashes-2026-05-11.md` — prior dashboard crash fixes for the same CredentialTable component
