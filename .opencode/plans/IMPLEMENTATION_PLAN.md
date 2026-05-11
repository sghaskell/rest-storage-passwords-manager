# IMPLEMENTATION_PLAN.md — Session 5: Fix CredentialTable React #130 Render Failure

## Root Cause
`styled-components` is missing from project dependencies. @splunk/react-ui (v5.9.1) declares it as a hard dependency, but it's not installed in this project's node_modules. When webpack encounters `require("styled-components")` inside pre-bundled @splunk modules, it can't resolve it at build time and leaves it as an unresolved external reference. At runtime in Splunk's browser, calling `undefined()` crashes every component that uses styled-components internally — returning undefined or throwing objects → React error #130 "Objects are not valid as a React child."

Since @splunk/react-ui modules like Chip.js, Modal.js, Table.js, CollapsiblePanel.js, and ControlGroup.js ALL use `require("styled-components")` for component rendering, installing styled-components fixes the cascade. Lodash is also a hard dependency (Chip requires `lodash/omit`) — install it alongside.

**Diagnosis evidence:**
- @splunk/react-ui package.json: `"lodash": "^4.18.1"` in dependencies (line 53)
- Chip.js: `require("styled-components")` line 85, `require("lodash/omit")` line 70
- Modal.js: `require("styled-components")` line 84
- Table.js: `require("styled-components")` line 85
- CollapsiblePanel.js: `require("@splunk/themes")` → themes uses styled-components
- ControlGroup.js: `require("@splunk/ui-utils/id")` → ui-utils may depend on lodash

## Definition of Done (from LOOP.md)
1. Table loads and renders credentials without React errors in Splunk UI
2. `npm run build` passes clean; deployment via `./bin/deploy.sh splunk` works without console errors

## Tasks (ordered, sequential)

### Task 1: Install missing dependencies
```bash
npm install --save styled-components@^5.3.10 lodash@^4.18.1
```
- styled-components is a peer dependency of @splunk/react-ui (>=5.3.10 per their lock)
- lodash is a hard dependency (used by Chip for omit, Modal for defer/memoize, etc.)
- Verify: `ls node_modules/styled-components/package.json` and `ls node_modules/lodash/package.json`

### Task 2: Fix ControlGroup import in CredentialForm.jsx
**File:** `appserver/static/react/components/CredentialForm.jsx`, **Line 14**

The module DOES export a default export (ControlGroup.js line 65: `default: () => /* reexport */ ve`). Our pattern `require('@splunk/react-ui/ControlGroup').default` works for direct ESM modules — but the error trace specifically mentions `controlGroupDefault` which suggests webpack's auto-dereference isn't consistent across @splunk's pre-bundled modules. Match the working fallback pattern from bundle.jsx lines 12-13.

**Before:**
```js
var ControlGroup = require('@splunk/react-ui/ControlGroup').default;
```
**After:**
```js
var ControlGroupMod = require('@splunk/react-ui/ControlGroup');
var ControlGroup = ControlGroupMod.default || ControlGroupMod;
```

### Task 3: Fix Button import in CredentialTable.jsx
**File:** `appserver/static/react/components/CredentialTable.jsx`, **Line 20**

Same `.default || module` fallback pattern for consistency.

**Before:**
```js
var Button = require('@splunk/react-ui/Button');
```
**After:**
```js
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default || ButtonMod;
```

### Task 4: Fix Chip props in CredentialTable.jsx
**File:** `appserver/static/react/components/CredentialTable.jsx`, **Lines 211-216**

Chip's v5 API uses `children` for text content and supports `foregroundColor` + `backgroundColor`. Current code passes unsupported `label` and `color` props → renders as null/ignored.

**Before (lines 211-213):**
```js
React.createElement(TableCell, null,
    React.createElement(Chip, { label: (!cred.realm || cred.realm === 'nobody') ? 'global' : (cred.realm || ''), backgroundColor: (!cred.realm || cred.realm === 'nobody') ? '#e0e0e0' : '#e3f2fd', color: (!cred.realm || cred.realm === 'nobody') ? 'inherit' : '#1565c0' })
),
```

**After:**
```js
React.createElement(TableCell, null,
    React.createElement(Chip, { backgroundColor: (!cred.realm || cred.realm === 'nobody') ? '#e0e0e0' : '#e3f2fd', foregroundColor: (!cred.realm || cred.realm === 'nobody') ? 'inherit' : '#1565c0' }, !cred.realm || cred.realm === 'nobody' ? 'global' : (cred.realm || ''))
),
```

**Before (lines 214-216):**
```js
React.createElement(TableCell, null,
    React.createElement(Chip, { label: cred.app || 'search', backgroundColor: '#e8f5e9', color: '#2e7d32' })
),
```

**After:**
```js
React.createElement(TableCell, null,
    React.createElement(Chip, { backgroundColor: '#e8f5e9', foregroundColor: '#2e7d32' }, cred.app || 'search')
),
```

### Task 5: Fix ControlGroup props in CredentialForm.jsx
**File:** `appserver/static/react/components/CredentialForm.jsx`, **Lines 241-247**

`additionalInfo` is not a valid prop (should be `help`). `accessibilityLabel` is NOT valid — ControlGroup automatically handles aria attributes for the label/error pattern.

**Before:**
```js
return React.createElement(ControlGroup, {
    key: label,
    label: label + (opts.required ? ' *' : ''),
    error: err,
    additionalInfo: help,
    accessibilityLabel: err ? label + '. ' + err : undefined,
}, inputEl);
```
**After:**
```js
return React.createElement(ControlGroup, {
    key: label,
    label: label + (opts.required ? ' *' : ''),
    error: err,
    help: help,
}, inputEl);
```

### Task 6: Build and verify
```bash
npm run build
```
- Verify build succeeds without errors (watch for styled-components/lodash resolve warnings)
- Verify bundle.js size < 2MB (`npm run check:bundle-size`)
- Deploy to Splunk via `./bin/deploy.sh splunk`

### Task 7: Test in Splunk UI
1. Reload the credentials page in browser with dev console open
2. Verify table renders all credentials without React error #130
3. Verify realm/app cells render Chip text correctly
4. Verify no console errors from missing styled-components/lodash
