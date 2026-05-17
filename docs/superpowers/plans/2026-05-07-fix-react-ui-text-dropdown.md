# Fix Invisible Text & Empty Dropdowns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix white-on-white invisible text and empty dropdowns in React credential form while maintaining behavioral parity with legacy password-crud.js.

**Architecture:** Wrap render in `<SplunkThemeProvider>` from @splunk/themes (styled-components injection). Rewrite 6 Selectors to use correct Select/Multiselect API with declarative `<Select.Option>` children instead of `data` array + `activeItem`.

**Tech Stack:** Splunk Enterprise 9.x, @splunk/react-ui v5.9.1 (CJS), @splunk/themes v1.7.0, webpack, styled-components

---

## Background — Root Causes

**Issue 1 — Invisible text:** `<CredentialManager>` renders without any theme provider. `@splunk/react-ui` components consume color tokens from styled-components context — undefined without provider means white text on white background.

**Issue 2 — Empty dropdowns:** All 6 Selectors use wrong props (`data`, `activeItem`, `onSelect`). The actual API is declarative children: `<Select.Option>` elements as JSX children, controlled via string `value` prop + `onChange(event, {value})`. Multi-select uses separate `<Multiselect>` component.

### Verified Prop API (@splunk/react-ui v5.9.1 compiled source)

**Single Select:**
```jsx
<Select value="search" onChange={(e, data) => setValue(data.value)}>
    <Select.Option label="Search" value="search" />
</Select>
```

**Multi Select:**
```jsx
<Multiselect placeholder="Pick..." onChange={(e, data) => setSelected(data.selectedItems.map(i=>i.value))}>
    <Multiselect.Option label="A" value="a" />
</Multiselect>
```

### Thread Safety / Important Notes
- Multiselect `.value` prop is NOT supported — multiselects manage selection internally via onChange's `data.selectedItems[]`. The component handles tracking selected state.
- Single select uses controlled pattern with `value` string + `onChange={(e, {value}) => setValue(value)}`

---

## Task 1: Add SplunkThemeProvider to fix invisible text

**File:** `appserver/static/react/bundle.jsx`

The file imports Modal/Button from @splunk/react-ui (lines 12-18) and renders in the IIFE closure at line 564.

- [ ] **Step 1: Add @splunk/themes import**
  
  After line 18, add:
  ```js
  var SplunkThemeProvider = require('@splunk/themes').SplunkThemeProvider;
  ```

- [ ] **Step 2: Wrap render in ThemeProvider with light theme**
  
  At line ~564, replace the render call:
  ```js
  // Before:
  root.render(React.createElement(CredentialManager));

  // After:
  root.render(React.createElement(SplunkThemeProvider, { family: 'enterprise', colorScheme: 'light' }, React.createElement(CredentialManager)));
  ```

  **Why enterprise/prisma defaults to dark** — `@splunk/themes` defaults to dark theme. Splunk Enterprise UI uses light by default, so we override `colorScheme="light"`. Using `family="enterprise"` matches the Enterprise UI style; prisma is for cloud.

- [ ] **Step 3: Build and verify text renders**
  
  ```bash
  npx webpack --config webpack.config.js
  ```
  Expected: No errors, output `appserver/static/react/bundle.js`. Reload in Splunk → all text should be visible (dark text on white/light background).

---

## Task 2: Fix single-select dropdowns (App, Sharing, Owner)

**File:** `appserver/static/react/components/CredentialForm.jsx`

The file already imports Select at line 14 (`var Selector = SelectMod.default`). The component exposes `.Option`. Data arrays (`appData`, `ownerData`, `sharingData`) are already correctly formatted as `{label, value}`. The issue is exclusively how the React Selector component consumes them — wrong props.

- [ ] **Step 1: Add reference to Select.Option**
  
  After line 14, add:
  ```js
  var SelectOption = SelectMod.Option;
  ```

- [ ] **Step 2: Remove unused active item variables (lines 224-226)**
  
  Delete these lines. Single selects now use `value` string directly from state, not derived `{label, value}` objects:
  ```js
  // DELETE:
  var activeAppItem = appData.find(...) || {...};
  var activeOwnerItem = ownerData.find(...) || {...};
  var activeSharingItem = sharingData.find(...) || {...};
  ```

