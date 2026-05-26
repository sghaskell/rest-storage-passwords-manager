/**
 * Modal.jsx - Modal components for password reveal, CSV import, and confirm dialogs
 */

const React = require('react');
const SplunkModalMod = require('@splunk/react-ui/Modal');
var SplunkModal = SplunkModalMod.default;
SplunkModalMod.Header && (SplunkModal.Header = SplunkModalMod.Header);
SplunkModalMod.Body && (SplunkModal.Body = SplunkModalMod.Body);
SplunkModalMod.Footer && (SplunkModal.Footer = SplunkModalMod.Footer);
const ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

/**
 * PasswordRevealModal - Modal to securely display clear-text passwords
 */
function PasswordRevealModal({ credential, onClose }) {
    const [password, setPassword] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [copied, setCopied] = React.useState(false);

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
    }, [credential]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    function handleCopy() {
        if (!password) return;
        navigator.clipboard.writeText(password).then(function() {
            setCopied(true);
            setTimeout(function() { setCopied(false); }, 2000);
        }).catch(function() {
            // Fallback for older browsers
            var ta = document.createElement('textarea');
            ta.value = password;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(function() { setCopied(false); }, 2000);
        });
    }

    React.useEffect(function() {
        if (credential) {
            async function fetchPassword() {
                try {
                    const { getCredentialPassword } = require('../api');
                    const clearPassword = await getCredentialPassword(
                        credential.name, credential.realm,
                        credential.app || 'search',
                        credential.namespaceOwner || credential.owner || 'nobody',
                        credential.sharing || 'app'
                    );
                    setPassword(clearPassword || '(unable to retrieve)');
                } catch (error) {
                    console.error('Error fetching password:', error);
                    try { localStorage.setItem('modal_pwd_error', JSON.stringify({ message: error.message, name: credential.name, app: credential.app, owner: credential.owner, namespaceOwner: credential.namespaceOwner, sharing: credential.sharing, timestamp: Date.now() })); } catch(_) {}
                    setPassword('(error retrieving password)');
                } finally {
                    setLoading(false);
                }
            }
            fetchPassword();
        }
        return function() {
            setPassword('');
        };
    }, [credential]);

    if (!credential) return null;

    return React.createElement(SplunkModal, {
        open: true,
        onRequestClose: function() { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '500px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, `Password for ${credential.name}`)
            ),
            React.createElement(SplunkModal.Body, null,
                loading ? React.createElement('p', null, 'Loading...') : React.createElement(
                    'div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' } }, 'Password'),
                    React.createElement('input', {
                        type: 'text', value: password, readOnly: true,
                        style: { width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontFamily: 'monospace', color: '#172b4d', backgroundColor: '#f4f4f4', fontSize: '14px', boxSizing: 'border-box' },
                    })
                )
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, {
                    onClick: handleCopy,
                    appearance: 'subtle',
                    children: copied ? 'Copied!' : 'Copy'
                }),
                React.createElement(Button, { onClick: onClose, children: 'Close' })
            )
        )
    );
}


/**
 * ImportCSVModal - Modal for CSV import with drag/drop + preview confirmation step.
 * Two-step flow matching JS (password-crud.js L956-1071):
 *   1) File selected → parse → show parsed table with per-row errors
 *   2) User confirms Import or cancels before any API calls
 */
