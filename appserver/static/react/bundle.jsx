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
const ModalMod = require('@splunk/react-ui/Modal');
var Modal = ModalMod.default;
ModalMod.Header && (Modal.Header = ModalMod.Header);
ModalMod.Body && (Modal.Body = ModalMod.Body);
ModalMod.Footer && (Modal.Footer = ModalMod.Footer);
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
const API = require('./api');
const { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal } = require('./components/Modal');

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
            result: false,
            bulkDelete: false,
        });

        // Modal data
        const [selectedCredential, setSelectedCredential] = React.useState(null);
        const [editingCredential, setEditingCredential] = React.useState(null);

        // Result modal content — consolidated title + messages
        const [result, setResult] = React.useState({
            title: '',
            messages: [],
        });

        // Bulk selection
        const [selectedRows, setSelectedRows] = React.useState([]);

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
                await API.deleteCredential(
                    selectedCredential.name, selectedCredential.realm,
                    selectedCredential.app, selectedCredential.owner || 'nobody',
                    selectedCredential.aclRead?.split(',').filter(Boolean) || ['*'],
                    selectedCredential.aclWrite?.split(',').filter(Boolean) || [selectedCredential.owner || 'nobody'],
                    selectedCredential.sharing || 'app'
                );
                await loadCredentials();
                setModals(prev => ({ ...prev, delete: false }));
                setSelectedCredential(null);
                showSuccess('Credential Deleted', [`Deleted <strong>${escapeHtml(selectedCredential.name)}</strong>`]);
            } catch (err) {
                console.error('Error deleting credential:', err);
                showError('Failed to Delete Credential', [`Error: ${getErrorMessage(err)}`]);
            }
        }

        // ─── Bulk delete handler ──────────────────────────────────────
        async function handleBulkDeleteConfirm() {
            if (!selectedRows.length) return;
            const successMessages = [];

            try {
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
                results.forEach((result, i) => {
                    const row = selectedRows[i];
                    if (result.status === 'fulfilled') {
                        successMessages.push(`Deleted <strong>${escapeHtml(row.name)}</strong>`);
                    } else {
                        errorMessages.push(`<strong>${escapeHtml(row.name)}</strong>: ${getErrorMessage(result.reason)}`);
                    }
                });

                await loadCredentials();
                handleDeselectAll();

                if (errorMessages.length === 0) {
                    showSuccess('Bulk Delete Complete', successMessages);
                } else {
                    // Partial success
                    const allMsgs = successMessages.concat(
                        ['---'],
                        errorMessages.map(m => `ERROR: ${m}`)
                    );
                    setResult({ title: 'Bulk Delete -- Partial Success', messages: allMsgs });
                    setModals(prev => ({ ...prev, result: true }));
                }
            } catch (err) {
                console.error('Error in bulk delete:', err);
                showError('Bulk Delete Failed', [`Error: ${getErrorMessage(err)}`]);
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

        // ─── Selection handlers ────────────────────────────────────────
        
        function handleSelectRow(cred) {
            setSelectedRows(prev => {
                const exists = prev.findIndex(r => r.stanzaKey === cred.stanzaKey);
                if (exists >= 0) {
                    return prev.filter((_, i) => i !== exists);
                }
                return [...prev, cred];
            });
        }

        function handleSelectAll(filtered) {
            setSelectedRows(filtered || credentials);
        }

        function handleDeselectAll() {
            setSelectedRows([]);
        }

        const isAllSelected = credentials.length > 0 && selectedRows.length === credentials.length;

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
                React.createElement('h1', { style: { margin: 0 } }, 'Credential Manager'),
                React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
                    selectedRows.length > 0 && React.createElement('span', { style: { color: '#666', fontSize: '14px' } }, `${selectedRows.length} selected`),
                    selectedRows.length > 0 && React.createElement(Button, {
                        onClick: () => setModals(prev => ({ ...prev, bulkDelete: true })),
                        appearance: 'destructive',
                        children: `Delete Selected (${selectedRows.length})`
                    }),
                    React.createElement(Button, { onClick: handleDownloadTemplate, children: 'Download Template' }),
                    React.createElement(Button, { onClick: () => setModals(prev => ({ ...prev, import: true })), children: 'Import CSV' }),
                    React.createElement(Button, { onClick: () => { setEditingCredential(null); setModals(prev => ({ ...prev, form: true })); }, appearance: 'primary', children: 'Create Credential' })
                )
            ),

            // Credentials table
            React.createElement(CredentialTable, {
                credentials,
                selectedRows,
                isAllSelected,
                onDelete: (credential) => { setSelectedCredential(credential); setModals(prev => ({ ...prev, delete: true })); },
                onReveal: (credential) => { setSelectedCredential(credential); setModals(prev => ({ ...prev, password: true })); },
                onSelectRow: handleSelectRow,
                onSelectAll: handleSelectAll,
                onDeselectAll: handleDeselectAll,
                onEdit: function(credential) { setEditingCredential(credential); setModals(prev => ({ ...prev, form: true })); },
            }),

            // Form modal — dedicated modal wrapper for CredentialForm
            modals.form && React.createElement(FormModal, {
                isOpen: modals.form,
                onClose: () => { setModals(prev => ({ ...prev, form: false })); setEditingCredential(null); },
                title: editingCredential ? 'Edit Credential' : 'Create Credential',
            }, React.createElement(CredentialForm, {
                credential: editingCredential,
                onSave: editingCredential ? function(formData) { handleUpdateCredential(editingCredential, formData); } : handleCreateCredential,
                onCancel: () => { setModals(prev => ({ ...prev, form: false })); setEditingCredential(null); },
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

            // Bulk delete confirmation modal
            modals.bulkDelete && React.createElement(BulkDeleteModal, {
                isOpen: modals.bulkDelete,
                selectedRows: selectedRows,
                onClose: () => setModals(prev => ({ ...prev, bulkDelete: false })),
                onConfirm: handleBulkDeleteConfirm,
            }),

            // Result modal — replaces all alert() calls
            modals.result && React.createElement(ResultModal, {
                title: result.title,
                messages: result.messages,
                onClose: () => setModals(prev => ({ ...prev, result: false })),
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

        return React.createElement(Modal, {
            open: true,
            onRequestClose: function() { onClose(); },
            returnFocus: handleReturnFocus,
            divider: 'both',
            style: { width: '550px', maxWidth: '90%' }
        },
            React.createElement('div', null,
                React.createElement(Modal.Header, null,
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px' } }, title)
                ),
                React.createElement(Modal.Body, { style: { maxHeight: '60vh', overflowY: 'auto' } },
                    messages.map(function(msg, i) {
                        if (msg === '<br/>' || msg.startsWith('<br/>-')) {
                            return React.createElement('hr', { key: i, style: { margin: '0.75rem 0', border: 'none', borderTop: '1px solid #e0e0e0' } });
                        }
                        return React.createElement('p', {
                            key: i,
                            style: { margin: '0.25rem 0', color: msg.startsWith('ERROR') ? '#d32f2f' : '#172b4d' },
                            dangerouslySetInnerHTML: { __html: msg }
                        });
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
                    React.createElement('h3', { style: { margin: 0, fontSize: '16px' } }, `Delete ${selectedRows.length} Credential${selectedRows.length !== 1 ? 's' : ''}`)
                ),
                React.createElement(Modal.Body, { style: { maxHeight: '60vh', overflowY: 'auto' } },
                    React.createElement('p', null, 'Are you sure you want to delete the following credential(s)? This action cannot be undone.'),
                    React.createElement('ul', { style: { margin: '0.5rem 0', paddingLeft: '1.25rem' } },
                        selectedRows.map(function(row, i) {
                            return React.createElement('li', { key: i, style: { marginBottom: '0.25rem' } },
                                React.createElement('strong', null, row.name),
                                row.realm ? React.createElement('span', null, ` (${row.realm})`) : null
                            );
                        })
                    )
                ),
                React.createElement(Modal.Footer, { itemAlign: 'end' },
                    React.createElement(Button, { onClick: onClose, children: 'Cancel' }),
                    React.createElement(Button, { onClick: function() { onClose(); onConfirm(); }, appearance: 'destructive', children: 'Delete' })
                )
            )
        );
    }



    window.CredentialManager = {
        Component: CredentialManager,
        init: function(mvc) {
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
            root.render(React.createElement(SplunkThemeProvider, { family: 'enterprise', colorScheme: 'light' },
                React.createElement(GlobalStyles, null),
                React.createElement(CredentialManager, null)
            ));
            console.log('Credential Manager: Render complete');
        }
    };

    if (typeof window.require === 'function') {
        window.require(['splunkjs/mvc/simplexml/ready!', 'splunkjs/mvc'], function(ready, mvc) {
            window.CredentialManager.init(mvc);
        });
    } else {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => window.CredentialManager.init());
        } else {
            window.CredentialManager.init();
        }
    }
})();