- [ ] **Step 3: Convert App field Selector (lines ~280-286)**
  
  Replace the entire `formField('App', ...)` block:
  ```jsx
  formField('App',
      React.createElement(Selector, {
          value: app,
          onChange: function(data) { setApp(data.value); },
      }, appData.map(function(a) {
          return React.createElement(SelectOption, { key: 'app-' + a.value, label: a.label, value: a.value });
      })),
      { required: true }
  ),
  ```

- [ ] **Step 4: Convert Sharing field (lines ~290-296)**
  ```jsx
  formField('Sharing',
      React.createElement(Selector, {
          value: sharing,
          onChange: function(data) { setSharing(data.value); },
      }, sharingData.map(function(s) {
          return React.createElement(SelectOption, { key: 'sharing-' + s.value, label: s.label, value: s.value });
      })),
      { helpText: 'How this credential is shared' }
  ),
  ```

- [ ] **Step 5: Convert Owner field (lines ~300-306)**
  ```jsx
  formField('Owner',
      React.createElement(Selector, {
          value: owner,
          onChange: function(data) { setOwner(data.value); },
      }, ownerData.map(function(u) {
          return React.createElement(SelectOption, { key: 'owner-' + u.value, label: u.label, value: u.value });
      })),
      { helpText: 'User who owns this credential' }
  ),
  ```

---

## Task 3: Fix multi-select dropdowns (Read Roles, Write Roles)

**File:** `appserver/static/react/components/CredentialForm.jsx`

- [ ] **Step 1: Import Multiselect component**  
  Add after SelectOption import:
  ```js
  var MultiSelectMod = require('@splunk/react-ui/Multiselect');
  var MultiSelector = MultiSelectMod.default;
  var MultiSelectOption = MultiSelectMod.Option;
  ```

- [ ] **Step 2: Remove unused active items variables (lines ~230-235)**
  
  Delete the `activeReadItems` and `activeWriteItems` map blocks. Multiselect handles tracking internally.

- [ ] **Step 3: Convert Read Roles to Multiselect**
  
  Replace lines ~310-319:
  ```jsx
  formField('Read Roles',
      React.createElement(MultiSelector, {
          placeholder: 'Select roles...',
          onChange: function(e, data) {
              var selected = data.selectedItems ? data.selectedItems.map(function(it) { return it.value; }) : [];
              if (selected.length > 1 && selected.includes('* (all)')) selected = ['* (all)'];
              setReadRolesArray(selected);
              clearError('readRoles');
          },
      }, rolesData.map(function(r) {
          return React.createElement(MultiSelectOption, { key: 'role-' + r.value, label: r.label, value: r.value });
      })),
      { helpText: 'Roles that can view this credential', errorText: errors.readRoles, required: true }
  ),
  ```

- [ ] **Step 4: Convert Write Roles to Multiselect**
  ```jsx
  formField('Write Roles',
      React.createElement(MultiSelector, {
          placeholder: 'Select roles...',
          onChange: function(e, data) {
              var selected = data.selectedItems ? data.selectedItems.map(function(it) { return it.value; }) : [];
              if (selected.length > 1 && selected.includes('* (all)')) selected = ['* (all)'];
              setWriteRolesArray(selected);
              clearError('writeRoles');
          },
      }, rolesData.map(function(r) {
          return React.createElement(MultiSelectOption, { key: 'role-' + r.value, label: r.label, value: r.value });
      })),
      { helpText: 'Roles that can modify this credential', errorText: errors.writeRoles, required: true }
  ),
  ```

- [ ] **Step 5: Remove unused handler functions**
  
  Delete `handleSingleSelectChange` (lines ~172-178) and `handleMultiSelectChange` (lines ~180-199). All logic is now inlined in each field's onChange callback.

---

## Task 4: Build & Manual Verification

**Files:** Build artifacts

- [ ] **Step 1: Run webpack build**
  ```bash
  npx webpack --config webpack.config.js
  ```
  Expected: No errors, output `appserver/static/react/bundle.js` (~2MB). If errors about missing exports from Multiselect/Select, file a bug — fall back to `<Selector>` with correct props.

- [ ] **Step 2: Manual verification checklist in Splunk browser**
  - All text visible (not white-on-white) ✓
  - App dropdown shows list of apps ✓
  - Sharing dropdown shows 3 options (App-scoped, Global, User-scoped) ✓
  - Owner dropdown shows "Nobody" + available users ✓
  - Read Roles multi-select shows role list including "* (all)" ✓
  - Write Roles multi-select same ✓
  - Creating new credential works end-to-end ✓
  - Editing existing credential preserves all field values ✓
  - Changing password toggle still works ✓
