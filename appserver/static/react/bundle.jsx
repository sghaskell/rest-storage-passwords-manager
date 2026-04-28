/**
 * bundle.jsx - React Credential Manager entry point
 *
 * This is the main entry point for the React application.
 * It will be bundled by Webpack into bundle.js for Splunk.
 *
 * React and ReactDOM are included in the bundle (not externalized).
 */

const React = require('react');
const ReactDOM = require('react-dom/client');

// Import components
const CredentialTable = require('./components/CredentialTable');
const CredentialForm = require('./components/CredentialForm');
const { PasswordRevealModal, ImportCSVModal, ConfirmDeleteModal } = require('./components/Modal');
const API = require('./api');

(function() {
    'use strict';

    console.log('Credential Manager: Script loaded');

    /**
     * Main CredentialManager component
     * Coordinates all credential management functionality
     */
    function CredentialManager() {
        // State management
        const [credentials, setCredentials] = React.useState([]);
        const [loading, setLoading] = React.useState(true);
        const [error, setError] = React.useState(null);

        // Modal states
        const [showPasswordModal, setShowPasswordModal] = React.useState(false);
        const [showImportModal, setShowImportModal] = React.useState(false);
        const [showDeleteModal, setShowDeleteModal] = React.useState(false);
        const [showFormModal, setShowFormModal] = React.useState(false);

        // Selected credential for modals
        const [selectedCredential, setSelectedCredential] = React.useState(null);

        // Form state
        const [editingCredential, setEditingCredential] = React.useState(null);

        // Error helper — strips XML tags from Splunk responses for readable messages
        function getErrorMessage(err) {
            if (err.message && /&lt;msg/i.test(err.message)) {
                return API.parseError ? API.parseError(err.message) : err.message;
            }
            return err.message || 'An unexpected error occurred';
        }

        // Default role constants from API — prevents empty ACL stripping access (GAP-V03/V04)
        const DEFAULT_READ = API.DEFAULT_READ_ROLES ? API.DEFAULT_READ_ROLES.join(', ') : 'admin, power';
        const DEFAULT_WRITE = API.DEFAULT_WRITE_ROLES ? API.DEFAULT_WRITE_ROLES.join(', ') : 'admin, power';

        // Load credentials on mount
        React.useEffect(() => {
            loadCredentials();
        }, []);

        async function loadCredentials() {
            setLoading(true);
            setError(null);
            try {
                const data = await API.getAllCredentials();
                setCredentials(data);
            } catch (err) {
                console.error('Error loading credentials:', err);
                setError(getErrorMessage(err));
            } finally {
                setLoading(false);
            }
        }

        async function handleCreateCredential(data) {
            try {
                await API.createCredential(data.username, data.password, data.realm, data.app, data.owner, data.readRoles, data.writeRoles);
                await loadCredentials();
                setShowFormModal(false);
                setEditingCredential(null);
                alert('Credential "' + data.username + '" created successfully!');
            } catch (err) {
                console.error('Error creating credential:', err);
                const result = API.parseCreateError ? API.parseCreateError(err) : null;
                if (result && result.isDuplicate) {
                    alert(result.message); // Already contains human-friendly duplicate message
                } else {
                    alert('Failed to create credential: ' + getErrorMessage(err));
                }
            }
        }

        async function handleUpdateCredential(data) {
            if (!editingCredential) return;
            try {
                await API.updateCredential(editingCredential.name, editingCredential.realm, data.password, data.readRoles, data.writeRoles, data.owner, data.app);
                await loadCredentials();
                setShowFormModal(false);
                setEditingCredential(null);
                alert('Credential "' + editingCredential.name + '" updated successfully!');
            } catch (err) {
                console.error('Error updating credential:', err);
                alert('Failed to update credential: ' + getErrorMessage(err));
            }
        }

        async function handleDeleteCredential() {
            if (!selectedCredential) return;
            try {
                await API.deleteCredential(selectedCredential.name, selectedCredential.realm);
                await loadCredentials();
                setShowDeleteModal(false);
                setSelectedCredential(null);
               alert('Credential "' + selectedCredential.name + '" deleted successfully!');
            } catch (err) {
                console.error('Error deleting credential:', err);
                alert('Failed to delete credential: ' + getErrorMessage(err));
            }
        }

        function handleEditCredential(credential) {
            setEditingCredential(credential);
            setShowFormModal(true);
        }

        function handleRevealPassword(credential) {
            setSelectedCredential(credential);
            setShowPasswordModal(true);
        }

        function handleDeleteConfirmation(credential) {
            setSelectedCredential(credential);
            setShowDeleteModal(true);
        }

        function handleCreateClick() {
            setEditingCredential(null);
            setShowFormModal(true);
        }

        if (loading) {
            return React.createElement('div', { className: 'credential-manager-app', style: { padding: '2rem' } }, React.createElement('p', null, 'Loading credentials...'));
        }

        if (error) {
            return React.createElement('div', { className: 'credential-manager-app', style: { padding: '2rem', border: '1px solid #ff4444', borderRadius: '8px', backgroundColor: '#fff5f5' } },
                React.createElement('div', { style: { color: '#d32f2f', marginBottom: '1rem', fontWeight: 'bold' } }, 'Error: ' + error),
                React.createElement('p', { style: { fontSize: '14px', color: '#666', marginBottom: '1rem' } }, 'Check browser console for details. Ensure you have the required Splunk capabilities (admin_all_objects, list_storage_passwords).'),
                React.createElement('button', { onClick: loadCredentials, style: { padding: '0.5rem 1rem', cursor: 'pointer' } }, 'Retry')
            );
        }

        return React.createElement('div', { className: 'credential-manager-app', style: { padding: '1rem' } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
                React.createElement('h1', { style: { margin: 0 } }, 'Credential Manager'),
                React.createElement('button', { onClick: handleCreateClick, style: { padding: '0.5rem 1rem', cursor: 'pointer' } }, 'Create Credential')
            ),
            React.createElement(CredentialTable, { credentials, onEdit: handleEditCredential, onDelete: handleDeleteConfirmation, onReveal: handleRevealPassword }),
            showFormModal && React.createElement(ConfirmDeleteModal, { credential: null, isOpen: showFormModal, onClose: () => { setShowFormModal(false); setEditingCredential(null); }, onDelete: () => {} }, React.createElement(CredentialForm, { credential: editingCredential, onSave: editingCredential ? handleUpdateCredential : handleCreateCredential, onCancel: () => { setShowFormModal(false); setEditingCredential(null); } })),
            showPasswordModal && React.createElement(PasswordRevealModal, { credential: selectedCredential, onClose: () => { setShowPasswordModal(false); setSelectedCredential(null); } }),
            showDeleteModal && React.createElement(ConfirmDeleteModal, { credential: selectedCredential, isOpen: showDeleteModal, onClose: () => { setShowDeleteModal(false); setSelectedCredential(null); }, onDelete: handleDeleteCredential }),
            showImportModal && React.createElement(ImportCSVModal, { isOpen: showImportModal, onClose: () => setShowImportModal(false), onImport: async (csvContent) => { alert('CSV import not yet implemented'); } })
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
            root.render(React.createElement(CredentialManager));
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
