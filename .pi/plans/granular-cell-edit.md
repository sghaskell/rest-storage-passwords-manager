# Plan: Granular cell-level capability editing in RoleAccessDashboard matrix view

## Context

The `RoleAccessDashboard` matrix view currently shows read/write access levels per role × credential cell but is read-only. This plan adds the ability to click any cell and change that single role's capability (RW, R, W, or None) on that single credential.

**Wildcard strategy**: Option A — warn that access is inherited from `*`, require explicit wildcard removal before surgical edits.

## Branch

Create a new branch off the current `feature/expiry-notifications-policy-tagging-roles`:

```
git checkout -b feature/granular-cell-edit
```

## Files involved

| File | Action |
|------|--------|
| `appserver/static/react/components/RoleAccessDashboard.jsx` | Add cell click handlers, popover state, wildcard warning logic |
| `appserver/static/react/components/CellEditPopover.jsx` | **NEW** — floating popover for editing a single cell |
| `appserver/static/react/api.js` | No changes — `setCredentialRoles(credential, readRoles, writeRoles)` is sufficient |

---

## Step 1: Create `CellEditPopover.jsx`

A small floating panel anchored near the clicked cell.

### Props

```javascript
CellEditPopover({
  cred,           // credential object (from matrix data)
  role,           // role string
  accessLevel,    // current level: 'RW' | 'R' | 'W' | '-'
  isWildcardDerived, // boolean — true if access comes from * wildcard
  onClose,        // () => void
  onSave,         // (cred, newReadRoles, newWriteRoles) => Promise<void>
  isDark,         // boolean for theming
})
```

### Layout

Top section (context):
- Credential name (bold, truncated)
- Role name (bold)
- Current access badge (color-coded, matching `MatrixCell`)
- If `isWildcardDerived === true`: yellow warning box:
  > ⚠ Access inherited from wildcard (*). To modify this cell, the wildcard must be replaced with explicit roles for all other roles currently covered.
- Below warning: two buttons: "Remove Wildcard & Edit" (destructive) or "Cancel"

Middle section (access selector):
- Four radio-style buttons in a row: `RW`, `R`, `W`, `None`
- Current level pre-selected
- Color-coded matching `MatrixCell` palette

Bottom section (actions):
- "Save" button (primary, disabled if no change)
- "Cancel" button (subtle)

### Mutation logic (inside `CellEditPopover`)

On Save:
1. Parse current role arrays: `currentRead = cred.aclRead.split(',').trim().filter(Boolean)`
2. Parse current role arrays: `currentWrite = cred.aclWrite.split(',').trim().filter(Boolean)`
3. Based on selected level, mutate both arrays:

```
Target "RW":  role in currentRead, role in currentWrite
Target "R":   role in currentRead, role NOT in currentWrite
Target "W":   role NOT in currentRead, role in currentWrite
Target "-":   role NOT in currentRead, role NOT in currentWrite
```

4. Handle the wildcard case for "Remove Wildcard & Edit":
   - If `isWildcardDerived` is true and user clicked "Remove Wildcard & Edit":
     - Remove `*` and `* (all)` from both currentRead and currentWrite
     - Then apply the target level mutation as above
   - If `isWildcardDerived` is true and user tries to save without removing wildcard:
     - Show inline error: "Cannot modify access for individual role while wildcard (*) is active."

5. Call `onSave(cred, currentRead, currentWrite)` which calls `API.setCredentialRoles(cred, currentRead, currentWrite)`

6. On success, call `onClose()` (parent handles re-fetch)

### Styling

