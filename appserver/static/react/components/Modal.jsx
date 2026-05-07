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

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
    }, [credential]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
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
                        type: 'password', value: password, readOnly: true,
                        style: { width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontFamily: 'monospace' },
                    })
                )
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
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
                React.createElement(SplunkModal.Body, null,
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
    }, [credential]);

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

module.exports = { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal };