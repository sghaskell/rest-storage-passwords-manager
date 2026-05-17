# Fix React Error #130 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix React error #130 ("Objects are not valid as a React child") that crashes CredentialTable on initial render, preventing credentials from displaying in Splunk UI.

**Architecture:** Root cause is CJS import chain: three `require()` calls in CredentialTable.jsx return full module objects instead of component functions via `.default`. When `React.createElement(ModuleObject, ...)` executes, React throws #130 because ModuleObject isn't a string/Function/Class. Same pattern affects CredentialForm.jsx (latent—crashes only when form modal opens). Bundle.jsx references Modal.jsx components but never imports them; they're undefined at runtime. Fix: apply consistent `.default` extraction per INTENT.md CJS pattern across all components; wire broken modal references; clean dead code in Modal.jsx.

**Tech Stack:** React 18, @splunk/react-ui 5.9.1, Webpack 5, Splunk REST API (Docker 10.2.2 runtime)

---

## Hard Rails (from INTENT.md — inherited by all subagents)
- Always use JS version (`password-crud.js`) as reference when stuck; line numbers matter
- always check Splunk React docs: https://splunkui.splunk.com/Packages/react-ui/Overview
- always ask if unclear of intent, don't assume

## Critical Patterns
- CJS import: `var Mod = require('@splunk/react-ui/X'); var Comp = Mod.default;`
- ACL path via `/configs/conf-passwords/credential:${realm}:${username}:`
- User-scoped credentials require temp `user -> app` sharing bump for password reveal and deletion
- Update sequence: ACL bump sharing=app -> POST password only -> /move if app changed -> final ACL
- Delete sequence: per-credential ACL bump -> DELETE via explicit owner/app path

## Resources
- Splunk React UI docs: https://splunkui.splunk.com/Packages/react-ui/Overview
- JS reference implementation: `password-crud.js` (behavioral parity source)

---

### Task 1: Fix CredentialTable.jsx imports — resolve error #130 root cause

**Goal:** Extract `.default` from Paginator, Chip, and Button requires so React.createElement receives actual component functions instead of module objects.

**Files:**
- Modify: `appserver/static/react/components/CredentialTable.jsx:18-20`

- [ ] **Step 1: Fix require calls — add .default extraction**

Replace lines 18-20 with CJS pattern:

```javascript
var PaginatorMod = require('@splunk/react-ui/Paginator');
var Paginator = PaginatorMod.default;
var ChipMod = require('@splunk/react-ui/Chip');
var Chip = ChipMod.default;
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
```

**Before (broken):**
```javascript
var Paginator = require('@splunk/react-ui/Paginator');
var Chip = require('@splunk/react-ui/Chip');
var Button = require('@splunk/react-ui/Button');
```

- [ ] **Step 2: Build and verify no errors**

Run: `npm run build`
Expected: Clean production bundle at 1.08 MB (no size change expected)

- [ ] **Step 3: Deploy to Splunk Docker**

Run: `./bin/deploy.sh splunk`
Expected: Successful deployment, Splunk restarts, no console errors on page load

- [ ] **Step 4: Verify table renders without React error #130**

Navigate to: `http://localhost:8000/en-US/app/rest-storage-passwords-manager/credential_management`
Expected: Credentials table loads with data; browser console shows "Credential Manager: Render complete" with zero errors. Table actions (Edit, Reveal, Delete buttons) visible for each row.

---

### Task 2: Fix CredentialForm.jsx imports — prevent latent crash on form open

**Goal:** Apply `.default` to Text and Switch requires so form modal doesn't crash when opened (same bug pattern, different trigger).

**Files:**
- Modify: `appserver/static/react/components/CredentialForm.jsx:11,13`

- [ ] **Step 1: Fix Text import**

Replace line 11:
```javascript
var Text = require('@splunk/react-ui/Text');
```
With:
```javascript
var TextMod = require('@splunk/react-ui/Text');
var Text = TextMod.default;
```

- [ ] **Step 2: Fix Switch import**

Replace line 13:
```javascript
var Switch = require('@splunk/react-ui/Switch');
```
With:
```javascript
var SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
```

- [ ] **Step 3: Build + deploy**

Run: `npm run build && ./bin/deploy.sh splunk`
Expected: Clean build, no deployment errors

- [ ] **Step 4: Verify form modal opens and renders controls**

Open app -> click "Create Credential" button -> form modal should appear with all text inputs, select dropdowns, password toggle switch, and Cancel/Create buttons. No React errors in console.

---

### Task 3: Wire Modal.jsx components into bundle.jsx — fix undefined references

**Goal:** Import PasswordRevealModal, ConfirmDeleteModal, and ImportCSVModal from Modal.jsx so they're defined when conditionally rendered in CredentialManager. Currently `showPasswordModal && React.createElement(PasswordRevealModal, ...)` evaluates to true (boolean) if component is undefined — or ReferenceError depending on scope.

**Files:**
- Modify: `appserver/static/react/bundle.jsx` (add import after line 23)

