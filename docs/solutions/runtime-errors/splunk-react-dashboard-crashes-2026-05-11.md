---
title: Splunk React Dashboard Crashes on Load — styled-components External, TableMod Namespace, and Paginator API Mismatches
date: 2026-05-11
category: runtime-errors
module: CredentialTable
problem_type: runtime_error
component: tooling
symptoms:
  - "@splunk/react-ui components crash with 'cannot read properties of undefined (reading useContext)'"
  - "React error #130 — namespace object passed as component renders blank"
  - "Paginator shows 'No credentials found' after clicking next page — slice(NaN) returns empty array"
  - "Table columns misaligned, text overflowing — style prop not reaching inner <table> element"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [splunk, react, styled-components, webpack-externals, paginator, @splunk/react-ui, tablemod, cjs-imports]
---

# Splunk React Dashboard Crashes on Load — styled-components External, TableMod Namespace, and Paginator API Mismatches

## Problem

The React dashboard in the Splunk credential password manager crashed on load with React error #130, then exhibited broken table layout and pagination failures after initial crash fixes. Five interrelated issues prevented the dashboard from rendering correctly.

## Symptoms

- Dashboard crashes on load with `"cannot read properties of undefined (reading 'useContext')"` — React error #130
- Table renders blank after extracting `.default` — namespace object passed as React component
- Pagination click shows "No credentials found" instead of next page
- Table columns misaligned, text overflowing container
- After installing `styled-components` as a dependency, components rendered completely unstyled (duplicate instance problem)

## What Didn't Work

- **Installing `styled-components` as a bundled dependency**: Fixed the `undefined()` crash but created a duplicate-instance problem. `SplunkThemeProvider` consumed theme tokens from the bundled copy, while `@splunk/react-ui` components injected styles into Splunk's global copy. Styles never reached the DOM — all components rendered unstyled. (session history)
- **Direct `require('@splunk/react-ui/Paginator')` without `.default`**: Passed a module object to `React.createElement()`, triggering React error #130. Same pattern affected Chip, Button, Text, Switch across multiple components. (session history)
- **Merging `style` props onto the Table component**: Didn't fix layout because `style` spreads to the outer wrapper div, not the `<table>` element that controls column layout.
- **Passing raw `onChange` argument to `setCurrentPage`**: Stored an event object instead of a page number, causing `slice(NaN, ...)` to return empty array. (session history)
- **Context-polluted debugging**: Multiple rounds of editing and redeploying without confirming whether each change moved the needle produced no meaningful progress. (session history)

## Solution

Five fixes applied across the stack:

1. **Remove styled-components from webpack externals** — Splunk doesn't provide a global styled-components instance. Removing it from externals allows webpack to bundle it, satisfying `@splunk/react-ui`'s internal dependencies:

```js
// webpack.config.js — BEFORE
externals: {
  react: 'React',
  'react-dom': 'ReactDOM',
  'styled-components': 'styled-components', // removed
}

// AFTER — styled-components bundled, not externalized
externals: {
  react: 'React',
  'react-dom': 'ReactDOM',
}
```

2. **Extract Table from namespace export** — `@splunk/react-ui/Table` exports a namespace, not a default component:

```js
import * as TableMod from '@splunk/react-ui/Table';
const Table = TableMod.default;
const TableHead = TableMod.Head;
const TableBody = TableMod.Body;
const TableRow = TableMod.Row;
const TableCell = TableMod.Cell;
const TableHeadCell = TableMod.HeadCell;
```

3. **Migrate Paginator to v5.9.1 API** — replaced legacy `data`/`activeItem`/`onSelect` with `current`/`totalPages`/`onChange`:

```jsx
// BEFORE — legacy API
React.createElement(Paginator, {
  data: paginatedCredentials,
  activeItem: currentPage,
  onSelect: function(page) { setCurrentPage(page); },
})

// AFTER — v5.9.1 controlled API
React.createElement(Paginator, {
  current: currentPage,
  totalPages: totalPages,
  onChange: function(event, data) { setCurrentPage(data.page); },
})
```

4. **Fix onChange data extraction** — `onChange` receives `(event, data)`, page number is in `data.page`:

```js
onChange: function(event, data) { setCurrentPage(data.page); }
```

5. **Separate outer and table styling** — use `outerStyle` for container, `tableStyle` for the `<table>` element:

```jsx
React.createElement(Table, {
  outerStyle: { width: '100%', marginBottom: '1rem' },
  tableStyle: { width: '100%' },
}, ...)
```

## Why This Works

- Splunk doesn't ship styled-components globally; the externals configuration assumed the host provides it. Bundling it satisfies `@splunk/react-ui`'s internal styled-components dependencies without creating duplicate context instances.
- The Table module uses a namespace export pattern common in Splunk's React UI library — accessing `.default` retrieves the actual component class, while sub-components (Head, Body, Row, Cell) are properties on the namespace object.
- Paginator v5.9.1 changed from a data-driven API to a controlled component API with `current`/`totalPages`. The `onChange` callback signature `(event, data)` is standard Semantic UI pattern; `data.page` holds the numeric page, not the event object.
- Table's `style` prop targets the wrapper div; `tableStyle` targets the inner `<table>` element, which needs explicit width for proper column layout.

## Prevention

- Audit webpack externals against Splunk's actual global providers before adding new dependencies. Not all libraries that `@splunk/react-ui` depends on are provided by Splunk globally.
- Check `@splunk/react-ui` module exports with `Object.keys(require('@splunk/react-ui/X'))` before assuming default export. Namespace exports require `.default` extraction.
- Pin Splunk UI library versions and verify prop APIs against the specific version's TypeScript definitions (`node_modules/@splunk/react-ui/types/src/...`), not generic Semantic UI docs.
- Type-check `onChange` callback parameters — `data.page` should be a number before passing to state setters.
- When a component has both `style` and `tableStyle`/`contentStyle` props, verify which element each targets via React DevTools.
- Isolate changes per session and verify before committing — concurrent agent sessions broke the dashboard wiring, requiring stash rollback. (session history)

## Related Issues

- `.reviews/2026-05-11-react-dashboard-review.md` — code review findings (P1/P2/P3) addressed in same migration
- `docs/superpowers/plans/2026-05-11-001-fix-finish-react-migration-plan.md` — migration plan document
- `docs/superpowers/plans/2026-05-06-splunk-react-ui-migration.md` — original Splunk React UI migration plan
- `docs/superpowers/plans/2026-05-07-fix-react-error-130.md` — React error #130 cascade fix