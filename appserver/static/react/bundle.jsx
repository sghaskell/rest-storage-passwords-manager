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

        // Load credentials on mount
        React.useEffect(() => {
            loadCredentials();
        }, []);

        /**
         * Load all credentials from API
         */
        async function loadCredentials() {
            setLoading(true);
            setError(null);

            try {
                const data = await API.getAllCredentials();
                setCredentials(data);
            } catch (err) {
                console.error('Error loading credentials:', err);
                setError(err.message || 'Failed to load credentials');
            } finally {
                setLoading(false);
            }
        }

        /**
         * Handle credential creation
         */
        async function handleCreateCredential(data) {
            try {
                const newCredential = await API.createCredential(
                    data.username,
                    data.password,
                    data.realm,
                    data.app,
                    data.owner,
                    data.writeRoles
                );

                // Refresh credentials list
                await loadCredentials();

                // Close form modal
                setShowFormModal(false);
                setEditingCredential(null);

                alert('Credential created successfully!');
            } catch (err) {
                console.error('Error creating credential:', err);
                alert('Failed to create credential: ' + (err.message || 'Unknown error'));
            }
        }

        /**
         * Handle credential update
         */
        async function handleUpdateCredential(data) {
            if (!editingCredential) return;

            try {
                const updatedCredential = await API.updateCredential(
                    editingCredential.name,
                    editingCredential.realm,
                    data.password,
                    data.writeRoles,
                    data.owner,
                    data.app
                );

                // Refresh credentials list
                await loadCredentials();

                // Close form modal
                setShowFormModal(false);
                setEditingCredential(null);

                alert('Credential updated successfully!');
            } catch (err) {
                console.error('Error updating credential:', err);
                alert('Failed to update credential: ' + (err.message || 'Unknown error'));
            }
        }

        /**
         * Handle credential deletion
         */
        async function handleDeleteCredential() {
            if (!selectedCredential) return;

            try {
                await API.deleteCredential(selectedCredential.name, selectedCredential.realm);

                // Refresh credentials list
                await loadCredentials();

                // Close delete modal
                setShowDeleteModal(false);
                setSelectedCredential(null);

                alert('Credential deleted successfully!');
            } catch (err) {
                console.error('Error deleting credential:', err);
                alert('Failed to delete credential: ' + (err.message || 'Unknown error'));
            }
        }

        /**
         * Open edit form for a credential
         */
        function handleEditCredential(credential) {
            setEditingCredential(credential);
            setShowFormModal(true);
        }

        /**
         * Open password reveal modal
         */
        function handleRevealPassword(credential) {
            setSelectedCredential(credential);
            setShowPasswordModal(true);
        }

        /**
         * Open delete confirmation modal
         */
        function handleDeleteConfirmation(credential) {
            setSelectedCredential(credential);
            setShowDeleteModal(true);
        }

        /**
         * Open form for new credential
         */
        function handleCreateClick() {
            setEditingCredential(null);
            setShowFormModal(true);
        }

        // Render loading state
        if (loading) {
            return React.createElement(
                'div',
                { className: 'credential-manager-app', style: { padding: '2rem' } },
                React.createElement('p', null, 'Loading credentials...')
            );
        }

        // Render error state
        if (error) {
            return React.createElement(
                'div',
                { className: 'credential-manager-app', style: { padding: '2rem' } },
                React.createElement(
                    'div',
                    { style: { color: '#d32f2f', marginBottom: '1rem' } },
                    'Error: ' + error
                ),
                React.createElement(
                    'button',
                    { onClick: loadCredentials },
                    'Retry'
                )
            );
        }

        return React.createElement(
            'div',
            { className: 'credential-manager-app', style: { padding: '1rem' } },
            // Header
            React.createElement(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' } },
                React.createElement('h1', { style: { margin: 0 } }, 'Credential Manager'),
                React.createElement(
                    'button',
                    {
                        onClick: handleCreateClick,
                        style: { padding: '0.5rem 1rem', cursor: 'pointer' },
                    },
                    'Create Credential'
                )
            ),

            // Credentials table
            React.createElement(CredentialTable, {
                credentials: credentials,
                onEdit: handleEditCredential,
                onDelete: handleDeleteConfirmation,
                onReveal: handleRevealPassword,
            }),

            // Form modal (create/edit) - using ConfirmDeleteModal as wrapper for form
            showFormModal &&
                React.createElement(ConfirmDeleteModal, {
                    credential: null,
                    isOpen: showFormModal,
                    onClose: () => {
                        setShowFormModal(false);
                        setEditingCredential(null);
                    },
                    onDelete: () => {}, // No-op
                }, React.createElement(CredentialForm, {
                    credential: editingCredential,
                    onSave: editingCredential ? handleUpdateCredential : handleCreateCredential,
                    onCancel: () => {
                        setShowFormModal(false);
                        setEditingCredential(null);
                    },
                })),

            // Password reveal modal
            showPasswordModal &&
                React.createElement(PasswordRevealModal, {
                    credential: selectedCredential,
                    onClose: () => {
                        setShowPasswordModal(false);
                        setSelectedCredential(null);
                    },
                }),

            // Delete confirmation modal
            showDeleteModal &&
                React.createElement(ConfirmDeleteModal, {
                    credential: selectedCredential,
                    isOpen: showDeleteModal,
                    onClose: () => {
                        setShowDeleteModal(false);
                        setSelectedCredential(null);
                    },
                    onDelete: handleDeleteCredential,
                }),

            // Import modal
            showImportModal &&
                React.createElement(ImportCSVModal, {
                    isOpen: showImportModal,
                    onClose: () => setShowImportModal(false),
                    onImport: async (csvContent) => {
                        console.log('CSV content:', csvContent);
                        // TODO: Implement CSV parsing and import
                        alert('CSV import not yet implemented');
                    },
                })
        );
    }

    // Export for global access
    window.CredentialManager = CredentialManager;

    /**
     * Create React root and render component
     */
    function initRoot(container) {
        console.log('Credential Manager: Container found, creating root');

        const root = ReactDOM.createRoot(container);
        console.log('Credential Manager: Root created, rendering');
        root.render(React.createElement(CredentialManager));
        console.log('Credential Manager: Render complete');
    }

    /**
     * Initialize the app when Splunk dashboard is ready
     */
    function init() {
        console.log('Credential Manager: Initializing...');

        // Check if container exists
        let container = document.getElementById('credential-manager-app');

        if (!container) {
            console.error('Credential Manager: Container element not found');

            // Try again after a short delay - Splunk may add it dynamically
            console.log('Credential Manager: Waiting for container...');
            setTimeout(() => {
                container = document.getElementById('credential-manager-app');
                if (container) {
                    initRoot(container);
                } else {
                    console.error('Credential Manager: Container still not found after delay');
                }
            }, 100);
            return;
        }

        initRoot(container);
    }

    /**
     * Use Splunk's simplexml/ready! for reliable initialization
     * This fires after all classic dashboard panels have finished rendering
     */
    if (typeof require === 'function' && require.specified('splunkjs/mvc/simplexml/ready!')) {
        console.log('Credential Manager: Using splunkjs/mvc/simplexml/ready!');
        require(['splunkjs/mvc/simplexml/ready!'], function() {
            init();
        });
    } else {
        console.log('Credential Manager: No splunkjs available, using DOMContentLoaded');
        // Fallback to DOMContentLoaded if SplunkJS is not available
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }
})();
