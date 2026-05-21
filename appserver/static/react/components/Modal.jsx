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

    if (!isOpen) return null;

    // ── Preview phase: parsed table with errors + Import/Back buttons ──
    if (phase === 'preview') {
        var headerLabels = ['Username', 'Realm', 'Password', 'App', 'Owner', 'Sharing', 'Read', 'Write'];
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
                    parseErrors.length > 0 && React.createElement(
                        'div',
                        { style: { backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginBottom: '1rem', color: '#856404' } },
                        parseErrors.map(function(err, i) { return React.createElement('div', { key: i }, '\u26a0 ', err); })
                    ),
                    parsedRows.length > 0 ? React.createElement(
                        'p', { style: { margin: '0 0 8px' } }, `<b>${parsedRows.length}</b> credential${parsedRows.length !== 1 ? 's' : ''} ready to import.`)
                        : React.createElement('div', { style: { backgroundColor: '#fff5f5', color: '#d32f2f', border: '1px solid #de350b', borderRadius: '4px', padding: '0.5rem 0.75rem' } }, 'No valid rows to import.')
                    ,
                    parsedRows.length > 0 && React.createElement(
                        'div', { style: { maxHeight: '300px', overflowY: 'auto', marginTop: '8px', border: '1px solid #e0e0e0' } },
                        React.createElement('table', { style: { width: '100%', borderWidth: 0, fontSize: '12px', color: '#172b4d' } },
                            React.createElement('thead', null,
                                React.createElement('tr', { style: { textAlign: 'left', borderBottom: '2px solid #e0e0e0' } },
                                    headerLabels.map(function(h) {
                                        return React.createElement('th', { key: h, style: { padding: '6px 8px', fontWeight: 500, borderBottom: '1px solid #e0e0e0' } }, h);
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
                        style: { border: `${dragActive ? '2px solid #0066cc' : '2px dashed #ccc'}`, borderRadius: '4px', padding: '3rem 1.5rem', textAlign: 'center', backgroundColor: dragActive ? '#f0f7ff' : '#fff', marginTop: '1rem', cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }
                    },
                    file ? React.createElement('p', null, file.name) : React.createElement(React.Fragment, null,
                        React.createElement('p', { style: { margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#555' } }, '\u2B07'),
                        React.createElement('p', { style: { margin: '4px 0 0', fontSize: '13px', color: '#888' } }, 'Click to select or drag file')
                    )
                ),
                fileError && React.createElement(
                    'div', { style: { backgroundColor: '#fff5f5', color: '#d32f2f', border: '1px solid #de350b', borderRadius: '4px', padding: '0.5rem 0.75rem', fontSize: '13px', marginTop: '0.75rem' } }, fileError
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

    // Check all checked fields have values — prevents submitting empty roles
    var canApply = (applyRead ? readRoles.length > 0 : true) &&
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

module.exports = { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal, HelpModal, BulkEditModal };