- Absolute/fixed positioning with a `Portal` or inline absolutely-positioned div
- Background: same as `StatCard` bg (#1e293b dark / #fff light)
- Border: 1px solid cardBorder
- Border-radius: 6px
- Box-shadow: 0 4px 12px rgba(0,0,0,0.15)
- Width: ~320px
- z-index: 1000
- Click-outside-to-close

### Click-outside handling

Use a `useEffect` with a `mousedown` listener on `document`. If click target is not inside the popover, call `onClose()`. Clean up on unmount.

---

## Step 2: Modify `MatrixCell` to accept click

Changes to `MatrixCell`:

1. Accept new props: `onClick` (function), `isWildcardDerived` (boolean)
2. If `onClick` is defined: add `cursor: 'pointer'` to `cellStyle`
3. If `isWildcardDerived` is true: add a subtle diagonal stripe overlay or a small `*` indicator (e.g., suffix the cell text with `*` in italic, or add a `::before` pseudo-element via inline style)
4. Add `onClick` handler that prevents event bubbling

```javascript
function MatrixCell({ accessLevel, isDark, onClick, isWildcardDerived }) {
    // ... existing style logic ...

    if (onClick) {
        cellStyle.cursor = 'pointer';
    }

    // If wildcard-derived, show indicator
    var label = isWildcardDerived ? accessLevel + '\u2009*' : accessLevel;

    return React.createElement('div', {
        style: cellStyle,
        onClick: onClick ? function(e) { e.stopPropagation(); onClick(); } : null,
        title: isWildcardDerived ? 'Access inherited from wildcard (*)' : undefined
    }, label);
}
```

---

## Step 3: Modify `RoleAccessDashboard` to wire cell clicks

### New state

```javascript
const [editingCell, setEditingCell] = React.useState(null);
// { cred, role, accessLevel, isWildcardDerived, cellRect }

const [refreshing, setRefreshing] = React.useState(false);
```

### New helper: detect if access is wildcard-derived

Add a function alongside `getAccessLevel`:

```javascript
function isWildcardDerived(role, cred) {
    var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
    var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);

    var readWildcard = readRoles.indexOf('*') !== -1 || readRoles.indexOf('* (all)') !== -1;
    var writeWildcard = writeRoles.indexOf('*') !== -1 || writeRoles.indexOf('* (all)') !== -1;

    // If the role is explicitly listed, it's NOT wildcard-derived (explicit overrides wildcard)
    var explicitlyInRead = readRoles.indexOf(role) !== -1;
    var explicitlyInWrite = writeRoles.indexOf(role) !== -1;

    // Access is wildcard-derived if:
    // - The role is NOT explicitly listed AND
    // - A wildcard exists that grants the access
    var hasRead = readWildcard || explicitlyInRead;
    var hasWrite = writeWildcard || explicitlyInWrite;

    if (!hasRead && !hasWrite) return false;

    // If role is explicit in either, not wildcard-derived for that dimension
    // But if wildcard ALSO exists, the non-explicit dimension is wildcard-derived
    // Simplification: if wildcard exists and role is not explicit, it's wildcard-derived
    if (role === '* (all)') return false; // The sentinel column is its own thing

    var roleExplicit = explicitlyInRead || explicitlyInWrite;
    var wildcardPresent = readWildcard || writeWildcard;

    // If role is explicit in one but wildcard covers the other, still allow edit
    // Wildcard-derived only when the role is NOT in the array at all AND wildcard grants access
    return !roleExplicit && wildcardPresent;
}
```

### New handler: handle cell click

```javascript
function handleCellClick(cred, role, e) {
    var rect = e.target.getBoundingClientRect();
    var level = getAccessLevel(role, cred);
    var wildcard = isWildcardDerived(role, cred);
    setEditingCell({ cred, role, accessLevel: level, isWildcardDerived: wildcard, rect: rect });
}
```

### New handler: handle save from popover

```javascript
async function handleCellSave(cred, newReadRoles, newWriteRoles) {
    try {
        await API.setCredentialRoles(cred, newReadRoles, newWriteRoles);
        setEditingCell(null);
        // Trigger parent re-fetch via callback or state
        // The dashboard is likely controlled by a parent that calls onRefresh
        // If onRefresh prop exists, call it; otherwise dispatch a custom event
        if (onRefresh) onRefresh();
    } catch (err) {
        console.error('Cell edit failed:', err);
        // Don't close popover — let user retry
    }
}
```

### Wire into matrix rendering

In the matrix tbody, update the `MatrixCell` render:

```javascript
// Replace this block in the matrix tbody (lines 616-624):
matrixRoles.map(function(role) {
    var level = getAccessLevel(role, cred);
    var wildcard = isWildcardDerived(role, cred);
    return React.createElement('td', {
        key: role + ':' + cred.stanzaKey
    }, React.createElement(MatrixCell, {
        accessLevel: level,
        isDark: isDark,
        onClick: function(e) { handleCellClick(cred, role, e); },
        isWildcardDerived: wildcard
    }));
})
```

### Render the popover

After the closing `)` of the matrix view (before the final `: null`), add:

```javascript
editingCell && React.createElement(CellEditPopover, {
    cred: editingCell.cred,
    role: editingCell.role,
    accessLevel: editingCell.accessLevel,
    isWildcardDerived: editingCell.isWildcardDerived,
    onClose: function() { setEditingCell(null); },
    onSave: handleCellSave,
    isDark: isDark,
    anchorRect: editingCell.rect
})
```

Also add the `CellEditPopover` require at the top of the file:

```javascript
var CellEditPopover = require('./CellEditPopover');
```

### Positioning the popover

The popover should position itself relative to the anchor rect. Use a `useEffect` in `CellEditPopover` that reads `anchorRect` and sets absolute positioning. If the rect would overflow the viewport, adjust to show above/left of the cell.

Fallback: if `anchorRect` is stale (user scrolled), render the popover at the center of the viewport or just below the matrix container.

---

## Step 4: Edge cases and polish

### `* (all)` sentinel column

Cells in the `* (all)` column behave differently:
- Clicking `* (all)` cell opens the popover
- The access levels shown are: `WILDCARD` or `-`
- The selector should show: `Wildcard Read`, `Wildcard Write`, `Wildcard Both`, `None`
- Saving modifies the `*` entry in the role arrays directly:
  - `Wildcard Read` → ensure `*` is in aclRead, not in aclWrite
  - `Wildcard Write` → ensure `*` is in aclWrite, not in aclRead
  - `Wildcard Both` → `*` in both
  - `None` → remove `*` from both

This is handled in `CellEditPopover` by checking `role === '* (all)'` and rendering different options.

### Refresh after save

`setCredentialRoles` writes to the Splunk backend. The dashboard needs fresh data.

**Concrete wiring — `bundle.jsx` `RoleAccessView` (lines 2103-2143):**

1. Add `onRefresh` prop to `RoleAccessDashboard` in `bundle.jsx` (after line ~2113):
   ```javascript
   onRefresh: function() {
       var doReload = async function() {
           var fetched = await API.getAllCredentials();
           var enriched = fetched.map(function(cred) {
               var expiryDate = cred.expiryDate || '';
               var rotationStatus = API.getRotationStatus(expiryDate);
               return Object.assign({}, cred, {
                   expiryDate: expiryDate || '',
                   rotationStatus: rotationStatus,
                   tags: [],
               });
           });
           setCredentials(enriched);
       };
       doReload();
   },
   ```
   This mirrors the `onApply` handler on `BulkRoleAssignmentModal` (line 2123-2141).

2. In `RoleAccessDashboard.jsx`, accept `onRefresh` as a new prop and call it after successful save in `handleCellSave` (see Step 3 above). Direct callback — no event dispatch needed.

### Disabled cells

If the user doesn't have permission to modify a credential's ACL, the cell should be visually greyed out with a tooltip. Check if `setCredentialRoles` returns an error and handle it gracefully.

### Performance

The matrix is capped at 200×50 = 10,000 cells. Adding `onClick` to every cell is fine (React handles it). The popover is a single instance, so no performance concern there.

---

## Step 5: Testing

1. **Non-wildcard cell**: Click an `R` cell → popover shows → select `RW` → save → cell turns green (`RW`)
2. **Wildcard-derived cell**: Click a cell derived from `*` → warning appears → click "Remove Wildcard & Edit" → select new level → save → cell updates
3. **`* (all)` column**: Click sentinel column cell → change wildcard → save → affected cells update
4. **Click outside**: Popover closes without saving
5. **Cancel**: Popover closes, no changes
6. **Empty access cell (`-`)**: Click → select `R` → save → cell turns blue
7. **Refresh**: After save, data re-loads and matrix reflects new state

---

## Acceptance criteria

- [ ] Clicking any non-sentinel matrix cell opens `CellEditPopover` at or near the cell
- [ ] Popover shows credential name, role name, current access level
- [ ] Four options: RW, R, W, None — color-coded to match MatrixCell palette
- [ ] Save calls `API.setCredentialRoles` with correct role arrays
- [ ] On success, cell re-renders with updated access level
- [ ] Wildcard-derived cells show warning + "Remove Wildcard & Edit" option
- [ ] `* (all)` sentinel column shows wildcard-specific options (Wildcard Read/Write/Both/None)
- [ ] Click outside popover closes it without saving
- [ ] Cancel button closes without saving
- [ ] Popover positions correctly (doesn't overflow viewport)
- [ ] `isWildcardDerived` cells display a `*` suffix indicator in the matrix