function ImportCSVModal({ isOpen, onClose, onImport }) {
    const [dragActive, setDragActive] = React.useState(false);
    const [file, setFile] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [fileError, setFileError] = React.useState('');
    const fileInputRef = React.useRef(null);

    // Preview phase state
    const [phase, setPhase] = React.useState('select'); // 'select' | 'preview'
    const [parsedRows, setParsedRows] = React.useState([]);
    const [parseErrors, setParseErrors] = React.useState([]);

    const MAX_CSV_SIZE = 512 * 1024;

    // Detect dark theme synchronously at render time — no state needed.
    // Check classes first, then fall back to computed body background brightness
    // (Splunk may not set dark-theme class on html/body in all versions).
    var detectDark = function() {
        var html = document.documentElement;
        if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
        if (html.getAttribute('data-theme') === 'dark') return true;
        if (document.body.classList.contains('dark-theme')) return true;
        var bg = getComputedStyle(document.body).backgroundColor;
        var match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
            var brightness = (r * 299 + g * 587 + b * 114) / 1000;
            return brightness < 128;
        }
        return false;
    };
    var isDark = detectDark();

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
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
            setFileError(`File too large (${(fileObj.size / 1024).toFixed(0)} KB). Maximum allowed size is 512 KB.`);
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
        try {
            await onImport(parsedRows, parseErrors);
        } finally {
            setLoading(false);
            onClose();
        }
    }

    function resetState() {
        setFile(null);
        setParsedRows([]);
        setParseErrors([]);
        setFileError('');
        setLoading(false);
        setPhase('select');
    }

    if (!isOpen) return null;

    // ── Preview phase: parsed table with errors + Import/Back buttons ──
    if (phase === 'preview') {
        var headerLabels = ['Username', 'Realm', 'Password', 'App', 'Owner', 'Sharing', 'Read', 'Write'];
        var warnBg = isDark ? '#3d3400' : '#fff3cd';
        var warnBorder = isDark ? '#665c00' : '#ffc107';
        var warnColor = isDark ? '#ffd54f' : '#856404';
        var errorBg = isDark ? '#3d0000' : '#fff5f5';
        var errorBorder = isDark ? '#660000' : '#de350b';
        var errorColor = isDark ? '#ef9a9a' : '#d32f2f';
        var tableBorder = isDark ? '#444' : '#e0e0e0';
        var tableColor = isDark ? '#e0e0e0' : '#172b4d';
        var rowBorder = isDark ? '#333' : '#eee';
        var headerBorder = isDark ? '#555' : '#e0e0e0';
        return React.createElement(SplunkModal, {
            open: true,
            onRequestClose: function() { resetState(); onClose(); },
            returnFocus: handleReturnFocus,
            divider: 'both',
            style: { width: '900px', maxWidth: '95%' }
        },
            React.createElement('div', null,
                React.createElement(SplunkModal.Header, null,
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '500' } }, `Import Preview \u2014 ${parsedRows.length} credential${parsedRows.length !== 1 ? 's' : ''}`)
                ),
                React.createElement(SplunkModal.Body, { style: { maxHeight: '60vh', overflowY: 'auto' } },
                    isDark && React.createElement('style', null, '.import-csv-modal-body * { color: #e0e0e0 !important; }'),
                    React.createElement('div', { className: 'import-csv-modal-body', style: { color: isDark ? '#e0e0e0' : 'inherit' } },
                        parseErrors.length > 0 && React.createElement(
                            'div',
                            { style: { backgroundColor: warnBg, border: '1px solid ' + warnBorder, borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginBottom: '1rem', color: warnColor } },
                            parseErrors.map(function(err, i) { return React.createElement('div', { key: i }, '\u26a0 ', err); })
                        ),
                        parsedRows.length > 0 ? React.createElement(
                            'p', { style: { margin: '0 0 8px', color: isDark ? '#e0e0e0' : '#333' } },
                                React.createElement('b', null, parsedRows.length),
                                ` credential${parsedRows.length !== 1 ? 's' : ''} ready to import.`)
                            : React.createElement('div', { style: { backgroundColor: errorBg, color: errorColor, border: '1px solid ' + errorBorder, borderRadius: '4px', padding: '0.5rem 0.75rem' } }, 'No valid rows to import.'),
                        parsedRows.length > 0 && React.createElement(
                            'div', { style: { maxHeight: '300px', overflowY: 'auto', marginTop: '8px', border: '1px solid ' + tableBorder } },
                            React.createElement('table', { style: { width: '100%', borderWidth: 0, fontSize: '12px', color: tableColor } },
                                React.createElement('thead', null,
                                    React.createElement('tr', { style: { textAlign: 'left', borderBottom: '2px solid ' + headerBorder } },
                                        headerLabels.map(function(h) {
                                            return React.createElement('th', { key: h, style: { padding: '6px 8px', fontWeight: 500, borderBottom: '1px solid ' + headerBorder } }, h);
                                        })
                                    )
                                ),
                                React.createElement('tbody', null,
                                    parsedRows.map(function(row, idx) {
                                        return React.createElement('tr', { key: idx, style: { textAlign: 'left', borderBottom: '1px solid ' + rowBorder } },
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
                    )
                ),
                React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                    React.createElement(Button, { onClick: function() { resetState(); }, children: 'Back' }),
                    React.createElement(Button, {
                        onClick: handleImport,
                        disabled: parsedRows.length === 0 || loading,
                        appearance: 'primary',
                        children: loading ? 'Importing...' : `Import ${parsedRows.length} credential${parsedRows.length !== 1 ? 's' : ''}`
                    })
                )
            )
        );
    }

    // ── Select phase: drag/drop zone + browse button ──
    var dropBg = isDark ? (dragActive ? '#1a2a3a' : '#2d2d2d') : (dragActive ? '#f0f7ff' : '#fff');
    var dropBorder = isDark ? (dragActive ? '2px solid #42a5f5' : '2px dashed #555') : (dragActive ? '2px solid #0066cc' : '2px dashed #ccc');
    var dropArrowColor = isDark ? '#aaa' : '#555';
    var dropTextColor = isDark ? '#888' : '#888';
    var fileErrorBg = isDark ? '#3d0000' : '#fff5f5';
    var fileErrorBorder = isDark ? '#660000' : '#de350b';
    var fileErrorColor = isDark ? '#ef9a9a' : '#d32f2f';
    return React.createElement(SplunkModal, {
        open: true,
        onRequestClose: function() { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '550px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '500' } }, 'Import Credentials from CSV')
            ),
            React.createElement(SplunkModal.Body, null,
                React.createElement('p', null, 'Drag and drop your CSV file here, or click to select.'),
                React.createElement('input', { ref: fileInputRef, type: 'file', accept: '.csv', onChange: handleChange, style: { display: 'none' }}),
                React.createElement(
                    'div',
                    {
                        onDragEnter: handleDrag, onDragLeave: handleDrag, onDragOver: handleDrag, onDrop: handleDrop,
                        onClick: function() { if (fileInputRef.current) fileInputRef.current.click(); },
                        style: { border: dropBorder, borderRadius: '4px', padding: '3rem 1.5rem', textAlign: 'center', backgroundColor: dropBg, marginTop: '1rem', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }
                    },
                    file ? React.createElement('p', null, file.name) : React.createElement(React.Fragment, null,
                        React.createElement('p', { style: { margin: 0, fontSize: '14px', fontWeight: 'bold', color: dropArrowColor } }, '\u2B07'),
                        React.createElement('p', { style: { margin: '4px 0 0', fontSize: '13px', color: dropTextColor } }, 'Click to select or drag file')
                    )
                ),
                fileError && React.createElement(
                    'div', { style: { backgroundColor: fileErrorBg, color: fileErrorColor, border: '1px solid ' + fileErrorBorder, borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginTop: '0.75rem' } }, fileError
                )
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, children: 'Cancel' })
            )
        )
    );
}

