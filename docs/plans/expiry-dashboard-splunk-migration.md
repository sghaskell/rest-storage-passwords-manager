# Plan: Migrate ExpiryDashboard to Splunk Native React Components

## Goal

Convert `ExpiryDashboard.jsx` from custom HTML grid tables to `@splunk/react-ui` Table, Paginator, Button (with icons), matching the pattern established in `CredentialTable.jsx`.

## Reference

- **Source of truth:** `appserver/static/react/components/CredentialTable.jsx` — every Splunk component usage, import pattern, and state management pattern comes from here.
- **Target file:** `appserver/static/react/components/ExpiryDashboard.jsx`

---

## Tasks

### 1. Extract shared `isDarkTheme()` utility

Both files duplicate dark-theme detection. Create a shared utility and replace both call sites.

- Create `appserver/static/react/utils/theme.js`:
  ```js
  function isDarkTheme() {
      return document.documentElement.classList.contains('dark-theme') ||
          document.documentElement.classList.contains('theme-dark') ||
          document.documentElement.getAttribute('data-theme') === 'dark' ||
          (document.body && document.body.classList.contains('dark-theme'));
  }
  module.exports = { isDarkTheme };
  ```
- In `ExpiryDashboard.jsx`: `const { isDarkTheme } = require('../utils/theme');` then `var isDark = isDarkTheme();`
- In `CredentialTable.jsx`: same import, replace the inline `isDark` expression.

### 2. Add Splunk component imports to ExpiryDashboard

