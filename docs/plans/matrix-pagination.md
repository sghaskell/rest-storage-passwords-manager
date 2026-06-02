# Plan: Add Row Pagination to RoleAccessDashboard Matrix View

## Goal

Replace the hard performance cap (`filteredCreds.slice(0, 200)`) with user-controlled row pagination so all credentials are accessible without DOM lockup.

## Current state

- **Lines 219–220** of `RoleAccessDashboard.jsx`:
  ```js
  var matrixRoles = allRoleNames.slice(0, 50);
  var matrixCreds = filteredCreds.slice(0, 200);
  ```
- **Line 593**: Warning banner reads `"⚠ Performance cap: showing N credentials × M roles (max 200×50)"`
- No pagination state or UI exists.

## Changes — single file

**File:** `appserver/static/react/components/RoleAccessDashboard.jsx`

### 1. Add pagination state (after existing state declarations, ~line 136)

```js
const [matrixPage, setMatrixPage] = React.useState(0);
const [matrixPageSize, setMatrixPageSize] = React.useState(50);
var PAGE_SIZES = [25, 50, 100, 200, 'All'];
```

### 2. Replace the hard cap with paged slicing (lines 219–220)

Replace:
```js
var matrixRoles = allRoleNames.slice(0, 50);
var matrixCreds = filteredCreds.slice(0, 200);
```

With:
```js
var matrixRoles = allRoleNames.slice(0, 50); // keep role cap
var effectivePageSize = matrixPageSize === 'All' ? filteredCreds.length : matrixPageSize;
var totalPages = Math.max(1, Math.ceil(filteredCreds.length / effectivePageSize));
// Clamp page to valid range when filters change
var clampedPage = Math.min(matrixPage, totalPages - 1);
var matrixCreds = filteredCreds.slice(clampedPage * effectivePageSize, (clampedPage + 1) * effectivePageSize);
```

Also: reset `matrixPage` to 0 when filters change. Add a `useEffect`:
```js
React.useEffect(function() { setMatrixPage(0); }, [filterRole, showOpenAccess, showAdminWritable]);
```

### 3. Replace the warning banner (line 593)

Replace:
```js
React.createElement('div', {
    style: { fontSize: '11px', color: '#f59e0b', marginBottom: '0.5rem' }
}, '⚠ Performance cap: showing ' + matrixCreds.length + ' credentials × ' + matrixRoles.length + ' roles (max 200×50)'),
```

With info text + pagination controls:
```js
// Info line
React.createElement('div', {
    style: { fontSize: '11px', color: subText, marginBottom: '0.25rem' }
}, 'Showing credentials ' + ((clampedPage * effectivePageSize) + 1) + '–' + ((clampedPage + 1) * effectivePageSize) + ' of ' + filteredCreds.length + ' × ' + matrixRoles.length + ' roles'),

// Pagination bar
React.createElement('div', {
    style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '12px', color: subText }
},
    // Page size dropdown
    React.createElement('label', { style: { fontSize: '12px' } }, 'Show:'),
    React.createElement('select', {
        value: matrixPageSize,
        onChange: function(e) { setMatrixPageSize(e.target.value === 'All' ? 'All' : parseInt(e.target.value, 10)); setMatrixPage(0); },
        style: { padding: '2px 6px', fontSize: '12px', border: '1px solid ' + inputBorder, borderRadius: '3px', backgroundColor: inputBg, color: inputColor }
    }, PAGE_SIZES.map(function(sz) {
        return React.createElement('option', { key: sz, value: sz }, sz === 'All' ? 'All (' + filteredCreds.length + ')' : sz);
    })),

    // Prev button
    React.createElement(Button, {
        onClick: function() { setMatrixPage(Math.max(0, clampedPage - 1)); },
        appearance: 'subtle',
        disabled: clampedPage === 0,
        children: '← Prev'
    }),

    // Page label
    React.createElement('span', null, 'Page ' + (clampedPage + 1) + ' of ' + totalPages),

    // Next button
    React.createElement(Button, {
        onClick: function() { setMatrixPage(Math.min(totalPages - 1, clampedPage + 1)); },
        appearance: 'subtle',
        disabled: clampedPage >= totalPages - 1,
        children: 'Next →'
    })
)
```

Place this **above** the `<table>` element (line 594) and inside the same padding container as the legend.

### 4. Styling notes

- Reuse existing theme variables: `inputBg`, `inputBorder`, `inputColor`, `subText`, `cardBg`
- Pagination bar should match the filter bar style (line 368–426): flex row, gap 0.75rem
- The `<select>` for page size should match the existing role filter dropdown style (lines 377–384) but at 12px font

## Summary of diff

| Change | Lines | Type |
|--------|-------|------|
| Add `matrixPage` state | ~136 | new state |
| Add `matrixPageSize` state | ~137 | new state |
| Add `PAGE_SIZES` constant | ~138 | new const |
| Add `useEffect` to reset page on filter change | after ~208 | new effect |
| Replace `matrixCreds` slice | 219–220 | rewrite |
| Add `totalPages` / `clampedPage` / `effectivePageSize` | 219–220 area | new vars |
| Replace warning banner | 593 | rewrite |
| Add pagination controls row | new, before line 594 | new JSX |

## Acceptance criteria

1. Matrix view shows only one page of credential rows at a time (default 50).
2. User can select page size: 25, 50, 100, 200, or All.
3. Prev/Next buttons navigate pages; disabled at boundaries.
4. Page resets to 1 when any filter changes (role filter, open access, admin-writable).
5. Info text shows `"Showing credentials X–Y of Z"` instead of the performance cap warning.
6. Role cap of 50 columns remains unchanged.
7. No existing table/matrix functionality is broken (cell editing, bulk assign, filters, view toggle).

## Risks / notes

- **Sticky first column** (line 658, `position: sticky; left: 0`) — unaffected by pagination; only row count changes.
- **Cell editing popover** uses `getBoundingClientRect` — pagination changes which cells are rendered but the popover logic is per-cell, so no impact.
- **"All" page size** effectively removes the cap; warn if `filteredCreds` > 500 (optional enhancement, not required).
- If `filteredCreds` is empty, `totalPages` is 1 and `matrixCreds` is empty — pagination bar renders harmlessly with Prev/Next both disabled.