/**
 * ConfirmDeleteModal - Modal for confirming credential deletion
 */
function ConfirmDeleteModal({ credential, isOpen, onClose, onDelete }) {
    if (!isOpen) return null;

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
    }, [isOpen]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    return React.createElement(SplunkModal, {
        open: isOpen,
        onRequestClose: function() { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: credential ? '450px' : '650px', maxWidth: '90%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, credential ? 'Delete Credential' : '')
            ),
            React.createElement(SplunkModal.Body, null,
                React.createElement(
                    'p', null,
                    'Are you sure you want to delete the credential ',
                    React.createElement('strong', null, credential ? credential.name : ''),
                    '? This action cannot be undone.'
                )
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, children: 'Cancel' }),
                React.createElement(Button, { onClick: onDelete, appearance: 'destructive', children: 'Delete' })
            )
        )
    );
}

/**
 * HelpModal - Collapsible-sections help panel for the app
 */
function HelpModal({ isOpen, onClose }) {
    const [openSections, setOpenSections] = React.useState({ about: true });

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
    }, [isOpen]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    function toggle(section) {
        setOpenSections(function(prev) {
            var next = Object.assign({}, prev);
            next[section] = !next[section];
            return next;
        });
    }

    if (!isOpen) return null;

    var sectionStyle = { borderBottom: '1px solid #e0e0e0', padding: '0.5rem 0' };
    var headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '0.25rem 0', fontSize: '14px', fontWeight: '600' };
    var bodyStyle = { padding: '0.5rem 0 0.25rem 0.5rem', fontSize: '13px', lineHeight: '1.6', color: '#444' };
    var codeStyle = { backgroundColor: '#f4f4f4', padding: '1px 4px', borderRadius: '3px', fontFamily: 'monospace', fontSize: '12px' };

    var sections = [
        {
            id: 'about',
            title: 'About',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Credential Manager provides a full-featured interface to the ',
                    React.createElement('a', { href: 'https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTaccess#storage.2Fpasswords', target: '_blank', rel: 'noopener', style: { color: '#0066cc' } }, 'Splunk storage/passwords REST endpoint'), '.'),
                React.createElement('p', null, 'Create, edit, copy, delete, and import credentials — plus manage permissions, sharing scope, and app context — all from one place.')
            )
        },
        {
            id: 'creating',
            title: 'Creating Credentials',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Click ', React.createElement('strong', null, 'Create Credential'), ' in the toolbar to open the form.'),
                React.createElement('p', null, 'Fill in a username and password. Optionally add a realm (e.g. ', React.createElement('code', { style: codeStyle }, 'prod'), ', ', React.createElement('code', { style: codeStyle }, 'dev'), ') — the realm cannot be changed after creation.'),
                React.createElement('p', null, 'Choose the app, owner, sharing scope, and read/write roles. The form pre-fills with secure defaults for roles based on your configuration.')
            )
        },
        {
            id: 'editing',
            title: 'Editing Credentials',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Click the pencil icon in a row\'s Actions column to open the edit form.'),
                React.createElement('p', null, 'You can change the password (toggle "Change password"), app, owner, sharing, and read/write roles. The username, realm, and app context are locked.'),
                React.createElement('p', null, 'Click the copy icon to duplicate a credential with a date-suffixed username.')
            )
        },
        {
            id: 'deleting',
            title: 'Deleting Credentials',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Single delete: click the trash icon in a row\'s Actions column and confirm.'),
                React.createElement('p', null, 'Bulk delete: select rows with checkboxes, then click the "Delete Selected (N)" button in the toolbar.')
            )
        },
        {
            id: 'passwords',
            title: 'Revealing Passwords',
            content: React.createElement('p', null, 'Click the eye icon in a row\'s Actions column to display the plain-text password in a modal.')
        },
        {
            id: 'filtering',
            title: 'Filtering, Sorting, and Columns',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Search across all fields — or narrow to a specific field using the dropdown next to the search box.'),
                React.createElement('p', null, 'Click any column header to sort ascending/descending.'),
                React.createElement('p', null, 'Click "Show/Hide Columns" to toggle which columns are visible. Your selection is saved per browser.'),
                React.createElement('p', null, 'Use the rows-per-page dropdown and paginator to control table size.')
            )
        },
        {
            id: 'csv',
            title: 'CSV Import and Export',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Open the ', React.createElement('strong', null, '⋮'), ' dropdown menu in the toolbar for import/export options.'),
                React.createElement('p', null, 'Click "Download Template" to get a CSV template with the expected columns.'),
                React.createElement('p', null, 'Click "Import CSV" and drag or select your file. A preview table shows the parsed rows before any credentials are created.'),
                React.createElement('p', null, 'Maximum file size is 512 KB, with a limit of 500 rows per file. Rows with parse errors are flagged but valid rows still import.'),
                React.createElement('p', null, 'Click "Export CSV" to download a CSV of all credentials.'),
                React.createElement('p', null,
                    React.createElement('strong', null, 'Password rotation: '),
                    'The export intentionally omits passwords — Splunk does not return them in list responses, and the app never ships plaintext credentials in a file. The exported CSV is a skeleton with usernames, realms, apps, and ACLs. Add passwords back locally, then re-import to rotate credentials in bulk via script.'
                )
            )
        },
        {
            id: 'rotation',
            title: 'Bulk Password Rotation',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Select 2+ credentials with checkboxes, then click ', React.createElement('strong', null, 'Rotate Passwords (N)'), ' in the toolbar.'),
                React.createElement('p', null, 'Choose password settings (length, character set) and mode: '),
                React.createElement('ul', { style: { margin: '0.25rem 0 0.5rem 1.25rem', padding: 0 } },
                    React.createElement('li', null, React.createElement('strong', null, 'Individual'), ' — each credential gets a unique password'),
                    React.createElement('li', null, React.createElement('strong', null, 'Shared'), ' — all credentials share the same password')
                ),
                React.createElement('p', null, 'Click ', React.createElement('strong', null, 'Preview'), ' to see the generated passwords before applying, or ', React.createElement('strong', null, 'Execute Rotation'), ' to apply immediately.'),
                React.createElement('p', null, 'After execution, you can undo within 10 seconds, or download old passwords as CSV before the undo window expires.')
            )
        },
        {
            id: 'audit',
            title: 'Audit Log',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'The Audit Log view (separate tab) shows all REST activity against storage/passwords — creates, updates, deletes, ACL changes, and view events.'),
                React.createElement('p', null, 'Filter by time range, specific users, or free-text search across any column.'),
                React.createElement('p', null, 'Status chips indicate success, conflicts, duplicates, or errors for each action.')
            )
        },
        {
            id: 'permissions',
            title: 'Permissions',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'To ', React.createElement('strong', null, 'create or modify'), ' passwords, your role needs the ', React.createElement('code', { style: codeStyle }, 'admin_all_objects'), ' capability.'),
                React.createElement('p', null, 'To ', React.createElement('strong', null, 'read'), ' passwords, your role needs ', React.createElement('code', { style: codeStyle }, 'list_storage_passwords'), '.'),
                React.createElement('p', null, 'Grant ', React.createElement('code', { style: codeStyle }, 'list_storage_passwords'), ' carefully — users with this capability can view credentials across any app where they have read access.')
            )
        },
        {
            id: 'support',
            title: 'Support',
            content: React.createElement(React.Fragment, null,
                React.createElement('p', null, 'Feature requests: ',
                    React.createElement('a', { href: 'https://github.com/sghaskell/rest-storage-passwords-manager/labels/enhancement', target: '_blank', rel: 'noopener', style: { color: '#0066cc' } }, 'GitHub enhancements')),
                React.createElement('p', null, 'Bugs: ',
                    React.createElement('a', { href: 'https://github.com/sghaskell/rest-storage-passwords-manager/labels/bug', target: '_blank', rel: 'noopener', style: { color: '#0066cc' } }, 'GitHub bugs')),
                React.createElement('p', null, 'Source code: ',
                    React.createElement('a', { href: 'https://github.com/sghaskell/rest-storage-passwords-manager', target: '_blank', rel: 'noopener', style: { color: '#0066cc' } }, 'GitHub repository'))
            )
        }
    ];

    return React.createElement(SplunkModal, {
        open: true,
        onRequestClose: onClose,
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '650px', maxWidth: '95%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, 'Help — Credential Manager')
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '70vh', overflowY: 'auto' } },
                sections.map(function(sec) {
                    return React.createElement('div', { key: sec.id, style: sectionStyle },
                        React.createElement('div', {
                            style: headerStyle,
                            onClick: function() { toggle(sec.id); }
                        },
                            React.createElement('span', null, sec.title),
                            React.createElement('span', { style: { color: '#888', fontSize: '12px' } }, openSections[sec.id] ? '▾' : '▸')
                        ),
                        openSections[sec.id] && React.createElement('div', { style: bodyStyle }, sec.content)
                    );
                })
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, appearance: 'primary', children: 'Close' })
            )
        )
    );
}