Add these imports near the top (follow CredentialTable's `require` + `.default` pattern):

```js
var TableMod = require('@splunk/react-ui/Table');
var Table = TableMod.default;
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;

var PaginatorMod = require('@splunk/react-ui/Paginator');
var Paginator = PaginatorMod.default;

var ArrowLeft = require('@splunk/react-icons/ArrowLeft').default;
var RefreshCw = require('@splunk/react-icons/RefreshCw').default;
var Gear = require('@splunk/react-icons/Gear').default;
```

### 3. Define COLUMNS array

Add a `COLUMNS` definition matching CredentialTable's pattern. Six columns:

```js
var COLUMNS = [
    { key: 'name',       label: 'Username',     sortable: true  },
    { key: 'realm',      label: 'Realm',        sortable: true  },
    { key: 'expiryDate', label: 'Expiry Date',  sortable: true  },
    { key: 'daysRemaining', label: 'Days Remaining', sortable: false },
    { key: 'rotationStatus', label: 'Status',   sortable: true  },
    { key: 'actions',    label: 'Actions',      sortable: false }
];
```

### 4. Add pagination state and localStorage persistence

Mirror CredentialTable's pattern:

```js
var ROWS_PER_PAGE_KEY = 'expiry-dashboard-rows-per-page';
var DEFAULT_ROWS_PER_PAGE = 10;

// Add helper functions (copy from CredentialTable or refactor):
// loadRowsPerPage() / saveRowsPerPage()

// Add state inside ExpiryDashboard:
const [currentPage, setCurrentPage] = React.useState(1);
const [rowsPerPage, setRowsPerPage] = React.useState(loadRowsPerPage);

// Add useEffect to persist rowsPerPage
```

Add `paginatedCreds` derived from `sortedCreds`:

```js
const paginatedCreds = React.useMemo(function() {
    var startIndex = (currentPage - 1) * rowsPerPage;
    return sortedCreds.slice(startIndex, startIndex + rowsPerPage);
}, [sortedCreds, currentPage, rowsPerPage]);

const totalPages = Math.ceil(sortedCreds.length / rowsPerPage);
```

**Reset page on data changes:** Add `useEffect` that sets `currentPage(1)` when `thresholdDays` changes (since that reclassifies data).

### 5. Replace custom HTML table with `<Table>` components

**Replace `tableHeader`:**

Current: `<div>` with `grid-template-columns`.
New:

```jsx
React.createElement(TableHead, null,
    React.createElement(TableHeadCell, { onClick: function() { handleSort('name'); }, appearClickable: sortConfig.key === 'name' }, 'Username ' + getSortIndicator('name')),
    React.createElement(TableHeadCell, { onClick: function() { handleSort('realm'); }, appearClickable: sortConfig.key === 'realm' }, 'Realm ' + getSortIndicator('realm')),
    React.createElement(TableHeadCell, { onClick: function() { handleSort('expiryDate'); }, appearClickable: sortConfig.key === 'expiryDate' }, 'Expiry Date ' + getSortIndicator('expiryDate')),
    React.createElement(TableHeadCell, null, 'Days Remaining'),
    React.createElement(TableHeadCell, { onClick: function() { handleSort('rotationStatus'); }, appearClickable: sortConfig.key === 'rotationStatus' }, 'Status ' + getSortIndicator('rotationStatus')),
    React.createElement(TableHeadCell, null, 'Actions')
)
```

**Replace `tableRows`:**

Current: `sortedCreds.map()` returning `<div>` with `grid-template-columns`.
New: `paginatedCreds.map()` returning `<TableRow>` with `<TableCell>` children. Keep all existing pill styling, color logic, and the Rotate button inside the cells — only the wrapping changes from `<div>` to `<TableRow>` + `<TableCell>`.

The `buildDataCell(col, cred)` helper pattern from CredentialTable is recommended but optional. You can also inline the cells directly inside the map — either approach works.

**Empty state:**

```jsx
React.createElement(TableRow, { key: 'empty' },
    React.createElement(TableCell, { colSpan: 7 }, 'No credentials found')
)
```

Note: `colSpan` = COLUMNS.length + 1 if you add rowSelection later, otherwise just COLUMNS.length.

**Wrap in `<Table>` + `<TableBody>`:**

```jsx
React.createElement(Table, {
    outerStyle: { width: '100%', marginBottom: '1rem' },
    tableStyle: { width: '100%' }
},
    tableHeader,
    React.createElement(TableBody, { key: currentPage }, ...dataRows)
)
```

### 6. Add sorting support

Add sort state and handlers (CredentialTable pattern):

```js
const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });

function handleSort(key) {
    var direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
        direction = 'desc';
    }
    setSortConfig({ key: key, direction: direction });
}

function getSortIndicator(key) {
    if (sortConfig.key !== key) return '\u2195';
    return sortConfig.direction === 'asc' ? '\u2191' : '\u2193';
}
```

Apply sorting to `sortedCreds` — the existing `sortedCreds` useMemo sorts by expiryDate. Replace it with sortConfig-driven sorting, or layer the sortConfig on top of the existing expiry-first logic. Simplest: let `sortConfig` fully control the order, defaulting to `expiryDate asc`.

### 7. Add Paginator UI

**Below the table** (full paginator):

```jsx
React.createElement('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' } },
    React.createElement('span', { style: { fontSize: '12px', color: 'var(--ed-text-muted)' } },
        // "Showing X-Y of Z" text
    ),
    totalPages > 1 ? React.createElement(Paginator, {
        current: currentPage,
        totalPages: totalPages,
        numPageLinks: totalPages,
        onChange: function(event, data) { setCurrentPage(data.page); }
    }) : null
)
```

**In the toolbar** (rows-per-page selector + compact page control):

Add next to the existing toolbar controls:

```jsx
React.createElement('strong', null, 'Rows:'),
React.createElement('select', {
    value: rowsPerPage,
    onChange: function(e) { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); },
    style: { /* match existing toolbar input styling */ }
},
    React.createElement('option', { value: 10 }, '10'),
    React.createElement('option', { value: 25 }, '25'),
    React.createElement('option', { value: 50 }, '50')
),
totalPages > 1 ? React.createElement(Paginator.PageControl, {
    current: currentPage,
    totalPages: totalPages,
    onChange: function(event, data) { setCurrentPage(data.page); }
}) : null
```

### 8. Replace text emoji characters with Splunk icons

| Current | Replacement |
|---|---|
| `'\u2190'` (← Credentials Table) | `<ArrowLeft />` as `icon` prop on Button |
| `'\u21bb'` (↻ Refresh) | `<RefreshCw />` as `icon` prop |
| `'\u2699'` (⚙ Alert Settings) | `<Gear />` as `icon` prop |
| `'\u21bb'` (↻ Rotate Overdue) | `<RefreshCw />` as `icon` prop |
| `'\u21bb'` (↻ Rotate per-row) | `<RefreshCw />` as `icon` prop |

Use the Button `icon` prop: `React.createElement(Button, { onClick: ..., appearance: ..., icon: React.createElement(RefreshCw, null), children: 'Refresh' })`

### 9. Theme CSS cleanup

The existing `--ed-*` CSS custom properties are fine. No need to rename them to `--ct-*`. Keep the inline `<style>` injection pattern — it works and matches CredentialTable.

### 10. Preserve existing behavior

Do NOT change:
- Stats cards (custom HTML grid — no Splunk equivalent, leave as-is)
- Auto-refresh logic (timer, localStorage)
- Threshold slider (`<input type="range">` — no Splunk equivalent, leave as-is)
- Interval slider (same)
- `classifiedCreds` / `sortedCreds` / `stats` useMemo logic
- `onRotate`, `onRotateBulk`, `onOpenAlertConfig`, `onNavigateToTable` callbacks
- Spinner animation on refresh

---

## Verification

After implementation:

1. Open the password rotation dashboard — table renders with Splunk Table styling
2. Click column headers — sorting toggles asc/desc
3. Paginate — page buttons work, rows-per-page selector works
4. Toggle dark theme — table, cells, and pills adapt correctly
5. Rotate button appears on overdue/due-soon rows and fires `onRotate`
6. "Rotate Overdue/Due-Soon" bulk button in toolbar still works
7. Stats cards, threshold slider, auto-refresh all still function
8. Navigate back to credentials table via back button
