/**
 * bundle.jsx - React Credential Manager entry point
 *
 * Central orchestration component with result modals, CSV import, bulk delete.
 * Replaces all alert() calls with structured result feedback.
 */

const React = require('react');
const ReactDOM = require('react-dom/client');

// Import UI components from Splunk design system
const ButtonMod = require('@splunk/react-ui/Button');
const { default: Button } = ButtonMod;
const DropdownMod = require('@splunk/react-ui/Dropdown');
const { default: Dropdown } = DropdownMod;
const ModalMod = require('@splunk/react-ui/Modal');
var Modal = ModalMod.default;
ModalMod.Header && (Modal.Header = ModalMod.Header);
ModalMod.Body && (Modal.Body = ModalMod.Body);
ModalMod.Footer && (Modal.Footer = ModalMod.Footer);
var CheckCircle = require('@splunk/react-icons/CheckCircle').default;
var CrossCircle = require('@splunk/react-icons/CrossCircle').default;
var ExclamationTriangle = require('@splunk/react-icons/ExclamationTriangle').default;
var TrashCanCross = require('@splunk/react-icons/TrashCanCross').default;
var SplunkThemeProvider = require('@splunk/themes').SplunkThemeProvider;
var _sc = require('styled-components');
var GlobalStyles = _sc.createGlobalStyle`
    input[type='color'],
    input[type='date'],
    input[type='datetime-local'],
    input[type='datetime'],
    input[type='email'],
    input[type='month'],
    input[type='number'],
    input[type='password'],
    input[type='search'],
    input[type='tel'],
    input[type='text'],
    input[type='time'],
    input[type='url'],
    input[type='week'],
    textarea {
        height: auto;
        margin-bottom: 0px;
        padding: 0;
        &:focus {
            box-shadow: none;
        }
    }

    /* Distinct hover color for credential table rows — overrides Splunk's neutral100 */
    .credential-table-container table tbody tr:not(.cred-expanded-row):not(.cred-expansion-row):hover {
        background-color: #e3f2fd !important;
    }

    /* Dark theme row hover — SplunkThemeProvider handles table cell colors, but we override
       the hover to a darker blue-gray for contrast against the dark background */
    html.dark-theme .credential-table-container table tbody tr:not(.cred-expanded-row):not(.cred-expansion-row):hover,
    html.theme-dark .credential-table-container table tbody tr:not(.cred-expanded-row):not(.cred-expansion-row):hover,
    html[data-theme="dark"] .credential-table-container table tbody tr:not(.cred-expanded-row):not(.cred-expansion-row):hover {
        background-color: rgba(69, 90, 100, 0.8) !important;
    }

    /* Dark theme table header — Splunk's HeadCell styled-component doesn't fully respect
        the theme provider in the Splunk app shell; override to match dark background */
    html.dark-theme .credential-table-container table thead th,
    html.theme-dark .credential-table-container table thead th,
    html[data-theme="dark"] .credential-table-container table thead th {
        background-color: #15191e !important;
        color: #e0e0e0 !important;
        border-color: #333 !important;
    }

    /* Password generator panel — custom element, not a Splunk component, needs explicit dark override */
    html.dark-theme .credential-form-generator-panel,
    html.theme-dark .credential-form-generator-panel,
    html[data-theme="dark"] .credential-form-generator-panel {
        border-color: #444 !important;
        background-color: #2d2d2d !important;
        color: #e0e0e0 !important;
    }
    html.dark-theme .credential-form-generator-panel input[type="range"],
    html.theme-dark .credential-form-generator-panel input[type="range"],
    html[data-theme="dark"] .credential-form-generator-panel input[type="range"] {
        background-color: #444 !important;
    }
    html.dark-theme .credential-form-generator-panel label,
    html.theme-dark .credential-form-generator-panel label,
    html[data-theme="dark"] .credential-form-generator-panel label {
        color: #e0e0e0 !important;
    }
    /* Password strength bar track — hardcoded #e0e0e0 in CredentialForm */
    html.dark-theme .credential-form-password-strength-track,
    html.theme-dark .credential-form-password-strength-track,
    html[data-theme="dark"] .credential-form-password-strength-track {
        background-color: #444 !important;
    }

    /* Kill blue focus ring on all interactive elements (modals, forms, table) */
    button:focus,
    button:focus-visible,
    a:focus,
    a:focus-visible,
    [tabindex]:focus,
    [tabindex]:focus-visible,
    select:focus,
    select:focus-visible {
        outline: none !important;
        box-shadow: none !important;
    }
`;

// Import self-contained application components
const CredentialTable = require('./components/CredentialTable');
const CredentialForm = require('./components/CredentialForm');
const AuditLog = require('./components/AuditLog');
const API = require('./api');
const { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal, HelpModal, BulkEditModal } = require('./components/Modal');