/**
 * BulkEditModal — bulk-edit roles, owner, and sharing for selected credentials
 */
function BulkEditModal({ isOpen, selectedRows, availableRoles, availableUsers, onClose, onApply }) {
    if (!isOpen) return null;

    var MultiSelectMod = require('@splunk/react-ui/Multiselect');
    var MultiSelector = MultiSelectMod.default;
    var MultiSelectOption = MultiSelectMod.Option;

    const [readRoles, setReadRoles] = React.useState([]);
    const [writeRoles, setWriteRoles] = React.useState([]);
    const [owner, setOwner] = React.useState('');
    const [sharing, setSharing] = React.useState('');
    const [applyRead, setApplyRead] = React.useState(false);
    const [applyWrite, setApplyWrite] = React.useState(false);
    const [applyOwner, setApplyOwner] = React.useState(false);
    const [applySharing, setApplySharing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);

    // Reset state when modal opens
    React.useEffect(function() {
        if (isOpen) {
            setReadRoles([]);
            setWriteRoles([]);
            setOwner('');
            setSharing('');
            setApplyRead(false);
            setApplyWrite(false);
            setApplyOwner(false);
            setApplySharing(false);
            setSaving(false);
        }
    }, [isOpen]);

    var roleOptions = (availableRoles || []).map(function(r) {
        return { label: r, value: r };
    });

    var userOptions = (availableUsers || []).map(function(u) {
        var name = typeof u === 'string' ? u : u.name;
        return { label: name, value: name };
    });

    function handleRoleChange(e, data, isRead) {
        var newVals = data.values ? data.values.slice() : [];
        var prevVals = isRead ? readRoles : writeRoles;
        var added = newVals.filter(function(v) { return prevVals.indexOf(v) === -1; });
        if (added.includes('* (all)')) { newVals = ['* (all)']; }
        else if (added.length > 0 && !added.includes('* (all)') && prevVals.includes('* (all)')) { newVals = newVals.filter(function(v) { return v !== '* (all)'; }); }
        if (isRead) setReadRoles(newVals);
        else setWriteRoles(newVals);
    }

    // At least one checkbox must be checked, and checked fields must have values
    var hasApply = applyRead || applyWrite || applyOwner || applySharing;
    var canApply = hasApply &&
                   (applyRead ? readRoles.length > 0 : true) &&
                   (applyWrite ? writeRoles.length > 0 : true) &&
                   (applyOwner ? owner !== '' : true) &&
                   (applySharing ? sharing !== '' : true);

    function handleApply() {
        if (!canApply) return;
        setSaving(true);
        var updates = [];
        selectedRows.forEach(function(c) {
            var updated = Object.assign({}, c);
            if (applyRead) updated.aclRead = readRoles.join(', ');
            if (applyWrite) updated.aclWrite = writeRoles.join(', ');
            if (applyOwner) updated.owner = owner;
            if (applySharing) updated.sharing = sharing;
            updates.push(updated);
        });
        onApply(updates, function() {
            setSaving(false);
        });
    }

    return React.createElement(SplunkModal, {
        open: isOpen,
        onRequestClose: onClose,
        divider: 'both',
        style: { width: '600px', maxWidth: '95%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '500' } },
                    'Bulk Edit (' + selectedRows.length + ' credentials)'
                )
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '70vh', overflowY: 'auto' } },
                React.createElement('p', { style: { fontSize: '13px', color: '#666', marginBottom: '1rem' } },
                    'Changes only apply to fields with a checkbox checked. Unchecked fields remain unchanged.'
                ),

                // Read roles
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '14px', fontWeight: '500' } },
                        React.createElement('input', { type: 'checkbox', checked: applyRead, onChange: function(e) { setApplyRead(e.target.checked); } }),
                        'Read Roles'
                    ),
                    React.createElement(MultiSelector, {
                        placeholder: 'Select roles...',
                        values: readRoles,
                        onChange: function(e, data) { handleRoleChange(e, data, true); },
                        disabled: !applyRead,
                    }, roleOptions.map(function(r) {
                        return React.createElement(MultiSelectOption, { key: 'bulk-rd-' + r.value, label: r.label, value: r.value });
                    }))
                ),

                // Write roles
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '14px', fontWeight: '500' } },
                        React.createElement('input', { type: 'checkbox', checked: applyWrite, onChange: function(e) { setApplyWrite(e.target.checked); } }),
                        'Write Roles'
                    ),
                    React.createElement(MultiSelector, {
                        placeholder: 'Select roles...',
                        values: writeRoles,
                        onChange: function(e, data) { handleRoleChange(e, data, false); },
                        disabled: !applyWrite,
                    }, roleOptions.map(function(r) {
                        return React.createElement(MultiSelectOption, { key: 'bulk-wr-' + r.value, label: r.label, value: r.value });
                    }))
                ),

                // Owner
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '14px', fontWeight: '500' } },
                        React.createElement('input', { type: 'checkbox', checked: applyOwner, onChange: function(e) { setApplyOwner(e.target.checked); } }),
                        'Owner'
                    ),
                    React.createElement('select', {
                        value: owner,
                        onChange: function(e) { setOwner(e.target.value); },
                        disabled: !applyOwner,
                        style: { width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px' }
                    },
                        React.createElement('option', { value: '' }, '-- Select user --'),
                        userOptions.map(function(u) {
                            return React.createElement('option', { key: u.value, value: u.value }, u.label);
                        })
                    )
                ),

                // Sharing
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '14px', fontWeight: '500' } },
                        React.createElement('input', { type: 'checkbox', checked: applySharing, onChange: function(e) { setApplySharing(e.target.checked); } }),
                        'Sharing'
                    ),
                    React.createElement('select', {
                        value: sharing,
                        onChange: function(e) { setSharing(e.target.value); },
                        disabled: !applySharing,
                        style: { width: '100%', padding: '6px 8px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px' }
                    },
                        React.createElement('option', { value: '' }, '-- Select scope --'),
                        React.createElement('option', { value: 'app' }, 'App'),
                        React.createElement('option', { value: 'user' }, 'User'),
                        React.createElement('option', { value: 'global' }, 'Global')
                    )
                )
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, appearance: 'subtle', children: 'Cancel', disabled: saving }),
                React.createElement(Button, {
                    onClick: handleApply,
                    appearance: 'primary',
                    children: saving ? 'Applying...' : 'Apply to ' + selectedRows.length + ' credentials',
                    disabled: saving || !canApply
                })
            )
        )
    );
}
// ─── Column preset management modal ───

