# Splunk React UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all bespoke UI elements (table, modals, forms, buttons) from raw HTML with inline styles to @splunk/react-ui components (~5.9.1), while preserving exact behavior parity with password-crud.js.

**Architecture:** Replace each bespoke component incrementally per file. All code uses `React.createElement()` (not JSX). Each task migrates one concern, verifies build succeeds, and tests in Splunk. No changes to api.js — API layer is out of scope. Migration order follows INTENT.md: parity lock first, then component swap.

**Tech Stack:** React 18.2, @splunk/react-ui 5.9.1, styled-components (peer dep, already installed), webpack 5.106 with babel-loader + classic JSX runtime preset.

---

### Task 1: Verify styled-components compatibility and webpack rebuild

**Files:**
- Modify: `webpack.config.js` (verify no changes needed)
- Create: `appserver/static/react/test-splunk-ui.jsx` (temporary, deleted after test)
- Test: Visual verification in Splunk or standalone mode

  - [ ] **Step 1: Confirm styled-components is available as a resolved dependency**

  Run: `node -e "require('styled-components'); console.log('OK')"
  Expected: prints 'OK' without error. If error, run `npm install styled-components`.

  - [ ] **Step 2: Write a minimal test bundle that imports Splunk UI components**

Write `appserver/static/react/test-splunk-ui.jsx`:
```js
const React = require('react');
const ReactDOM = require('react-dom/client');
const { Button, Text } = require('@splunk/react-ui');

function TestApp() {
    return React.createElement('div', null,
        React.createElement(Button, { appearance: 'primary' }, 'Splunk UI OK'),
        React.createElement(Text, null, 'styled-components working')
    );
}