- [ ] **Step 1: Add Modal.jsx import**

After the existing `const API = require('./api');` line (~line 23), add:
```javascript
const { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal } = require('./components/Modal');
```

- [ ] **Step 2: Build + deploy**

Run: `npm run build && ./bin/deploy.sh splunk`
Expected: Clean build, imports resolve via webpack (Modal.jsx already has valid module.exports at line 502)

- [ ] **Step 3: Verify all modals function**

Test flow:
- Click "Reveal" button on a credential -> PasswordRevealModal opens with password fetch
- Click "Delete" button on a credential -> ConfirmDeleteModal prompts confirmation
- Click "Import CSV" -> ImportCSVModal shows drag/drop zone (already wired, won't change behavior but now properly defined)

Browser console: no ReferenceError or React warnings for any modal interaction.

---

### Task 4: Clean dead code in Modal.jsx — remove merge artifact L278-456

**Goal:** Remove orphaned code block (179 lines of duplicate/legacy implementation) that survived a migration merge. Block contains a stray `}` on line 278 and duplicated functions outside any parent scope. While unreachable (file exports intact), it bloats the bundle and signals poor hygiene.

**Files:**
- Modify: `appserver/static/react/components/Modal.jsx:278-456`

- [ ] **Step 1: Remove lines 278-456**

Delete the entire block from line 278 through line 456 (the orphan section starting with a stray `}` and ending before the ConfirmDeleteModal doc comment). ConfirmDeleteModal begins at its current position (after deletion) with no gaps. The file should go from ImportCSVModal's closing `);` on L277 directly into the ConfirmDeleteModal JSDoc block (`/** ConfirmDeleteModal ... */`).

- [ ] **Step 2: Verify file ends with correct export**

Verify line structure is now:
```javascript
// ImportCSVModal closing );  (line ~277)
                    // ── Select phase end
                ),
            ),
        )
    );                      <-- ImportCSVModal's return statement ends here
}                           <-- ImportCSVModal function closes

/** ConfirmDeleteModal ... */   <-- no dead code between them
function ConfirmDeleteModal({ credential, isOpen, onClose, onDelete }) { ... }

module.exports = { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal };
```

- [ ] **Step 3: Build + verify clean**

Run: `npm run build`
Expected: Bundle size decreases (~50 KB saved from dead code elimination), no errors. `npm test` if available for structural checks.

---

### Task 5: Fix Modal.jsx Button import — ensure destructured import works

**Goal:** Verify Modal.jsx's Button import (`const { Button } = require('@splunk/react-ui');` on line 11) doesn't have the same `.default` issue. If `require('@splunk/react-ui')` returns a named exports object where `Button` is a function directly, this is fine. If it returns `{ default: { Button: ... } }`, we need to fix it too.

**Files:**
- Modify: `appserver/static/react/components/Modal.jsx:11` (only if needed after investigation)

- [ ] **Step 1: Investigate Modal.jsx Button import**

Check if the barrel import `require('@splunk/react-ui')` provides named exports or a default wrapper. The INTENT.md `.d.ts` evidence says CJS pattern is `var Mod = require('@splunk/react-ui/X'); var Comp = Mod.default;` for individual component paths. For barrel imports, Splunk's bundler may expose named exports directly — verify after build.

- [ ] **Step 2: If broken during Task 3 verification, fix with CJS pattern**

Replace line 11 with:
```javascript
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
```

Only apply this change if Buttons in modal footers render as `[object Object]` or cause React warnings during Task 3 verification. Otherwise skip — barrel import may resolve correctly via Splunk's webpack aliases.

---

## Self-Review Checklist (run before marking complete)

1. **Spec coverage:**
   - [x] Error #130 root cause: Task 1 fixes CredentialTable.jsx missing `.default`
   - [x] Modal references undefined: Task 3 wires Modal.jsx into bundle.jsx
   - [x] Dead code in Modal.jsx: Task 4 removes merge artifact
   - [x] Latent form crash pattern: Task 2 fixes CredentialForm.jsx
   - [x] Build passes clean, deploy works: covered in each task's verify step

2. **No placeholders:** All steps contain actual code changes, commands, and expected outputs. No TBDs.

3. **Type consistency:** All CJS imports use identical pattern: `var XMod = require('@splunk/react-ui/X'); var X = XMod.default;`. No mixing `const`/`var` for same module within a file (matches existing codebase style).

4. **INTENT.md compliance:**
   - [x] REST API behavior not modified (only UI component imports fixed)
   - [x] CJS import pattern matches INTENT.md ratified decision
   - [x] No new scope beyond debugging task (LOOP.md DoD items 1-2)

5. **Order safety:** Tasks 1 and 2 can run in parallel (files don't overlap). Task 3 depends on clean build from Task 1+2. Task 4 is independent cleanup.

## Execution Options

**Plan saved to:** `docs/superpowers/plans/2026-05-07-fix-react-error-130.md`

1. **Subagent-Driven (recommended)** — dispatch fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in this session with checkpoints

Which approach?