/**
 * ColumnPresetModal — manages column layout presets (save, apply, rename, delete)
 */
function ColumnPresetModal({ isOpen, onClose, presets, visibleColumns, onApplyPreset, onSavePreset, onDeletePreset, onRenamePreset }) {
    const [newPresetName, setNewPresetName] = React.useState('');
    const [error, setError] = React.useState('');
    const [renameTarget, setRenameTarget] = React.useState(null);
    const [renameNewName, setRenameNewName] = React.useState('');

    function handleSaveCurrent() {
        if (!newPresetName || !newPresetName.trim()) {
            setError('Preset name is required.');
            return;
        }
        var exists = presets.some(function(p) { return p.name === newPresetName.trim(); });
        if (exists) {
            setError('A preset with this name already exists.');
            return;
        }
        onSavePreset(newPresetName.trim(), visibleColumns);
        setNewPresetName('');
        setError('');
    }

    function handleRename() {
        if (renameTarget) {
            if (!renameNewName || !renameNewName.trim()) {
                setError('Rename target name is required.');
                return;
            }
            onRenamePreset(renameTarget, renameNewName.trim());
            setRenameTarget(null);
            setRenameNewName('');
        }
    }

    function handleCancelRename() {
        setRenameTarget(null);
        setRenameNewName('');
    }

    if (!isOpen) return null;

    return React.createElement(SplunkModal, {
        open: true,
        onRequestClose: onClose,
        divider: 'both',
        style: { width: '600px', maxWidth: '95%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '500' } }, 'Column Layout Presets')
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '70vh', overflowY: 'auto' } },

                // Save current layout section
                React.createElement('div', { style: { marginBottom: '1.5rem' } },
                    React.createElement('h4', { style: { margin: '0 0 0.5rem', fontSize: '14px' } }, 'Save Current Layout'),
                    React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
                        React.createElement('input', {
                            type: 'text',
                            placeholder: 'Preset name...',
                            value: newPresetName,
                            onChange: function(e) { setNewPresetName(e.target.value); setError(''); },
                            style: {
                                flex: 1,
                                padding: '6px 8px',
                                fontSize: '13px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                boxSizing: 'border-box'
                            }
                        }),
                        React.createElement(Button, {
                            onClick: handleSaveCurrent,
                            appearance: 'primary',
                            children: 'Save'
                        })
                    )
                ),

                // Error message
                error && React.createElement('div', {
                    style: { backgroundColor: '#fff5f5', color: '#d32f2f', border: '1px solid #de350b', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginBottom: '1rem' }
                }, error),

                // Preset list
                React.createElement('h4', { style: { margin: '0 0 0.5rem', fontSize: '14px' } }, 'Saved Presets'),

                presets.length === 0
                    ? React.createElement('p', { style: { color: '#888', fontStyle: 'italic', fontSize: '13px' } }, 'No presets saved yet.')
                    : presets.map(function(preset) {
                        var isRenaming = renameTarget === preset.name;
                        return React.createElement('div', {
                            key: preset.name,
                            style: { display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.5rem', marginBottom: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: '#f9f9f9' }
                        },
                            // Preset name and column count
                            React.createElement('div', { style: { flex: 1 } },
                                React.createElement('strong', { style: { fontSize: '13px' } }, preset.name),
                                React.createElement('span', { style: { fontSize: '11px', color: '#666', marginLeft: '0.5rem' } },
                                    '(' + preset.columns.length + ' columns)'
                                ),
                                isRenaming && React.createElement('div', { style: { display: 'flex', gap: '0.25rem', marginTop: '0.25rem' } },
                                    React.createElement('input', {
                                        type: 'text',
                                        value: renameNewName,
                                        onChange: function(e) { setRenameNewName(e.target.value); },
                                        style: {
                                            flex: 1,
                                            padding: '4px 6px',
                                            fontSize: '11px',
                                            border: '1px solid #ccc',
                                            borderRadius: '4px',
                                            boxSizing: 'border-box'
                                        },
                                        'aria-label': 'New preset name'
                                    }),
                                    React.createElement(Button, {
                                        onClick: handleRename,
                                        appearance: 'subtle',
                                        children: 'OK',
                                        style: { fontSize: '11px', padding: '2px 6px' }
                                    }),
                                    React.createElement(Button, {
                                        onClick: handleCancelRename,
                                        appearance: 'subtle',
                                        children: 'Cancel',
                                        style: { fontSize: '11px', padding: '2px 6px' }
                                    })
                                )
                            ),
                            // Action buttons
                            React.createElement('div', { style: { display: 'flex', gap: '0.25rem' } },
                                !isRenaming && React.createElement(Button, {
                                    onClick: function() { onApplyPreset(preset.name); },
                                    appearance: 'primary',
                                    children: 'Apply'
                                }),
                                !isRenaming && React.createElement(Button, {
                                    onClick: function() { setRenameTarget(preset.name); setRenameNewName(preset.name); },
                                    appearance: 'subtle',
                                    children: 'Rename'
                                }),
                                !isRenaming && React.createElement(Button, {
                                    onClick: function() { onDeletePreset(preset.name); },
                                    appearance: 'destructive',
                                    children: 'Delete'
                                })
                            )
                        );
                    })
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, { onClick: onClose, children: 'Close' })
            )
        )
    );
}

module.exports = { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal, HelpModal, BulkEditModal, ColumnPresetModal };