if (document.getElementById('test-splunk-ui')) {
    const root = ReactDOM.createRoot(document.getElementById('test-splunk-ui'));
    root.render(React.createElement(TestApp));
}
```

  - [ ] **Step 3: Build the normal bundle and verify no errors**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds, `bundle.js` is generated, no styled-components or @splunk/react-ui related errors.

  - [ ] **Step 4: Delete test file**

Run: `rm appserver/static/react/test-splunk-ui.jsx`

  - [ ] **Step 5: Commit**

```bash
git add webpack.config.js
git commit -m "chore: verify @splunk/react-ui and styled-components work with current build"
```

---

### Task 2: Migrate buttons in bundle.jsx — ButtonLike, toolbar buttons, error retry button

**Files:**
- Modify: `appserver/static/react/bundle.jsx` (ButtonLike function ~L536-541, all toolbar buttons ~L403-414, error retry ~L397)
- Test: Build + visual verification in Splunk browser

  - [ ] **Step 1: Import Button and ButtonGroup from @splunk/react-ui**

At the top of bundle.jsx (after existing require statements at ~L8-15), add Button import:
```js
const { Button } = require('@splunk/react-ui');
```

  - [ ] **Step 2: Replace ButtonLike function with direct Button usage**

Delete the `ButtonLike` function definition (~L536-541):
```js
// DELETE THIS:
function ButtonLike({ onClick, appearance, children }) {
    const styles = appearance === 'primary'
        ? { padding: '0.5rem 1.5rem', backgroundColor: '#0052cc', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }
        : { padding: '0.5rem 1rem', backgroundColor: 'transparent', color: '#6b778c', border: 'none', borderRadius: '4px', cursor: 'pointer' };
    return React.createElement('button', { onClick, style: styles }, children);
}
```

No need for a replacement function — we'll convert each usage site directly to use `Button`.

  - [ ] **Step 3: Update ResultModal Close button (~L529)**

Find the ButtonLike usage in ResultModal (~L529):
```js
React.createElement(ButtonLike, { onClick: onClose, appearance: 'primary', children: 'Close' })
```
Replace with:
```js
React.createElement(Button, { onClick: () => onClose(), appearance: 'primary', children: 'Close' }, null)
```

Note: Splunk Button uses `children` as first child slot OR `label` prop. We use `{ appearance: 'primary', children: 'Close' }`.

  - [ ] **Step 4: Update toolbar buttons (~L403-414)**

Replace the toolbar button block at ~L405-414:
```js
React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
    selectedRows.length > 0 && React.createElement('span', { style: { color: '#666', fontSize: '14px' } }, `${selectedRows.length} selected`),
    selectedRows.length > 0 && React.createElement(Button, {
        onClick: handleBulkDeleteConfirm,
        appearance: 'destructive',
        children: `Delete Selected (${selectedRows.length})`
    }),
    React.createElement(Button, { onClick: handleDownloadTemplate, children: 'Download Template' }),
    React.createElement(Button, { onClick: () => setShowImportModal(true), children: 'Import CSV' }),
    React.createElement(Button, { onClick: () => { setEditingCredential(null); setShowFormModal(true); }, appearance: 'primary', children: 'Create Credential' })
)
```

  - [ ] **Step 5: Update error retry button (~L397)**

Find the Retry button in the error block:
```js
React.createElement('button', { onClick: loadCredentials, style: { padding: '0.5rem 1rem', cursor: 'pointer' } }, 'Retry')
```
Replace with:
```js
React.createElement(Button, { onClick: loadCredentials, children: 'Retry' })
```

Note: The error state `div` can keep its custom inline styles temporarily since MessageBar migration is deferred. We're only swapping the button here.

  - [ ] **Step 6: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds, no errors. No references to ButtonLike remain.

  - [ ] **Step 7: Commit**

```bash
git add appserver/static/react/bundle.jsx
git commit -m "feat(ui): replace bespoke buttons in bundle.jsx with @splunk/react-ui Button"
```

---

### Task 3: Migrate ConfirmDeleteModal to Splunk Modal

**Files:**
- Modify: `appserver/static/react/components/Modal.jsx` (~L280-316, ConfirmDeleteModal function)
- Test: Build + visual verification in Splunk — delete flow should show modal with proper close behavior

  - [ ] **Step 1: Add Modal and Button imports to Modal.jsx**

At top of Modal.jsx (after `const React = require('react');` at L5), add:
```js
const { Modal, Button } = require('@splunk/react-ui');
```

  - [ ] **Step 2: Replace ConfirmDeleteModal implementation (~L280-316)**

Delete the existing function and replace with:
```js
function ConfirmDeleteModal({ credential, isOpen, onClose, onDelete }) {
    if (!isOpen) return null;

    // Splunk Modal requires a returnFocus prop — ref or callback
    const prevRef = React.useRef(null);
    React.useEffect(() => {
        prevRef.current = document.activeElement;
    }, [credential]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    return React.createElement(Modal, {
        open: isOpen,
        onRequestClose: function(data) { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: credential ? '400px' : '600px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            // Header
            React.createElement(Modal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, credential ? 'Delete Credential' : '')
            ),
            // Body
            React.createElement(Modal.Body, null,
                React.createElement('p', null,
                    'Are you sure you want to delete the credential ',
                    React.createElement('strong', null, credential ? credential.name : ''),
                    '? This action cannot be undone.'
                )
            ),
            // Footer
            React.createElement(Modal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, children: 'Cancel' }),
                React.createElement(Button, { onClick: onDelete, appearance: 'destructive', children: 'Delete' })
            )
        )
    );
}
```

Note: The original `ConfirmDeleteModal` checked `isOpen` at the top. We keep that guard. The Modal component handles fixed overlay, backdrop, and close button automatically.

  - [ ] **Step 3: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds without errors. ConfirmDeleteModal renders with Splunk Modal styling (backdrop, header/body/footer sections, proper z-index).

  - [ ] **Step 4: Commit**

```bash
git add appserver/static/react/components/Modal.jsx
git commit -m "feat(ui): migrate ConfirmDeleteModal to @splunk/react-ui Modal"
```

---

### Task 4: Migrate PasswordRevealModal to Splunk Modal

**Files:**
- Modify: `appserver/static/react/components/Modal.jsx` (~L10-67, PasswordRevealModal function)
- Test: Build + visual verification in Splunk — reveal flow should show modal with fetch indicator and password display

  - [ ] **Step 1: Replace PasswordRevealModal implementation (~L10-67)**

Delete the existing function and replace with:
```js
function PasswordRevealModal({ credential, onClose }) {
    const [password, setPassword] = React.useState('');
    const [loading, setLoading] = React.useState(true);

    const prevRef = React.useRef(null);

    React.useEffect(() => {
        prevRef.current = document.activeElement;
    }, [credential]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    React.useEffect(() => {
        if (credential) {
            async function fetchPassword() {
                try {
                    const { getCredentialPassword } = require('../api');
                    const clearPassword = await getCredentialPassword(
                        credential.name, credential.realm,
                        credential.app || 'search', credential.owner || 'nobody', credential.sharing || 'app'
                    );
                    setPassword(clearPassword || '(unable to retrieve)');
                } catch (error) {
                    console.error('Error fetching password:', error);
                    setPassword('(error retrieving password)');
                } finally {
                    setLoading(false);
                }
            }
            fetchPassword();
        }
    }, [credential]);

    if (!credential) return null;

    return React.createElement(Modal, {
        open: true,
        onRequestClose: function(data) { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '400px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            React.createElement(Modal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, 'Password for ' + credential.name)
            ),
            React.createElement(Modal.Body, null,
                loading
                    ? React.createElement('p', null, 'Loading...')
                    : React.createElement(Text, {
                        value: password,
                        type: 'password',
                        disabled: true,
                        inputClassName: 'monospace-password',
                        inline: false
                    }, '')
            ),
            React.createElement(Modal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, children: 'Close' })
            )
        )
    );
}
```

Note: We need to add `Text` to the imports at top of Modal.jsx. Update the import from Step 3 to include Text:
```js
const { Modal, Button, Text } = require('@splunk/react-ui');
```

The original used `type='password'` and `readOnly`. Splunk Text doesn't have a `type` prop that maps to password input — instead we can use a native `<input>` for this specific readonly case wrapped in the modal body. Since we only need a readonly display, let's use:
```js
React.createElement('input', {
    type: 'password', value: password, readOnly: true, disabled: true,
    style: { width: '100%', padding: '0.5rem', fontFamily: 'monospace' },
})
```
This is acceptable — the modal itself uses Splunk UI; only the readonly password input in this one spot remains native because Splunk Text's password toggle behavior doesn't match our readonly-only use case.

  - [ ] **Step 2: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds, Modal structure works for PasswordRevealModal.

  - [ ] **Step 3: Commit**

```bash
git add appserver/static/react/components/Modal.jsx
git commit -m "feat(ui): migrate PasswordRevealModal to @splunk/react-ui Modal"
```

---

### Task 5: Migrate ImportCSVModal to Splunk Modal with SimpleTable

**Files:**
- Modify: `appserver/static/react/components/Modal.jsx` (~L75-275, ImportCSVModal function)
- Test: Build + visual verification — drag/drop zone, preview table with imported data, import/back buttons

  - [ ] **Step 1: Replace ImportCSVModal implementation**

The existing function (L75-275) has two phases ('select' and 'preview'). Both should use Modal. The preview phase currently uses a native `<table>` for the preview — this can remain as a simple table since it's an internal preview, not the main CredentialTable. Alternatively, we could use `SimpleTable` here but SimpleTable is designed for key-value pairs. We'll keep the preview table native to preserve drag-drop functionality and avoid complexity.

Delete the existing ImportCSVModal function and replace with:
```js
function ImportCSVModal({ isOpen, onClose, onImport }) {
    const [dragActive, setDragActive] = React.useState(false);
    const [file, setFile] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [fileError, setFileError] = React.useState('');
    const fileInputRef = React.useRef(null);

    const [phase, setPhase] = React.useState('select');
    const [parsedRows, setParsedRows] = React.useState([]);
    const [parseErrors, setParseErrors] = React.useState([]);

    const prevRef = React.useRef(null);
    const MAX_CSV_SIZE = 512 * 1024;

    React.useEffect(() => {
        if (isOpen) {
            prevRef.current = document.activeElement;
        }
    }, [isOpen]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    function handleDrag(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragActive(true);
        } else if (e.type === 'dragleave') {
            setDragActive(false);
        }
    }

    function handleDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            pickFile(e.dataTransfer.files[0]);
        }
    }

    function handleChange(e) {
        if (e.target.files && e.target.files[0]) {
            pickFile(e.target.files[0]);
        }
        if (e.target) e.target.value = '';
    }

    function pickFile(fileObj) {
        setFileError('');
        setPhase('select');
        if (fileObj.size > MAX_CSV_SIZE) {
            setFileError('File too large (' + Math.floor(fileObj.size / 1024) + ' KB). Maximum allowed size is 512 KB.');
            return;
        }
        setFile(fileObj);

        const reader = new FileReader();
        reader.onload = function(e) {
            var parsed = require('../api').parseCSV(e.target.result);
            setParsedRows(parsed.rows);
            setParseErrors(parsed.errors);
            setPhase('preview');
        };
        reader.readAsText(fileObj);
    }

    async function handleImport() {
        if (parsedRows.length === 0) return;
        setLoading(true);
        await onImport(parsedRows, parseErrors);
        setLoading(false);
        onClose();
    }

    function resetState() {
        setFile(null);
        setParsedRows([]);
        setParseErrors([]);
        setFileError('');
        setPhase('select');
    }

    // ── Preview phase ──
    if (phase === 'preview') {
        var headerLabels = ['Username', 'Realm', 'Password', 'App', 'Owner', 'Sharing', 'Read', 'Write'];
        return React.createElement(Modal, {
            open: true,
            onRequestClose: function() { resetState(); onClose(); },
            returnFocus: handleReturnFocus,
            divider: 'both',
            style: { width: '820px', maxWidth: '95%', maxHeight: '90vh', overflow: 'auto' }
        },
            React.createElement('div', null,
                React.createElement(Modal.Header, null,
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: 500 } }, 'Import Preview - ' + parsedRows.length + ' credential' + (parsedRows.length !== 1 ? 's' : ''))
                ),
                React.createElement(Modal.Body, null,
                    parseErrors.length > 0 && React.createElement('div', { style: { backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginBottom: '1rem', color: '#856404' } },
                        parseErrors.map(function(err, i) { return React.createElement('div', { key: i }, '\u26a0 ', err); })
                    ),
                    parsedRows.length > 0 ? React.createElement('p', { style: { margin: '0 0 8px' } }, '<b>' + parsedRows.length + '</b> credential' + (parsedRows.length !== 1 ? 's' : '') + ' ready to import.')
                        : React.createElement('div', { style: { backgroundColor: '#fff5f5', color: '#d32f2f', border: '1px solid #de350b', borderRadius: '4px', padding: '0.5rem 0.75rem' } }, 'No valid rows to import.'),
                    parsedRows.length > 0 && React.createElement('div', { style: { maxHeight: '300px', overflowY: 'auto', marginTop: '8px', border: '1px solid #e0e0e0' } },
                        React.createElement('table', { style: { width: '100%', borderWidth: 0, fontSize: '12px', color: '#172b4d' } },
                            React.createElement('thead', null,
                                React.createElement('tr', { style: { textAlign: 'left', borderBottom: '2px solid #e0e0e0' } },
                                    headerLabels.map(function(h) {
                                        return React.createElement('th', { key: h, style: { padding: '6px 8px', fontWeight: 500 } }, h);
                                    })
                                )
                            ),
                            React.createElement('tbody', null,
                                parsedRows.map(function(row, idx) {
                                    return React.createElement('tr', { key: idx, style: { textAlign: 'left', borderBottom: '1px solid #eee' } },
                                        React.createElement('td', { style: { padding: '4px 8px' } }, row.username || ''),
                                        React.createElement('td', { style: { padding: '4px 8px' } }, row.realm || ''),
                                        React.createElement('td', { style: { padding: '4px 8px' } }, '\u2022\u2022\u2022\u2022\u2022'),
                                        React.createElement('td', { style: { padding: '4px 8px' } }, row.app || ''),
                                        React.createElement('td', { style: { padding: '4px 8px' } }, row.owner || ''),
                                        React.createElement('td', { style: { padding: '4px 8px' } }, row.sharing || ''),
                                        React.createElement('td', { style: { padding: '4px 8px', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.read || ''),
                                        React.createElement('td', { style: { padding: '4px 8px', maxWidth: '80px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.write || '')
                                    );
                                })
                            )
                        )
                    )
                ),
                React.createElement(Modal.Footer, { itemAlign: 'end' },
                    React.createElement(Button, { onClick: resetState, children: 'Back' }),
                    React.createElement(Button, {
                        onClick: handleImport,
                        appearance: 'primary',
                        disabled: parsedRows.length === 0 || loading,
                        children: loading ? 'Importing...' : 'Import ' + parsedRows.length + ' credential' + (parsedRows.length !== 1 ? 's' : '')
                    })
                )
            )
        );
    }

    // ── Select phase ──
    return React.createElement(Modal, {
        open: isOpen,
        onRequestClose: function() { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '500px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            React.createElement(Modal.Header, null,
                React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: 500 } }, 'Import Credentials from CSV')
            ),
            React.createElement(Modal.Body, null,
                React.createElement('p', null, 'Drag and drop your CSV file here, or click to select.'),
                React.createElement('input', { ref: fileInputRef, type: 'file', accept: '.csv', onChange: handleChange, style: { display: 'none' }}),
                React.createElement('div', {
                    onDragEnter: handleDrag, onDragLeave: handleDrag, onDragOver: handleDrag, onDrop: handleDrop,
                    onClick: function() { if (fileInputRef.current) fileInputRef.current.click(); },
                    style: { border: (dragActive ? '2px solid #0066cc' : '2px dashed #ccc'), borderRadius: '4px', padding: '3rem 1.5rem', textAlign: 'center', backgroundColor: dragActive ? '#f0f7ff' : '#fff', marginTop: '1rem', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }
                },
                    file ? React.createElement('p', null, file.name) : React.createElement(React.Fragment, null,
                        React.createElement('p', { style: { margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#555' } }, '\u2B07'),
                        React.createElement('p', { style: { margin: '4px 0 0', fontSize: '13px', color: '#888' } }, 'Click to select or drag file')
                    )
                ),
                fileError && React.createElement('div', { style: { backgroundColor: '#fff5f5', color: '#d32f2f', border: '1px solid #de350b', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginTop: '0.75rem' } }, fileError)
            ),
            React.createElement(Modal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, children: 'Cancel' })
            )
        )
    );
}
```

Note: The preview `<table>` inside the modal body remains as a native table. This is intentional — it's an internal data preview that only exists while the modal is open, and migrating this specific small nested table to Splunk Table would add significant complexity for no UX gain. The DoD's "no bespoke table" refers to the main CredentialTable.

  - [ ] **Step 2: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds, ImportCSVModal renders with Splunk Modal structure for both phases.

  - [ ] **Step 3: Commit**

```bash
git add appserver/static/react/components/Modal.jsx
git commit -m "feat(ui): migrate ImportCSVModal to @splunk/react-ui Modal"
```

---

### Task 6: Migrate bundle.jsx FormModal and ResultModal to Splunk Modal + MessageBar

**Files:**
- Modify: `appserver/static/react/bundle.jsx` (FormModal ~L481-503, ResultModal ~L509-533)
- Test: Build + visual verification — form modal shows CredentialForm inside Splunk Modal; result modal shows structured messages

  - [ ] **Step 1: Add Modal and MessageBar imports to bundle.jsx**

Update the @splunk/react-ui import at top of bundle.jsx (added in Task 3):
```js
const { Button, Modal, MessageBar } = require('@splunk/react-ui');
```

  - [ ] **Step 2: Replace FormModal (~L481-503)**

Delete the existing FormModal function and replace with:
```js
function FormModal({ isOpen, onClose, title, children }) {
    if (!isOpen) return null;

    const prevRef = React.useRef(null);
    React.useEffect(() => {
        prevRef.current = document.activeElement;
    }, []);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    return React.createElement(Modal, {
        open: isOpen,
        onRequestClose: function(data) { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '600px', maxWidth: '95%', maxHeight: '90vh', overflow: 'auto' }
    },
        React.createElement('div', null,
            React.createElement(Modal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, title || 'Create/Edit Credential')
            ),
            React.createElement(Modal.Body, null, children)
        )
    );
}
```

  - [ ] **Step 3: Replace ResultModal (~L509-533)**

Delete the existing ResultModal function and replace with:
```js
function ResultModal({ title, messages, onClose }) {
    const prevRef = React.useRef(null);
    React.useEffect(() => {
        prevRef.current = document.activeElement;
    }, []);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    return React.createElement(Modal, {
        open: true,
        onRequestClose: function(data) { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '500px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            React.createElement(Modal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, title)
            ),
            React.createElement(Modal.Body, null,
                messages.map((msg, i) => {
                    if (msg === '<br/>' || msg.startsWith('<br/>-')) {
                        return React.createElement('hr', { key: i, style: { margin: '0.75rem 0', border: 'none', borderTop: '1px solid #e0e0e0' } });
                    }
                    if (msg.startsWith('ERROR')) {
                        return React.createElement(MessageBar, {
                            key: i, title: 'Error', displayStyle: 'inline', variant: 'error', dismissable: false, inline: true
                        }, msg);
                    }
                    return React.createElement(MessageBar, {
                        key: i, displayStyle: 'inline', variant: 'info', dismissable: false, inline: true
                    }, msg);
                })
            ),
            React.createElement(Modal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, appearance: 'primary', children: 'Close' })
            )
        )
    );
}
```

Note: This replaces bespoke `dangerouslySetInnerHTML` usage with MessageBar components. The original ResultModal used innerHTML for some messages — MessageBar renders text content safely. If any message contains HTML that needs rendering, we'd fall back to Text with children. For now, using MessageBar children (text) is the safe approach since DISCOVERIES.md notes this as a parked sanitization issue.

  - [ ] **Step 4: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds, both modals render with Splunk Modal structure. MessageBar renders for result messages without dangerouslySetInnerHTML.

  - [ ] **Step 5: Commit**

```bash
git add appserver/static/react/bundle.jsx
git commit -m "feat(ui): migrate FormModal and ResultModal to @splunk/react-ui Modal + MessageBar"
```

---

### Task 7: Migrate CredentialTable to Splunk Table with Head/Body/Row/Cell + Paginator

**Files:**
- Modify: `appserver/static/react/components/CredentialTable.jsx` (entire component, ~L23-L441)
- Test: Build + visual verification — table renders credentials with sorting, filtering, pagination; badges visible on realm/app columns

  - [ ] **Step 1: Add Splunk Table imports to CredentialTable.jsx**

At top of CredentialTable.jsx (after `const React = require('react');` at L7), add:
```js
var TableComponents = require('@splunk/react-ui/Table');
var Table = TableComponents.default;
var TableHead = TableComponents.Head;
var TableBody = TableComponents.Body;
var TableCell = TableComponents.Cell;
var TableRow = TableComponents.Row;
var TableHeadCell = TableComponents.HeadCell;
var Paginator = require('@splunk/react-ui/Paginator');
var Chip = require('@splunk/react-ui/Chip');
```

We use var instead of destructuring because CommonJS default + named exports from bundled modules can have issues with `const { Head, Body } = ...`. This is the safest import pattern for this codebase.

  - [ ] **Step 2: Replace CredentialTable implementation (L23-L441)**

Delete the entire function and replace with:
```js
function CredentialTable({
    credentials = [],
    selectedRows = [],
    isAllSelected = false,
    onEdit,
    onDelete,
    onReveal,
    onSelectRow,
    onSelectAll,
    onDeselectAll,
}) {
    const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });
    const [currentPage, setCurrentPage] = React.useState(1);
    const [filterText, setFilterText] = React.useState('');
    const [filterType, setFilterType] = React.useState('all');

    const itemsPerPage = 10;

    const filteredCredentials = React.useMemo(function() {
        if (!filterText) return credentials;
        return credentials.filter(function(credential) {
            var name = credential.name || '';
            var realm = credential.realm || '';
            var app = credential.app || '';
            var owner = credential.owner || '';

            if (filterType === 'all') {
                return name.toLowerCase().includes(filterText.toLowerCase()) ||
                    realm.toLowerCase().includes(filterText.toLowerCase()) ||
                    app.toLowerCase().includes(filterText.toLowerCase()) ||
                    owner.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'username') {
                return name.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'realm') {
```

NOTE: This task is complex and the replacement is large. Below is the complete replacement for CredentialTable.jsx. The subagent should write this as a single file replacement using the Write tool, since the entire function body changes significantly.

Write the full file content for `appserver/static/react/components/CredentialTable.jsx`:
```js
/**
 * CredentialTable.jsx - Table component for displaying credentials
 *
 * Displays credentials in a table with pagination, filtering, sorting, and selection
 * Uses @splunk/react-ui Table + Paginator + Chip components
 */

const React = require('react');
var TableMod = require('@splunk/react-ui/Table');
var Table = TableMod.default;
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;
var Paginator = require('@splunk/react-ui/Paginator');
var Chip = require('@splunk/react-ui/Chip');
var Checkbox = require('@splunk/react-ui/Checkbox');

function CredentialTable({
    credentials = [],
    selectedRows = [],
    isAllSelected = false,
    onEdit,
    onDelete,
    onReveal,
    onSelectRow,
    onSelectAll,
    onDeselectAll,
}) {
    const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });
    const [currentPage, setCurrentPage] = React.useState(1);
    const [filterText, setFilterText] = React.useState('');
    const [filterType, setFilterType] = React.useState('all');

    const itemsPerPage = 10;

    const filteredCredentials = React.useMemo(function() {
        if (!filterText) return credentials;
        return credentials.filter(function(credential) {
            var name = credential.name || '';
            var realm = credential.realm || '';
            var app = credential.app || '';
            var owner = credential.owner || '';

            if (filterType === 'all') {
                return name.toLowerCase().includes(filterText.toLowerCase()) ||
                       realm.toLowerCase().includes(filterText.toLowerCase()) ||
                       app.toLowerCase().includes(filterText.toLowerCase()) ||
                       owner.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'username') {
                return name.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'realm') {
                return realm.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'app') {
                return app.toLowerCase().includes(filterText.toLowerCase());
            }
            return true;
        });
    }, [credentials, filterText, filterType]);

    const sortedCredentials = React.useMemo(function() {
        if (!sortConfig.key) return filteredCredentials;
        return [...filteredCredentials].sort(function(a, b) {
            var aValue = a[sortConfig.key] || '';
            var bValue = b[sortConfig.key] || '';
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredCredentials, sortConfig.key, sortConfig.direction]);

    const paginatedCredentials = React.useMemo(function() {
        var startIndex = (currentPage - 1) * itemsPerPage;
        return sortedCredentials.slice(startIndex, startIndex + itemsPerPage);
    }, [sortedCredentials, currentPage]);

    const totalPages = Math.ceil(sortedCredentials.length / itemsPerPage);
    const pageStartNum = totalPages > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
    const pageEndNum = Math.min(currentPage * itemsPerPage, sortedCredentials.length);

    const handleSort = function(key) {
        var direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key: key, direction: direction });
    };

    const handlePageChange = function(page) {
        setCurrentPage(page);
    };

    const getSortIndicator = function(key) {
        return sortConfig.key === key ? (sortConfig.direction === 'asc' ? '\u2191' : '\u2193') : '';
    };

    const isSelected = function(cred) {
        return selectedRows.some(function(r) { return r.stanzaKey === cred.stanzaKey; });
    };

    const handleToggleSelect = function(cred, e) {
        if (e && e.stopPropagation) e.stopPropagation();
        onSelectRow && onSelectRow(cred);
    };

    const handlePageSelectAll = function(e) {
        if (e && e.stopPropagation) e.stopPropagation();
        if (isAllSelected || paginatedCredentials.every(function(c) { return isSelected(c); })) {
            onDeselectAll && onDeselectAll();
        } else {
            onSelectAll && onSelectAll();
        }
    };

    const renderRealmBadge = function(realm) {
        var label = (!realm || realm === 'nobody') ? 'global' : realm;
        return React.createElement(Chip, {
            label: String(label),
            color: (!realm || realm === 'nobody') ? null : null,
        });
    };

    const renderAppBadge = function(app) {
        return React.createElement(Chip, {
            label: String(app),
        });
    };

    const pageAllSelected = paginatedCredentials.length > 0 && paginatedCredentials.every(function(c) { return isSelected(c); });

    // Build checkbox cells with click handlers that stop propagation
    function createCheckboxCell(checked, onChange) {
        return React.createElement('div', { onClick: onChange },
            React.createElement(Checkbox, {
                checked: checked,
                onChange: function() { onChange(); }
            })
        );
    }

    // Build action cell for each row
    function createActionCell(cred) {
        return React.createElement('div', { style: { display: 'flex', gap: '4px' } },
            React.createElement(Button, { onClick: function() { onEdit && onEdit(cred); }, appearance: 'subtle', children: 'Edit' }),
            React.createElement(Button, { onClick: function() { onReveal && onReveal(cred); }, appearance: 'subtle', children: 'Reveal' }),
            React.createElement(Button, { onClick: function() { onDelete && onDelete(cred); }, appearance: 'destructiveSecondary', children: 'Delete' })
        );
    }

    return React.createElement('div', { className: 'credential-table-container' },
        // Filter bar — keep native inputs for search/select (Splunk Text/Select are inline-form focused)
        React.createElement(
            'div',
            { style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement('strong', null, 'Search:'),
            React.createElement('input', {
                type: 'text',
                value: filterText,
                onChange: function(e) { handleFilterChange(e.target.value); },
                placeholder: 'Search credentials...',
                style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px', minWidth: '200px' }
            }),
            React.createElement('select', {
                value: filterType,
                onChange: function(e) { setFilterType(e.target.value); },
                style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px' }
            },
                React.createElement('option', { value: 'all' }, 'All Fields'),
                React.createElement('option', { value: 'username' }, 'Username'),
                React.createElement('option', { value: 'realm' }, 'Realm'),
                React.createElement('option', { value: 'app' }, 'App')
            )
        ),

        // Credentials table — Splunk Table component
        React.createElement(Table, null,
            React.createElement(TableHead, null,
                React createElement(TableRow, null,
                    React.createElement(TableHeadCell, { onClick: handlePageSelectAll },
                        createCheckboxCell(pageAllSelected || paginatedCredentials.some(function(c) { return isSelected(c); }), handlePageSelectAll)
                    ),
                    React.createElement(TableHeadCell, { onClick: function() { handleSort('name'); } }, 'Username ', getSortIndicator('name')),
                    React.createElement(TableHeadCell, { onClick: function() { handleSort('realm'); } }, 'Realm ', getSortIndicator('realm')),
                    React.createElement(TableHeadCell, { onClick: function() { handleSort('app'); } }, 'App ', getSortIndicator('app')),
                    React.createElement(TableHeadCell, { onClick: function() { handleSort('owner'); } }, 'Owner ', getSortIndicator('owner')),
                    React.createElement(TableHeadCell, null, 'Actions')
                )
            ),
            React.createElement(TableBody, null,
                paginatedCredentials.length > 0
                    ? paginatedCredentials.map(function(cred) {
                        return React.createElement(TableRow, { key: cred.stanzaKey },
                            React.createElement(TableCell, null, createCheckboxCell(isSelected(cred), function() { handleToggleSelect(cred); })),
                            React.createElement(TableCell, null, cred.name || cred.realm),
                            React.createElement(TableCell, null, renderRealmBadge(cred.realm || 'nobody')),
                            React.createElement(TableCell, null, renderAppBadge(cred.app || 'search')),
                            React.createElement(TableCell, null, cred.owner || 'nobody'),
                            React.createElement(TableCell, null, createActionCell(cred))
                        );
                    })
                    : React.createElement(TableRow, null,
                        React.createElement(TableCell, { colSpan: 6 },
                            React.createElement('div', { style: { textAlign: 'center', padding: '2rem', color: '#666' } }, 'No credentials found')
                        )
                    )
            )
        ),

        // Pagination — Splunk Paginator (only when multiple pages)
        totalPages > 1 && React.createElement(Paginator, {
            count: sortedCredentials.length,
            currentIndex: currentPage - 1,
            onSelect: function(data) { handlePageChange(data.index + 1); },
            pageSize: itemsPerPage,
            pageEntries: function(entryIndex) { return String(entryIndex + 1); }
        })
    );
}

// Helper Button import (used only in action cells)
const Button = require('@splunk/react-ui/Button').default;

module.exports = CredentialTable;
```

Wait — there's a syntax error: `React createElement` should be `React.createElement`. Let me fix that line. The correct line is:
```js
React.createElement(TableRow, null,
```

Also, the Button import needs to be at the top with other imports, not at the bottom. The complete corrected import section:
```js
const React = require('react');
var TableMod = require('@splunk/react-ui/Table');
var Table = TableMod.default;
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;
var Paginator = require('@splunk/react-ui/Paginator');
var Chip = require('@splunk/react-ui/Chip');
var Checkbox = require('@splunk/react-ui/Checkbox');
const Button = require('@splunk/react-ui/Button');
```

  - [ ] **Step 3: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds. If there are type mismatches (e.g., Chip color prop, Paginator onSelect data shape), adjust props based on the actual @splunk/react-ui type definitions read in Step 1 of this plan. Common fixes:
  - `Chip` might use `color` as a themed color name instead of hex — if it fails, pass no `color` for default styling.
  - `Paginator.onSelect` might receive different data structure — check the callback payload in browser console and adapt page calculation accordingly.
  - `Checkbox.indeterminate` may not be supported — use `checked` with a CSS class or fallback to native checkbox if indeterminate state is critical.

  - [ ] **Step 4: Verify pagination behavior**

Open the app in Splunk Web UI. Navigate through pages, verify credentials load correctly at each page. Test sorting by clicking headers. Test filtering with text input and field selector. Verify bulk selection still works via checkbox column.

  - [ ] **Step 5: Commit**

```bash
git add appserver/static/react/components/CredentialTable.jsx
git commit -m "feat(ui): migrate CredentialTable to @splunk/react-ui Table + Paginator + Chip"
```

---

### Task 8: Migrate CredentialForm to ControlGroup + Text + Select + Multiselect + Switch

**Files:**
- Modify: `appserver/static/react/components/CredentialForm.jsx` (entire form, ~L0-L385)
- Test: Build + visual verification — create/edit forms render with Splunk components; validation errors display; role selection works with mutual exclusion

  - [ ] **Step 1: Replace entire CredentialForm.jsx**

The full file replacement. Write this complete file for `appserver/static/react/components/CredentialForm.jsx`:
```js
/**
 * CredentialForm.jsx - Form component for creating and updating credentials
 *
 * Uses @splunk/react-ui ControlGroup, Text, Select, Multiselect, Switch, Button
 * Matches legacy password-crud.js field patterns exactly.
 */

const React = require('react');
const Button = require('@splunk/react-ui/Button');
const Checkbox = require('@splunk/react-ui/Checkbox');
const ControlGroup = require('@splunk/react-ui/ControlGroup');
const Multiselect = require('@splunk/react-ui/Multiselect');
const SwitchComp = require('@splunk/react-ui/Switch');
const Select = require('@splunk/react-ui/Select');
const Text = require('@splunk/react-ui/Text');

// Import as namespace since ControlGroup has Label and Help sub-components
var CGMod = require('@splunk/react-ui/ControlGroup');
var ControlGroupLabel = CGMod.default.Label || null;
var ControlGroupHelp = CGMod.default.Help || null;

const SHARING_OPTIONS = [
  { label: 'App-scoped', value: 'app' },
  { label: 'All Apps (Shared globally)', value: 'global' },
  { label: 'User-scoped (Specific users)', value: 'user' },
];

// Helper — wraps Splunk ControlGroup with label, input, help text, error hint
function field(label, inputEl, opt) {
  opt = opt || {};
  var helpText = opt.helpText;
  var errorText = opt.errorText;

  return React.createElement(ControlGroup, { inline: false },
    label && React.createElement('label', { style: { fontWeight: 600, fontSize: '14px' } }, label),
    inputEl,
    errorText && React.createElement('div', { style: { color: '#de350b', fontSize: '12px', marginTop: '4px' } }, errorText),
    helpText && React.createElement('div', { style: { fontSize: '12px', color: '#6b778c', marginTop: '2px' } }, helpText)
  );
}

function CredentialForm({
  credential = null,
  onSave,
  onCancel,
  availableApps = [],
  availableUsers = [],
  currentUserIdentity = 'nobody',
  availableRoles = [],
  defaultReadRoles = '',
  defaultWriteRoles = '',
}) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [realm, setRealm] = React.useState('');
  const [app, setApp] = React.useState('search');
  const [owner, setOwner] = React.useState('nobody');
  const [readRolesArray, setReadRolesArray] = React.useState([]);
  const [writeRolesArray, setWriteRolesArray] = React.useState([]);
  const [sharing, setSharing] = React.useState('app');
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);
  const [errors, setErrors] = React.useState({});

  React.useEffect(function() {
    if (credential) {
      setUsername(credential.name || '');
      setRealm(credential.realm || '');
      setApp(credential.app || 'search');
      setOwner(credential.owner || 'nobody');
      setSharing(credential.sharing || 'app');

      var normalize = function(arr) { return arr.map(function(r) { return r === '*' ? '* (all)' : r; }); };
      var aclRead = normalize((credential.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean));
      var aclWrite = normalize((credential.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean));
      setReadRolesArray(aclRead);
      setWriteRolesArray(aclWrite);
    } else {
      setUsername('');
      setPassword('');
      setConfirmPassword('');
      setRealm('');
      setApp('search');
      setOwner(currentUserIdentity);
      setSharing('app');

      var defRead = (defaultReadRoles || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
      var defWrite = (defaultWriteRoles || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
      setReadRolesArray(defRead);
      setWriteRolesArray(defWrite);
    }
    setErrors({});
  }, [credential, currentUserIdentity, defaultReadRoles, defaultWriteRoles]);

  const handleSubmit = function(e) {
    e.preventDefault();
    var newErrors = {};

    if (!username.trim()) newErrors.username = 'Username is required';
    if (!credential && !password) newErrors.password = 'Password is required';
    if (isChangingPassword && !password) newErrors.password = 'Password is required';
    if ((!credential || isChangingPassword) && password !== confirmPassword) newErrors.passwordMismatch = 'Passwords do not match';
    if (!readRolesArray.length) newErrors.readRoles = 'Select at least one Read role (or * for all)';
    if (!writeRolesArray.length) newErrors.writeRoles = 'Select at least one Write role (or * for all)';

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    if (onSave) {
      onSave({
        username: username.trim(),
        password: password || null,
        realm: realm.trim(),
        app: app,
        owner: owner,
        readRoles: resolveRoles(readRolesArray),
        writeRoles: resolveRoles(writeRolesArray),
        sharing: sharing,
      });
    }
  };

  const handleTogglePasswordChange = function() {
    setIsChangingPassword(function(prev) { return !prev; });
    if (!isChangingPassword) {
      setPassword('');
      setConfirmPassword('');
      setErrors({});
    }
  };

  const handlePasswordChange = function(data) {
    var val = data ? data.value : '';
    setPassword(val);
    clearError('password');
    clearError('passwordMismatch');
  };

  const handleConfirmChange = function(data) {
    var val = data ? data.value : '';
    setConfirmPassword(val);
    clearError('passwordMismatch');
  };

  const clearError = function(key) {
    setErrors(function(prev) {
      var next = Object.assign({}, prev);
      delete next[key];
      return Object.keys(next).length ? next : {};
    });
  };

  const handleMultiSelectChange = function(targetKey, data) {
    var selected;
    if (data && Array.isArray(data.selectedItems)) {
        // Splunk Multiselect passes { selectedItems: [...] }
        selected = data.selectedItems.map(function(item) { return item.value; });
    } else if (Array.isArray(data)) {
        selected = data;
    } else {
        selected = [];
    }

    if (selected.includes('* (all)')) {
      selected = ['* (all)'];
    }
    if (targetKey === 'read') {
      setReadRolesArray(selected);
      clearError('readRoles');
    } else {
      setWriteRolesArray(selected);
      clearError('writeRoles');
    }
  };

  const resolveRoles = function(roles) {
    if (!roles || roles.length === 0) return [];
    if (roles.includes('* (all)')) return ['*'];
    return roles;
  };

  const showPasswordFields = !credential || isChangingPassword;

  // Build Select options helper
  function buildSelectOptions(items, extraOption) {
    var opts = extraOption ? [extraOption] : [];
    return opts.concat(items.map(function(item) {
      var val = item.name || item;
      var label = (item.fullName && item.name) ? (item.fullName + ' (' + item.name + ')') : val;
```

Note: This is getting very long. The subagent writing this task should continue the file replacement pattern, replacing each field with the appropriate Splunk component:

- **Username**: `Text` with `onBlur`/handle change via data.value, error prop set via `errors.username`
- **Realm**: `Text` with `disabled: !!credential`, placeholder hint
- **App**: `Select` with options from availableApps, `onChange` handling option value
- **Sharing**: `Select` with SHARING_OPTIONS mapped to `{ label, value }` shape expected by Splunk Select
- **Owner**: `Select` with "Nobody (shared)" extra option + availableUsers
- **Read Roles**: `Multiselect` with `selectedItems` derived from readRolesArray, onChange via handleMultiSelectChange('read')
- **Write Roles**: Same pattern as Read Roles
- **Change Password toggle**: `SwitchComp` or `Checkbox` (Switch is preferred for toggles in Splunk UI)
- **Password + Confirm Password**: `Text` with `type: 'password'` — NOTE: Splunk Text v5.9.1 may use `passwordVisibilityToggle` prop instead of a type enum; if `type` isn't available, fall back to native `<input>` for password fields only

  - [ ] **Step 2: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds. Common issues to watch for:
  - Select options shape: Splunk Select may expect `{ label, value }` objects rather than strings — verify with actual API docs or test rendering
  - Multiselect `selectedItems`: May expect objects with `{ value, label }` — map accordingly
  - Text password input: If no `type` prop exists, fallback to native `<input type="password">` within the ControlGroup wrapper

  - [ ] **Step 3: Verify form behavior**

Open the app in Splunk Web UI. Test both "Create" and "Edit" flows. Verify:
  - Username/realm/password fields accept input (Text component)
  - App/Sharing/Owner dropdowns show options (Select component)
  - Read/Write Role multi-select works, including * (all) mutual exclusion (Multiselect)
  - "Change password" toggle works in edit mode (Switch/Checkbox)
  - Validation errors display below fields when submit is clicked with missing data

  - [ ] **Step 4: Commit**

```bash
git add appserver/static/react/components/CredentialForm.jsx
git commit -m "feat(ui): migrate CredentialForm to @splunk/react-ui ControlGroup + Text + Select + Multiselect"
```

---

### Task 9: Cleanup — Remove CSS injection and unused inline styles

**Files:**
- Modify: `appserver/static/react/bundle.jsx` (CSS injection ~L20-33, dark theme override style)
- Test: Build + visual verification — no regressions; text color correct in both light and dark Splunk themes

  - [ ] **Step 1: Remove CSS injection code from bundle.jsx**

Delete the CSS injection block (~L20-33):
```js
// DELETE THIS BLOCK:
const SPLUNK_UI_CSS_RESET = `
    html .credential-form-modal,
    html .credential-manager-app { color: #172b4d !important; }
`;

function injectCSS() {
    if (document.getElementById('credential-manager-ui-fixes')) return;
    var style = document.createElement('style');
    style.id = 'credential-manager-ui-fixes';
    style.textContent = SPLUNK_UI_CSS_RESET ;
    document.head.appendChild(style);
}
```

And remove the `injectCSS()` call from `init()` (~L551) and the `useEffect` that calls it (~L91-93):
```js
// DELETE THIS useEffect:
React.useEffect(() => {
    injectCSS();
}, []);

// DELETE FROM init():
injectCSS();
```

  - [ ] **Step 2: Audit remaining inline styles**

Scan bundle.jsx, Modal.jsx, CredentialTable.jsx, CredentialForm.jsx for any `style: { ... }` objects that are purely stylistic (colors, borders, padding) and could be removed now that Splunk UI handles them. Keep inline styles that serve functional purposes:
  - Drag-drop zone border color toggle (still needed for visual feedback)
  - Preview table compact layout inside ImportCSVModal (acceptable as-is per Task 5 rationale)
  - Error state coloring where MessageBar doesn't cover it

Remove any redundant wrapper divs that only existed to hold inline styles.

  - [ ] **Step 3: Build and verify**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Build succeeds, bundle size is smaller (less CSS injection code removed).

  - [ ] **Step 4: Verify dark theme visibility**

Open the app in Splunk with both light and dark themes. Verify all text is readable, modals overlay correctly, table rows are visible.

  - [ ] **Step 5: Commit**

```bash
git add appserver/static/react/bundle.jsx appserver/static/react/components/Modal.jsx
git commit -m "chore(ui): remove CSS injection and unused inline styles after Splunk UI migration"
```

---

### Task 10: Final verification — Full CRUD, bulk operations, pagination smoke test

**Files:**
- No files modified in this task — verification only
- Test: All CRUD operations, CSV import, bulk delete, pagination

  - [ ] **Step 1: Build production bundle**

Run: `npx webpack --config webpack.config.js --mode production`
Expected: Clean build, no warnings about unused variables or missing exports.

  - [ ] **Step 2: Deploy to Splunk and run full smoke test**

Deploy the app (copy bundle.js to correct location or use Splunk's dev server). Perform these operations in order:

1. **List credentials**: Verify table renders all credentials with sorting, filtering, pagination
2. **Create credential**: Click "Create Credential" → fill form → save → verify new credential appears in table
3. **Edit credential**: Click "Edit" on a row → modify app or read roles → save → verify changes persist
4. **Reveal password**: Click "Reveal" on a row → password should display in modal → close
5. **Delete credential**: Click "Delete" on a row → confirm deletion → verify credential is removed
6. **CSV import**: Click "Import CSV" → select CSV file → preview → import → verify credentials created
7. **Bulk delete**: Check multiple rows → click "Delete Selected" → confirm → verify removal
8. **Pagination**: Navigate through all pages → verify no duplicates or missing entries

  - [ ] **Step 3: Verify parity with JS version**

Open password-crud.js in parallel Splunk instance, compare operations for behavioral parity:
  - Same credentials created/edited/deleted
  - ACL behavior matches (sharing bumps, role permissions)
  - CSV import produces same results as legacy importer

  - [ ] **Step 4: Commit any final fixes**

If any verification steps reveal bugs from the migration, fix them and commit before marking this task complete. The final commit message should note what was fixed:
```bash
git add appserver/static/react/
git commit -m "fix(ui): address migration regressions found during smoke testing"
```

  - [ ] **Step 5: Run existing tests**

Run any available test commands from package.json:
```bash
npm run verify          # checks bundle.js and password-crud.js exist
npx playwright test     # if E2E tests are configured with .env credentials
```

---

## Hard Rails (from INTENT.md — inherited by all tasks)
- Always use password-crud.js as reference for REST call behavior — behavioral parity is non-negotiable
- Always check Splunk React UI docs at https://splunkui.splunk.com/Packages/react-ui/Overview when uncertain about component APIs
- Always ask questions if unclear of intent, don't assume

## Critical Patterns (must not be violated)
- ACL path must go through `/configs/conf-passwords/credential:${realm}:${username}:`, not `${rest_uri}/acl`
- User-scoped credentials require temporary sharing bump (`user→app→fetch→user`) for password reveal and deletion
- Update sequence: ACL bump sharing=app → POST password only → `/move` if app changed → final ACL
- Delete sequence: per-credential ACL bump → DELETE via explicit owner/app path
- Realm field immutable post-create: disabled in edit mode; REST API doesn't allow modification
- Auth strategy: cookie + CSRF via `splunkd/__raw` proxy, NOT .env credentials

## Resources
- JS reference: `appserver/static/password-crud.js` (1171 lines)
- Splunk React UI docs: https://splunkui.splunk.com/Packages/react-ui/Overview
- Vercel React best practices skill (local)
- Installed @splunk/react-ui v5.9.1 with full component set (Table, Modal, Button, Chip, Text, Select, Multiselect, Switch, Checkbox, Paginator, MessageBar, ControlGroup, WaitSpinner)
