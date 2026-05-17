/**
 * credentials.jsx - Splunk Custom Page entry point for React Credential Manager
 *
 * This file bootstraps the React application. It expects the React bundle
 * (bundle.js) to be loaded first, which exposes CredentialManager globally.
 */

(function() {
    'use strict';

    /**
     * Render the React application
     */
    function renderApp() {
        const container = document.getElementById('credential-manager-app');
        if (!container) {
            console.error('Credential Manager: Container element not found');
            return;
        }

        // Wait for React to be available
        if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
            console.error('Credential Manager: React or ReactDOM not loaded');
            container.innerHTML = '<div class="alert alert-error">React not loaded. Check browser console.</div>';
            return;
        }

        // Wait for CredentialManager component to be available
        if (typeof CredentialManager === 'undefined') {
            console.error('Credential Manager: CredentialManager component not loaded');
            container.innerHTML = '<div class="alert alert-error">CredentialManager component not loaded.</div>';
            return;
        }

        // Create root and render the React component
        const root = ReactDOM.createRoot(container);
        root.render(React.createElement(CredentialManager));
    }

    /**
     * Initialize when DOM is ready
     */
    function init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', renderApp);
        } else {
            renderApp();
        }
    }

    // Export for Splunk's page loader
    window.CredentialPage = {
        init: init,
        render: renderApp
    };
})();