(function() {
    'use strict';

  console.log('Credential Manager: Script loaded');

    /**
     * Main CredentialManager component
     * Coordinates all credential management functionality
     */
    function CredentialManager() {
        // Data state — credentials, loading, error
        const [data, setData] = React.useState({
            credentials: [],
            loading: true,
            error: null,
        });
        const { credentials, loading, error } = data;

        // Modal visibility — consolidated from 5 separate useState calls
        const [modals, setModals] = React.useState({
            form: false,
            password: false,
            delete: false,
            import: false,
            bulkDelete: false,
            bulkEdit: false,
            result: false,
            help: false,
        });

        // Modal data
        const [selectedCredential, setSelectedCredential] = React.useState(null);
        const [editingCredential, setEditingCredential] = React.useState(null);
        const [copyCredential, setCopyCredential] = React.useState(null);

        // Result modal content — consolidated title + messages
        const [result, setResult] = React.useState({
            title: '',
            messages: [],
        });

        // Bulk selection
        const [selectedRows, setSelectedRows] = React.useState([]);

        // More actions dropdown
        const [moreDropdownOpen, setMoreDropdownOpen] = React.useState(false);

        // Filter/sort state — lifted from CredentialTable so parent can access filtered data for export
        const [filterText, setFilterText] = React.useState('');
        const [activeFilters, setActiveFilters] = React.useState([]);
        const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });

        // Undo delete state — array of credentials for single + bulk undo
        const [undoCredentials, setUndoCredentials] = React.useState([]);
        const [undoSecondsLeft, setUndoSecondsLeft] = React.useState(0);

        // Countdown timer for undo toast — only recreates when credentials change
        React.useEffect(() => {
            if (undoCredentials.length === 0) return;
            var timer = setInterval(function() {
                setUndoSecondsLeft(function(prev) {
                    if (prev <= 1) {
                        setUndoCredentials([]);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
            return function() { clearInterval(timer); };
        }, [undoCredentials]);

        // Reference data — apps, users, roles for form dropdowns
        const [refData, setRefData] = React.useState({
            apps: [],
            users: [],
            currentUserIdentity: 'nobody',
            roles: [],
        });

        // Error helper -- strips XML tags from Splunk responses for readable messages
        function getErrorMessage(err) {
            if (err.message && /&lt;msg/i.test(err.message)) {
                return API.parseError ? API.parseError(err.message) : err.message;
            }
            return err.message || 'An unexpected error occurred';
        }

        // Default role constants from API -- prevents empty ACL stripping access (GAP-V03/V04)
        const DEFAULT_READ = API.DEFAULT_READ_ROLES ? API.DEFAULT_READ_ROLES.join(', ') : 'admin, power';
        const DEFAULT_WRITE = API.DEFAULT_WRITE_ROLES ? API.DEFAULT_WRITE_ROLES.join(', ') : 'admin, power';

        // Keyboard shortcuts
        React.useEffect(() => {
            function isInputField(el) {
                var tag = (el.tagName || '').toLowerCase();
                return tag === 'input' || tag === 'textarea' || tag === 'select' || el.getAttribute('contenteditable') === 'true';
            }

            function handleKeyDown(e) {
                var inInput = isInputField(document.activeElement);

                // ? toggles help modal
                if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
                    e.preventDefault();
                    setModals(prev => ({ ...prev, help: !prev.help }));
                    return;
                }

                // Ctrl+Shift+N — open create credential (Ctrl+N is browser new window)
                if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n') && !inInput) {
                    e.preventDefault();
                    setEditingCredential(null);
                    setModals(prev => ({ ...prev, form: true }));
                    return;
                }

                // Escape — close any open modal
                if (e.key === 'Escape' && !inInput) {
                    setModals(prev => ({
                        form: false,
                        password: false,
                        delete: false,
                        import: false,
                        bulkDelete: false,
                        result: false,
                        help: false,
                    }));
                    return;
                }
            }
            document.addEventListener('keydown', handleKeyDown);
            return function() { document.removeEventListener('keydown', handleKeyDown); };
        }, []);

        // Load credentials on mount
        React.useEffect(() => {
            loadCredentials();
        }, []);

        // Fetch reference data on mount (apps, users list, roles) + detect current user
        React.useEffect(() => {
            async function fetchReferenceData() {
                try {
                    const [appsResult, usersResult, rolesResult] = await Promise.allSettled([
                        API.getApps(),
                        API.getUsers(),
                        API.getRoles(),
                    ]);
                    setRefData(prev => {
                        const next = { ...prev };
                        if (appsResult.status === 'fulfilled') {
                            next.apps = appsResult.value;
                        }
                        if (usersResult.status === 'fulfilled' && usersResult.value) {
                            next.users = usersResult.value;
                        }
                        if (rolesResult.status === 'fulfilled') {
                            next.roles = rolesResult.value;
                        }
                        return next;
                    });
                } catch (err) {
                    console.warn('Failed to load reference data, continuing with defaults:', err.message);
                }

                // Get current user identity from Splunk.util (matches legacy currentUser())
                const currentUser = API.getCurrentUser();
                setRefData(prev => ({ ...prev, currentUserIdentity: currentUser }));
            }
            fetchReferenceData();
        }, []);

        // Compute filtered credentials (same logic as CredentialTable)
        const filteredCredentials = React.useMemo(function() {
            return credentials.filter(function(credential) {
                var name = (credential.name || '').toLowerCase();
                var realm = (credential.realm || '').toLowerCase();
                var app = (credential.app || '').toLowerCase();
                var owner = (credential.owner || '').toLowerCase();
                var aclRead = (credential.aclRead || '').toLowerCase();
                var aclWrite = (credential.aclWrite || '').toLowerCase();
                var mtime = (credential.mtime || '').toString();

                // Text search across all fields
                if (filterText) {
                    var search = filterText.toLowerCase();
                    if (!(name.includes(search) || realm.includes(search) || app.includes(search) || owner.includes(search) || aclRead.includes(search) || aclWrite.includes(search) || mtime.includes(search))) {
                        return false;
                    }
                }

                // Active filters — AND logic, exact match per field
                for (var i = 0; i < activeFilters.length; i++) {
                    var f = activeFilters[i];
                    var val = f.value.toLowerCase();
                    if (f.field === 'username' && name !== val) return false;
                    if (f.field === 'realm') {
                        var isGlobal = !credential.realm || credential.realm === 'nobody';
                        if (val === 'global' && !isGlobal) return false;
                        if (val !== 'global' && ((credential.realm || '').toLowerCase()) !== val) return false;
                    }
                    if (f.field === 'app' && (credential.app || '').toLowerCase() !== val) return false;
                    if (f.field === 'owner' && (credential.owner || '').toLowerCase() !== val) return false;
                    if (f.field === 'readRoles' && aclRead !== val) return false;
                    if (f.field === 'writeRoles' && aclWrite !== val) return false;
                    if (f.field === 'modified' && mtime !== val) return false;
                }

                return true;
            });
        }, [credentials, filterText, activeFilters]);

        // Compute sorted credentials (same logic as CredentialTable)
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

        // Refs for export — dropdown renders via portal, so onClick handlers capture stale closures.
        // Reading from refs at click time ensures we get the latest filtered/selected data.
        const sortedCredentialsRef = React.useRef(sortedCredentials);
        const filteredCredentialsRef = React.useRef(filteredCredentials);
        const selectedRowsRef = React.useRef(selectedRows);
        sortedCredentialsRef.current = sortedCredentials;
        filteredCredentialsRef.current = filteredCredentials;
        selectedRowsRef.current = selectedRows;

        // ─── Result modal helpers ──────────────────────────────────────
        function showSuccess(title, messages) {
            setResult({ title, messages: typeof messages === 'string' ? [messages] : messages });
            setModals(prev => ({ ...prev, result: true }));
        }

        function showError(title, messages) {
            setResult({ title, messages: typeof messages === 'string' ? [messages] : messages });
            setModals(prev => ({ ...prev, result: true }));
        }

        // ─── Credential operations ─────────────────────────────────────

        async function loadCredentials() {
            setData(prev => ({ ...prev, loading: true, error: null }));
            try {
                const fetched = await API.getAllCredentials();
                setData(prev => ({ ...prev, credentials: fetched }));
            } catch (err) {
                console.error('Error loading credentials:', err);
                setData(prev => ({ ...prev, error: getErrorMessage(err) }));
            } finally {
                setData(prev => ({ ...prev, loading: false }));
            }
        }

        async function handleCreateCredential(data) {
            try {
                await API.createCredential(
                    data.username, data.password, data.realm,
                    data.app, data.owner, data.readRoles, data.writeRoles,
                    data.sharing || 'app'
                );
                await loadCredentials();
                setModals(prev => ({ ...prev, form: false }));
                setEditingCredential(null);
                setCopyCredential(null);
                showSuccess('Credential Created', [
                    `Created <strong>${escapeHtml(data.username)}</strong>`,
                    'ACLs applied successfully'
                ]);
            } catch (err) {
                console.error('Error creating credential:', err);
                const parseResult = API.parseCreateError ? API.parseCreateError(err) : null;
                if (parseResult && parseResult.isDuplicate) {
                    showError('Create Failed', [parseResult.message]);
                } else {
                    showError('Failed to Create Credential', [`Error: ${getErrorMessage(err)}`]);
                }
            }
        }

        async function handleUpdateCredential(credential, data) {
            const messages = [];
            try {
                await API.updateCredential(
                    credential.name, credential.realm,
                    data.password, data.readRoles, data.writeRoles,
                    data.owner, data.app, data.sharing || 'app', credential.app
                );
                await loadCredentials();
                setModals(prev => ({ ...prev, form: false }));
                setEditingCredential(null);
                messages.push('ACLs updated successfully');
                if (data.password) {
                    messages.unshift(`Password updated for <strong>${escapeHtml(credential.name)}</strong>`);
                } else {
                    messages.unshift(`Credential <strong>${escapeHtml(credential.name)}</strong> updated`);
                }
                showSuccess('Credential Updated', messages);
            } catch (err) {
                console.error('Error updating credential:', err);
                showError('Failed to Update Credential', [`Error: ${getErrorMessage(err)}`]);
            }
        }

        async function handleDeleteCredential() {
            if (!selectedCredential) return;
            try {
                // Fetch password for undo before deleting
                var password;
                try {
                    password = await API.getCredentialPassword(
                        selectedCredential.name, selectedCredential.realm,
                        selectedCredential.app, selectedCredential.owner || 'nobody',
                        selectedCredential.sharing || 'app'
                    );
                } catch (e) {
                    console.warn('Could not fetch password for undo:', e);
                }
                var credForUndo = Object.assign({}, selectedCredential);
                credForUndo._password = password;
                await API.deleteCredential(
                    selectedCredential.name, selectedCredential.realm,
                    selectedCredential.app, selectedCredential.owner || 'nobody',
                    selectedCredential.aclRead?.split(',').filter(Boolean) || ['*'],
                    selectedCredential.aclWrite?.split(',').filter(Boolean) || [selectedCredential.owner || 'nobody'],
                    selectedCredential.sharing || 'app'
                );
                await loadCredentials();
                setModals(prev => ({ ...prev, delete: false }));
                setUndoCredentials([credForUndo]);
                setUndoSecondsLeft(10);
                setSelectedCredential(null);
            } catch (err) {
                console.error('Error deleting credential:', err);
                showError('Failed to Delete Credential', ['Error: ' + getErrorMessage(err)]);
            }
        }

        // Undo delete — recreate credential(s)
        async function handleUndoDelete() {
            if (!undoCredentials.length) return;
            var creds = undoCredentials;
            setUndoCredentials([]);
            setUndoSecondsLeft(0);
            try {
                const results = await Promise.allSettled(
                    creds.map(function(cred) {
                        if (!cred._password) {
                            return Promise.reject(new Error('Password was not available for undo'));
                        }
                        return API.createCredential(
                            cred.name,
                            cred._password,
                            cred.realm || '',
                            cred.app || 'search',
                            cred.owner || 'nobody',
                            cred.aclRead ? cred.aclRead.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
                            cred.aclWrite ? cred.aclWrite.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
                            cred.sharing || 'app'
                        );
                    })
                );
                await loadCredentials();
                var successMsgs = [];
                var errorMsgs = [];
                results.forEach(function(result, i) {
                    var c = creds[i];
                    if (result.status === 'fulfilled') {
                        successMsgs.push('Restored ' + escapeHtml(c.name));
                    } else {
                        errorMsgs.push(escapeHtml(c.name) + ': ' + getErrorMessage(result.reason));
                    }
                });
                if (errorMsgs.length === 0) {
                    showSuccess('Undo Delete', successMsgs);
                } else if (successMsgs.length === 0) {
                    showError('Undo Failed', errorMsgs);
                } else {
                    var allMsgs = successMsgs.concat(['---'], errorMsgs);
                    setResult({ title: 'Undo Delete — Partial', messages: allMsgs });
                    setModals(prev => ({ ...prev, result: true }));
                }
            } catch (err) {
                console.error('Error undoing delete:', err);
                showError('Undo Failed', ['Error: ' + getErrorMessage(err)]);
            }
        }

        // ─── Bulk delete handler ──────────────────────────────────────
        async function handleBulkDeleteConfirm() {
            if (!selectedRows.length) return;
            const successMessages = [];

            try {
                // Fetch passwords for undo before deleting
                var credsForUndo = await Promise.all(
                    selectedRows.map(async function(row) {
                        var password;
                        try {
                            password = await API.getCredentialPassword(
                                row.name, row.realm, row.app,
                                row.owner || 'nobody',
                                row.sharing || 'app'
                            );
                        } catch (e) {
                            console.warn('Could not fetch password for undo (' + row.name + '):', e);
                        }
                        var cred = Object.assign({}, row);
                        cred._password = password;
                        return cred;
                    })
                );

                const results = await Promise.allSettled(
                    selectedRows.map(row =>
                        API.deleteCredential(
                            row.name, row.realm, row.app,
                            row.owner || 'nobody',
                            row.aclRead?.split(',').filter(Boolean) || ['*'],
                            row.aclWrite?.split(',').filter(Boolean) || [row.owner || 'nobody'],
                            row.sharing || 'app'
                        ).catch(err => { throw err; })
                    )
                );

                let errorMessages = [];
                var deletedForUndo = [];
                results.forEach((result, i) => {
                    const row = selectedRows[i];
                    if (result.status === 'fulfilled') {
                        successMessages.push('Deleted ' + escapeHtml(row.name));
                        deletedForUndo.push(credsForUndo[i]);
                    } else {
                        errorMessages.push(escapeHtml(row.name) + ': ' + getErrorMessage(result.reason));
                    }
                });

                await loadCredentials();
                handleDeselectAll();

                // Set undo state for successfully deleted credentials
                if (deletedForUndo.length > 0) {
                    setUndoCredentials(deletedForUndo);
                    setUndoSecondsLeft(10);
                }

                if (errorMessages.length === 0) {
                    // Toast will show, skip redundant success modal
                    if (deletedForUndo.length === selectedRows.length) {
                        return;
                    }
                }
                if (errorMessages.length === 0) {
                    showSuccess('Bulk Delete Complete', successMessages);
                } else if (successMessages.length === 0) {
                    showError('Bulk Delete Failed', errorMessages.map(m => 'ERROR: ' + m));
                } else {
                    const allMsgs = successMessages.concat(
                        ['---'],
                        errorMessages.map(m => 'ERROR: ' + m)
                    );
                    setResult({ title: 'Bulk Delete -- Partial Success', messages: allMsgs });
                    setModals(prev => ({ ...prev, result: true }));
                }
            } catch (err) {
                console.error('Error in bulk delete:', err);
                showError('Bulk Delete Failed', ['Error: ' + getErrorMessage(err)]);
            }
        }

        // ─── Bulk edit handler ───────────────────────────────────────
        async function handleBulkEdit(updates, callback) {
            var successMessages = [];
            var errorMessages = [];

            // Normalize roles: map '* (all)' → '*' for the API
            function normalizeRoles(rolesStr) {
                if (!rolesStr) return undefined;
                var roles = rolesStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
                if (roles.includes('* (all)')) return ['*'];
                return roles;
            }

            try {
                var results = await Promise.allSettled(
                    updates.map(function(c) {
                        // updateCredential(name, realm, password, readRoles, writeRoles, owner, newApp, sharing, sourceApp)
                        // No password change — only ACL/owner updates
                        return API.updateCredential(
                            c.name,
                            c.realm || '',
                            null,
                            normalizeRoles(c.aclRead),
                            normalizeRoles(c.aclWrite),
                            c.owner || undefined,
                            undefined,
                            c.sharing || 'app',
                            c.app || 'search'
                        ).catch(function(err) { throw err; });
                    })
                );

                results.forEach(function(result, i) {
                    var c = updates[i];
                    if (result.status === 'fulfilled') {
                        successMessages.push('Updated <strong>' + escapeHtml(c.name) + '</strong>');
                    } else {
                        errorMessages.push('<strong>' + escapeHtml(c.name) + '</strong>: ' + getErrorMessage(result.reason));
                    }
                });

                await loadCredentials();
                handleDeselectAll();
                setModals(prev => ({ ...prev, bulkEdit: false }));

                if (errorMessages.length === 0) {
                    showSuccess('Bulk Edit Complete', successMessages);
                } else if (successMessages.length === 0) {
                    showError('Bulk Edit Failed', errorMessages.map(function(m) { return 'ERROR: ' + m; }));
                } else {
                    var allMsgs = successMessages.concat(['---'], errorMessages.map(function(m) { return 'ERROR: ' + m; }));
                    setResult({ title: 'Bulk Edit -- Partial Success', messages: allMsgs });
                    setModals(prev => ({ ...prev, result: true }));
                }
            } catch (err) {
                console.error('Error in bulk edit:', err);
                setModals(prev => ({ ...prev, bulkEdit: false }));
                showError('Bulk Edit Failed', ['Error: ' + getErrorMessage(err)]);
            } finally {
                if (callback) callback();
            }
        }

        // ─── CSV import handler ───────────────────────────────────────
        // Called by ImportCSVModal with pre-parsed (parsedRows, parseErrors) after user confirms preview

        async function handleCSVImport(parsedRows, parseErrors) {
            if (!parsedRows || parsedRows.length === 0) {
                showSuccess('CSV Import -- Nothing to Import', ['No valid rows found in file.']);
                return;
            }

            setModals(prev => ({ ...prev, import: false }));
            const successMessages = [];
            const errorMessages = [];

            try {
                const results = await Promise.allSettled(
                    parsedRows.map(row =>
                        API.createCredential(
                            row.username, row.password, row.realm,
                            row.app, row.owner,
                            row.read.split(',').map(r => r.trim()).filter(Boolean),
                            row.write.split(',').map(r => r.trim()).filter(Boolean),
                            row.sharing || 'app'
                        ).catch(err => { throw err; })
                    )
                );

                results.forEach((result, i) => {
                    const row = parsedRows[i];
                    var label = `${row.realm ? escapeHtml(row.realm) : ''}:${escapeHtml(row.username)}`;
                    if (result.status === 'fulfilled') {
                        successMessages.push(label);
                    } else {
                        var msg = result.reason && result.reason.status === 409 ? 'already exists' : getErrorMessage(result.reason);
                        errorMessages.push(`${label} \u2014 ${msg}`);
                    }
                });

                await loadCredentials();

                const succeeded = successMessages.length;
                const failed = parsedRows.length - succeeded;

                if (failed === 0 && parseErrors.length === 0) {
                    showSuccess('Import Complete', [`${succeeded} imported successfully`]);
                } else if (failed === 0) {
                    showSuccess('Import Complete', [
                        `${succeeded} imported successfully`,
                        '<br/>--- Warnings ---'
                    ].concat(parseErrors.map(function(e) { return 'WARN: ' + e; })));
                } else {
                    var allMsgs = [];
                    if (succeeded > 0) allMsgs.push(`${succeeded} imported successfully`);
                    if (failed > 0) allMsgs.push(`, ${failed} failed`);
                    if (parseErrors.length > 0) allMsgs.push('<br/>--- Warnings ---');
                    allMsgs = allMsgs.concat(
                        errorMessages.map(function(m) { return 'ERROR: ' + m; }),
                        parseErrors.map(function(e) { return 'WARN: ' + e; })
                    );
                    setResult({ title: 'Import Complete', messages: allMsgs });
                    setModals(prev => ({ ...prev, result: true }));
                }
            } catch (err) {
                console.error('Error during CSV import:', err);
                showError('CSV Import Failed', [`Error: ${getErrorMessage(err)}`]);
            }
        }

        // ─── CSV template download handler ────────────────────────────
        function handleDownloadTemplate() {
            const content = API.generateCSVTemplate();
            const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'credential-import-template.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // ─── CSV export handler ───────────────────────────────────────
        function handleExportCSV(mode) {
            var credsToExport;
            var filename;
            if (mode === 'selected') {
                credsToExport = selectedRowsRef.current.length > 0 ? selectedRowsRef.current : credentials;
                filename = 'credentials-selected-export.csv';
            } else if (mode === 'filtered') {
                credsToExport = filteredCredentialsRef.current;
                filename = 'credentials-filtered-export.csv';
            } else {
                credsToExport = credentials;
                filename = 'credentials-export.csv';
            }
            const content = API.generateExportCSV(credsToExport);
            const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // ─── Selection handlers ────────────────────────────────────────

        // Unique key for a credential — stanzaKey can repeat across apps/owners/sharing
        function credKey(cred) {
            return cred.stanzaKey + ':' + cred.app + ':' + cred.owner + ':' + cred.sharing;
        }

        function handleSelectRow(cred) {
            setSelectedRows(prev => {
                const exists = prev.findIndex(r => credKey(r) === credKey(cred));
                if (exists >= 0) {
                    return prev.filter((_, i) => i !== exists);
                }
                return [...prev, cred];
            });
        }

        function handleSelectAll(filtered) {
            setSelectedRows(prev => {
                var pageKeys = new Set(filtered.map(function(r) { return credKey(r); }));
                var existing = prev.filter(function(r) { return !pageKeys.has(credKey(r)); });
                return existing.concat(filtered);
            });
        }

        function handleDeselectPage(pageCredentials) {
            var pageKeys = new Set(pageCredentials.map(function(r) { return credKey(r); }));
            setSelectedRows(prev => prev.filter(function(r) { return !pageKeys.has(credKey(r)); }));
        }

        function handleDeselectAll() {
            setSelectedRows([]);
        }

        /** HTML escape helper -- sanitizes dynamic content for innerHTML rendering */
        function escapeHtml(str) {
            return String(str ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        if (loading) {
            return React.createElement('div', { className: 'credential-manager-app', style: { padding: '2rem' } }, React.createElement('p', null, 'Loading credentials...'));
        }

        if (error) {
            return React.createElement('div', { className: 'credential-manager-app', style: { padding: '2rem', border: '1px solid #ff4444', borderRadius: '8px', backgroundColor: '#fff5f5' } },
                React.createElement('div', { style: { color: '#d32f2f', marginBottom: '1rem', fontWeight: 'bold' } }, 'Error: ' + error),
                React.createElement('p', { style: { fontSize: '14px', color: '#666', marginBottom: '1rem' } }, 'Check browser console for details. Ensure you have the required Splunk capabilities (admin_all_objects, list_storage_passwords).'),
                React.createElement(Button, { onClick: loadCredentials, children: 'Retry' })
            );
        }

        return React.createElement('div', { className: 'credential-manager-app' },
            // Toolbar with actions
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' } },
                React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
                    selectedRows.length > 0 && React.createElement('span', { style: { color: '#666', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '0.35rem' } },
                        `${selectedRows.length} selected`,
                        React.createElement('span', {
                            onClick: handleDeselectAll,
                            style: { cursor: 'pointer', color: '#999', fontSize: '16px', fontWeight: 'bold', marginLeft: '0.25rem' },
                            title: 'Clear selection'
                        }, '\u00d7')
                    ),
                    selectedRows.length > 0 && React.createElement(Button, {
                        onClick: () => {
                            if (selectedRows.length === 1) {
                                setEditingCredential({
                                    name: selectedRows[0].name,
                                    realm: selectedRows[0].realm,
                                    app: selectedRows[0].app,
                                    owner: selectedRows[0].owner,
                                    sharing: selectedRows[0].sharing,
                                    aclRead: selectedRows[0].aclRead || '',
                                    aclWrite: selectedRows[0].aclWrite || '',
                                });
                                setModals(prev => ({ ...prev, form: true }));
                            } else {
                                setModals(prev => ({ ...prev, bulkEdit: true }));
                            }
                        },
                        appearance: 'subtle',
                        children: `Edit Selected (${selectedRows.length})`
                    }),
                    selectedRows.length > 0 && React.createElement(Button, {
                        onClick: () => setModals(prev => ({ ...prev, bulkDelete: true })),
                        appearance: 'destructive',
                        children: `Delete Selected (${selectedRows.length})`
                    }),
                    React.createElement(Button, { onClick: () => { setEditingCredential(null); setModals(prev => ({ ...prev, form: true })); }, appearance: 'primary', children: 'Create Credential' }),
                    React.createElement(Dropdown, {
                        open: moreDropdownOpen,
                        onRequestOpen: () => setMoreDropdownOpen(true),
                        onRequestClose: () => setMoreDropdownOpen(false),
                        closeReasons: ['clickAway', 'escapeKey', 'toggleClick'],
                        toggle: React.createElement(Button, { label: '⋮', appearance: 'subtle', title: 'Import/Export' })
                    },
                        React.createElement('div', { style: { padding: '0.25rem 0' } },
                            React.createElement(Button, {
                                onClick: () => { setMoreDropdownOpen(false); handleDownloadTemplate(); },
                                appearance: 'subtle',
                                children: 'Download Template',
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }
                            }),
                            React.createElement(Button, {
                                onClick: () => { setMoreDropdownOpen(false); setModals(prev => ({ ...prev, import: true })); },
                                appearance: 'subtle',
                                children: 'Import CSV',
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }
                            }),
                            React.createElement(Button, {
                                onClick: () => { setMoreDropdownOpen(false); handleExportCSV('all'); },
                                appearance: 'subtle',
                                children: 'Export All CSV',
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }
                            }),
                            React.createElement(Button, {
                                onClick: () => { setMoreDropdownOpen(false); handleExportCSV('filtered'); },
                                appearance: 'subtle',
                                children: 'Export Filtered CSV',
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }
                            }),
                            React.createElement(Button, {
                                onClick: () => { setMoreDropdownOpen(false); handleExportCSV('selected'); },
                                appearance: 'subtle',
                                children: 'Export Selected CSV',
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px' }
                            })
                        )
                    ),
                    React.createElement(Button, { onClick: () => setModals(prev => ({ ...prev, help: true })), appearance: 'subtle', title: 'Help', children: '?' })
                )
            ),

            // Credentials table
            React.createElement(CredentialTable, {
                credentials: sortedCredentials,
                selectedRows,
                onDelete: (credential) => { setSelectedCredential(credential); setModals(prev => ({ ...prev, delete: true })); },
                onReveal: (credential) => { setSelectedCredential(credential); setModals(prev => ({ ...prev, password: true })); },
                onSelectRow: handleSelectRow,
                onSelectAll: handleSelectAll,
                onDeselectPage: handleDeselectPage,
                onEdit: function(credential) { setEditingCredential(credential); setModals(prev => ({ ...prev, form: true })); },
                onCopy: function(credential) { setCopyCredential(credential); setEditingCredential(null); setModals(prev => ({ ...prev, form: true })); },
                filterText: filterText,
                onFilterChange: setFilterText,
                activeFilters: activeFilters,
                onActiveFiltersChange: setActiveFilters,
                sortConfig: sortConfig,
                onSortChange: setSortConfig,
            }),

            // Undo delete toast
            undoCredentials.length > 0 && React.createElement(
                'div',
                { style: { position: 'fixed', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', background: '#333', color: '#fff', padding: '0.5rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '1rem', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 9999 } },
                React.createElement('span', null,
                    undoCredentials.length + ' credential(s) deleted',
                    undoCredentials.length === 1 ? React.createElement('strong', null, ' ' + escapeHtml(undoCredentials[0].name)) : null
                ),
                React.createElement(Button, {
                    onClick: handleUndoDelete,
                    appearance: 'primary',
                    children: 'Undo',
                    style: { padding: '4px 12px', fontSize: '13px' }
                }),
                React.createElement('span', {
                    style: { fontSize: '12px', color: '#aaa' }
                }, undoSecondsLeft + 's')
            ),

            // Form modal — dedicated modal wrapper for CredentialForm
            modals.form && React.createElement(FormModal, {
                isOpen: modals.form,
                onClose: () => { setModals(prev => ({ ...prev, form: false })); setEditingCredential(null); setCopyCredential(null); },
                title: copyCredential ? 'Copy Credential' : (editingCredential ? 'Edit Credential' : 'Create Credential'),
            }, React.createElement(CredentialForm, {
                credential: copyCredential || editingCredential,
                isCopy: !!copyCredential,
                onSave: copyCredential ? handleCreateCredential : (editingCredential ? function(formData) { handleUpdateCredential(editingCredential, formData); } : handleCreateCredential),
                onCancel: () => { setModals(prev => ({ ...prev, form: false })); setEditingCredential(null); setCopyCredential(null); },
                availableApps: refData.apps,
                availableUsers: refData.users,
                currentUserIdentity: refData.currentUserIdentity,
                availableRoles: refData.roles,
                defaultReadRoles: DEFAULT_READ,
                defaultWriteRoles: DEFAULT_WRITE,
            })),

            // Password reveal modal
            modals.password && React.createElement(PasswordRevealModal, {
                credential: selectedCredential,
                onClose: () => { setModals(prev => ({ ...prev, password: false })); setSelectedCredential(null); },
            }),

            // Delete confirmation modal — single credential only
            modals.delete && React.createElement(ConfirmDeleteModal, {
                credential: selectedCredential,
                isOpen: modals.delete,
                onClose: () => { setModals(prev => ({ ...prev, delete: false })); setSelectedCredential(null); },
                onDelete: handleDeleteCredential,
            }),

            // CSV import modal — wired to proper handler
            modals.import && React.createElement(ImportCSVModal, {
                isOpen: modals.import,
                onClose: () => setModals(prev => ({ ...prev, import: false })),
                onImport: handleCSVImport,
            }),

            // Bulk edit modal
            modals.bulkEdit && React.createElement(BulkEditModal, {
                isOpen: modals.bulkEdit,
                selectedRows: selectedRows,
                availableRoles: refData.roles,
                availableUsers: refData.users,
                onClose: () => setModals(prev => ({ ...prev, bulkEdit: false })),
                onApply: handleBulkEdit,
            }),

            // Bulk delete confirmation modal
            modals.bulkDelete && React.createElement(BulkDeleteModal, {
                isOpen: modals.bulkDelete,
                selectedRows: selectedRows,
                onClose: () => setModals(prev => ({ ...prev, bulkDelete: false })),
                onConfirm: handleBulkDeleteConfirm,
            }),

            // Result modal
            modals.result && React.createElement(ResultModal, {
                title: result.title,
                messages: result.messages,
                onClose: () => setModals(prev => ({ ...prev, result: false })),
            }),

            // Help modal
            modals.help && React.createElement(HelpModal, {
                onClose: () => setModals(prev => ({ ...prev, help: false })),
            })
        );
    }

    /**
     * FormModal — dedicated modal wrapper for credential form with proper styling
     * Replaces misuse of ConfirmDeleteModal as generic form container.
     */
    function FormModal({ isOpen, onClose, title, children }) {
        if (!isOpen) return null;

        var prevRef = React.useRef(null);
        React.useEffect(function() {
            prevRef.current = document.activeElement;
        }, [title]);

        function handleReturnFocus() {
            if (prevRef.current && typeof prevRef.current.focus === 'function') {
                prevRef.current.focus();
            }
        }

        return React.createElement(Modal, {
            open: isOpen,
            onRequestClose: function() { onClose(); },
            returnFocus: handleReturnFocus,
            divider: 'both',
            style: { width: '800px', maxWidth: '95%', maxHeight: '90vh' }
        },
            React.createElement('div', null,
                React.createElement(Modal.Header, null,
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '500' } }, title || 'Create/Edit Credential')
                ),
                React.createElement(Modal.Body, { style: { overflow: 'visible' } }, children)
            )
        );
    }

    /**
     * ResultModal — structured feedback for operations. Replaces all alert() calls.
     * Matches legacy showModal pattern with per-step success/error messages.
     */
    function ResultModal({ title, messages, onClose }) {
        var prevRef = React.useRef(null);
        React.useEffect(function() {
            prevRef.current = document.activeElement;
        }, [title]);

        function handleReturnFocus() {
            if (prevRef.current && typeof prevRef.current.focus === 'function') {
                prevRef.current.focus();
            }
        }

        // Determine overall status from messages
        var contentMessages = messages.filter(function(m) {
            return m !== '<br/>' && !m.startsWith('<br/>-') && m !== '---';
        });
        var errorCount = contentMessages.filter(function(m) {
            return m.startsWith('ERROR') || /failed/i.test(m);
        }).length;
        var hasErrors = errorCount > 0;
        var hasSuccess = contentMessages.length - errorCount > 0;

        var statusBg, statusBorder, statusIconColor;
        if (hasErrors && hasSuccess) {
            statusBg = '#fff8e1';
            statusBorder = '#ff9800';
            statusIconColor = '#ff9800';
        } else if (hasErrors) {
            statusBg = '#ffebee';
            statusBorder = '#d32f2f';
            statusIconColor = '#d32f2f';
        } else {
            statusBg = '#e8f5e9';
            statusBorder = '#4caf50';
            statusIconColor = '#4caf50';
        }

        return React.createElement(Modal, {
            open: true,
            onRequestClose: function() { onClose(); },
            returnFocus: handleReturnFocus,
            divider: 'both',
            style: { width: '550px', maxWidth: '90%' }
        },
            React.createElement('div', null,
                React.createElement(Modal.Header, null,
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                        React.createElement('span', { style: { color: statusIconColor } },
                            hasErrors && !hasSuccess
                                ? React.createElement(CrossCircle, null)
                                : React.createElement(CheckCircle, null)
                        ),
                        title
                    )
                ),
                React.createElement(Modal.Body, {
                    style: {
                        maxHeight: '60vh',
                        overflowY: 'auto',
                        backgroundColor: statusBg,
                        border: '1px solid ' + statusBorder,
                        borderRadius: '4px',
                        padding: '1rem'
                    }
                },
                    messages.map(function(msg, i) {
                        if (msg === '<br/>' || msg.startsWith('<br/>-') || msg === '---') {
                            return React.createElement('hr', { key: i, style: { margin: '0.75rem 0', border: 'none', borderTop: '1px solid ' + statusBorder + '40' } });
                        }
                        var isError = msg.startsWith('ERROR') || /failed/i.test(msg);
                        return React.createElement('div', {
                            key: i,
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                margin: '0.25rem 0'
                            }
                        },
                            React.createElement('span', { style: { flexShrink: 0, color: isError ? '#d32f2f' : '#4caf50' } },
                                isError ? React.createElement(CrossCircle, null) : React.createElement(CheckCircle, null)
                            ),
                            React.createElement('span', {
                                style: { color: isError ? '#d32f2f' : '#172b4d', flex: 1 },
                                dangerouslySetInnerHTML: { __html: msg }
                            })
                        );
                    })
                ),
                React.createElement(Modal.Footer, { itemAlign: 'end' },
                    React.createElement(Button, { onClick: () => onClose(), appearance: 'primary' }, 'Close')
                )
            )
        );
    }

    /**
     * BulkDeleteModal — confirmation modal listing selected credentials before bulk delete
     */
    function BulkDeleteModal({ isOpen, selectedRows, onClose, onConfirm }) {
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

        return React.createElement(Modal, {
            open: true,
            onRequestClose: function() { onClose(); },
            returnFocus: handleReturnFocus,
            divider: 'both',
            style: { width: '550px', maxWidth: '90%' }
        },
            React.createElement('div', null,
                React.createElement(Modal.Header, null,
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                        React.createElement('span', { style: { color: '#d32f2f' } }, React.createElement(ExclamationTriangle, null)),
                        `Delete ${selectedRows.length} Credential${selectedRows.length !== 1 ? 's' : ''}`
                    )
                ),
                React.createElement(Modal.Body, { style: { maxHeight: '60vh', overflowY: 'auto' } },
                    React.createElement('p', null, 'Are you sure you want to delete the following credential(s)? This action cannot be undone.'),
                    selectedRows.map(function(row, i) {
                        return React.createElement('div', {
                            key: i,
                            style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }
                        },
                            React.createElement('span', { style: { color: '#d32f2f', flexShrink: 0 } }, React.createElement(TrashCanCross, null)),
                            React.createElement('strong', null, row.name),
                            row.realm ? React.createElement('span', null, `(${row.realm})`) : null
                        );
                    })
                ),
                React.createElement(Modal.Footer, { itemAlign: 'end' },
                    React.createElement(Button, { onClick: onClose, children: 'Cancel' }),
                    React.createElement(Button, { onClick: function() { onClose(); onConfirm(); }, appearance: 'destructive', children: 'Delete' })
                )
            )
        );
    }



    /**
     * ThemeAwareApp — detects Splunk's theme and wraps children with SplunkThemeProvider
     * using the correct colorScheme. This lives outside CredentialManager so the provider
     * sits at the top of the tree, allowing Splunk's styled-components to resolve tokens
     * (interactiveColorOverlayDrag, etc.) correctly.
     */
    function ThemeAwareApp({ appComponent: App, appProps }) {
        function detectDark() {
            var html = document.documentElement;
            if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
            if (html.getAttribute('data-theme') === 'dark') return true;
            var body = document.body;
            if (body && body.classList.contains('dark-theme')) return true;
            // Fallback: check computed background brightness — Splunk may use a different class name
            try {
                var bg = getComputedStyle(body || html).backgroundColor;
                var match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (match) {
                    var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
                    var brightness = (r * 299 + g * 587 + b * 114) / 1000;
                    if (brightness < 128) return true;
                }
            } catch (e) {}
            return false;
        }

        var _dark = React.useState(detectDark);
        var darkTheme = _dark[0];
        var setDarkTheme = _dark[1];

        React.useEffect(function() {
            setDarkTheme(detectDark());
            var observer = new MutationObserver(function() {
                setDarkTheme(detectDark());
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
            if (document.body) {
                observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
            }
            return function() { observer.disconnect(); };
        }, []);

        // Sync dark-theme class to document.documentElement BEFORE children render.
        // This must be imperative (not useEffect) so CredentialTable.jsx reads isDark correctly
        // on its initial render. Clean up on unmount or theme change.
        if (darkTheme) {
            document.documentElement.classList.add('dark-theme');
        } else {
            document.documentElement.classList.remove('dark-theme');
        }
        React.useEffect(function() {
            return function() { document.documentElement.classList.remove('dark-theme'); };
        }, []);

        return React.createElement(SplunkThemeProvider, {
            family: 'enterprise',
            colorScheme: darkTheme ? 'dark' : 'light'
        },
            React.createElement(GlobalStyles, null),
            React.createElement(App, appProps || null)
        );
    }

    window.CredentialManager = {
        Component: CredentialManager,
        _initialized: false,
        init: function(mvc) {
            if (window.CredentialManager._initialized) return;
            window.CredentialManager._initialized = true;
            console.log('Credential Manager: Initializing...');
            if (mvc) {
                window.CredentialManager.mvc = mvc;
            }

            let container = document.getElementById('credential-manager-app');
            if (!container) {
                console.warn('Credential Manager: Container not found, retrying in 100ms...');
                setTimeout(window.CredentialManager.init, 100);
                return;
            }
            const root = ReactDOM.createRoot(container);
            root.render(React.createElement(ThemeAwareApp, {
                appComponent: CredentialManager
            }));
            console.log('Credential Manager: Render complete');
        }
    };

    if (typeof window.require === 'function') {
        window.require(['splunkjs/mvc/simplexml/ready!', 'splunkjs/mvc'], function(ready, mvc) {
            window.CredentialManager.init(mvc);

            // AuditLog init — guard against double init
            if (window.CredentialManager._auditInitialized) return;
            window.CredentialManager._auditInitialized = true;
            var auditContainer = document.getElementById('audit-log-app');
            if (auditContainer) {
                var auditRoot = ReactDOM.createRoot(auditContainer);
                auditRoot.render(React.createElement(ThemeAwareApp, {
                    appComponent: AuditLog,
                    appProps: { mvc: mvc }
                }));
            }
        });
    } else {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => window.CredentialManager.init());
        } else {
            window.CredentialManager.init();
        }
    }
})();
