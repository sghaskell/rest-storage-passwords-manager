# Plan: Table UX Improvements

## Goal
1. Switch row expansion to controlled mode so clicking anywhere on the row triggers the visual expansion animation.
2. Override the hover color so it's visually distinct from the zebra stripe rows.
3. Make the Cancel button in the inline edit form actually collapse the row (it already does — verify wiring, rename to clarify intent).

## Context

### Splunk Table internals (from `node_modules/@splunk/react-ui/Table.js`)
- `rowExpansion` accepts: `'single'`, `'multi'`, `'none'`, `'controlled'`.
- In `'single'` mode, Table.Body manages its own internal `expandedRowKeys` state. The `onExpansion` callback fires on caret click, and `expanded` prop on TableRow is **ignored**.
- In `'controlled'` mode, Table.Body reads `expanded` from each TableRow's props directly. Our `expandedRowKey` state drives expansion.
- `onClick` on TableRow fires our handler but does **not** trigger the visual expansion in `'single'` mode — that's why the row expands in state but not visually.
- Hover color is `Q.variables.neutral100` (hardcoded in RowStyles.ts, line ~1516). Stripe even rows use `Q.variables.neutral50`. No prop to override hover color — requires CSS injection.
- Row `onClick` already ignores clicks on `<button>` and `<a>` elements (line ~1780), so action buttons won't fire `onClick`. Our `e.stopPropagation()` is redundant but harmless — can remove.

### Current state
- `CredentialTable.jsx`: Uses `rowExpansion: 'single'`, has `onClick` on TableRow, `stripeRows: true`.
- `CredentialForm.jsx`: Cancel button calls `onCancel` which calls `setExpandedRowKey(null)` — already collapses row.
- `bundle.jsx`: Has `GlobalStyles` via styled-components for CSS injection.

## Implementation Steps

### Step 1: Switch to controlled expansion mode
**File:** `CredentialTable.jsx`

1. Change `rowExpansion: 'single'` → `rowExpansion: 'controlled'` on the `<Table>` component (line ~307).
2. Add `expanded: expandedRowKey === cred.stanzaKey` to each `TableRow` in `dataRows` (line ~227-233).
3. Remove `onExpansion` prop from `TableRow` — `onClick` handles toggling now.
4. Remove `e.stopPropagation()` from action buttons — Splunk's Row already ignores button clicks.

### Step 2: Override hover color via GlobalStyles
**File:** `bundle.jsx`

Add CSS to `GlobalStyles` to override the hover background on table rows. Target the styled-component class for clickable rows. The Splunk Table row gets class `f0igqq-0` (RowStyles__StyledStripeNone) — but this is a hash that can change between versions. Safer approach: target via attribute selector.

When `onClick` is present on TableRow, Splunk sets `$clickable` which produces CSS with `cursor: pointer` and `:hover { background-color: neutral100 }`. We override with a more distinct color:

```css
/* Override table row hover to be more distinct from zebra stripes */
table[data-test='body'] tbody tr[style*='cursor: pointer']:hover > td,
table[data-test='body'] tbody tr:hover > td {
    background-color: #e3f2fd !important;
}
```

Actually — the styled-component applies the hover to the `<tr>` element itself, not cells. The safer selector targets the table body's rows:

```css
/* Distinct hover color for credential table rows */
.credential-table-container table tbody tr:hover {
    background-color: #e3f2fd !important;
}
```

Add this to the `GlobalStyles` template literal in `bundle.jsx` (after line ~43).

### Step 3: Verify Cancel button wiring
**File:** `CredentialTable.jsx` → `buildExpansionRow`

The Cancel button's `onCancel` calls `setExpandedRowKey(null)` — this already collapses the row in controlled mode. No code change needed. Just verify after Step 1.

### Step 4: Rebuild and deploy
Run `bin/deploy.sh`, verify in browser:
- Click anywhere on row → expansion animates open/closed
- Click reveal/delete buttons → no expansion
- Hover shows blue tint, distinct from gray stripes
- Cancel button collapses the row

## Files to modify
- `appserver/static/react/components/CredentialTable.jsx` — Steps 1, 3
- `appserver/static/react/bundle.jsx` — Step 2
