/**
 * credentials.jsx - Splunk Custom Page entry point for React Credential Manager
 * 
 * This file uses Splunk's custom pages framework to load the React application.
 * It bootstraps the React app and renders it within the Splunk UI.
 */

define([
    'react',
    'react-dom',
    'underscore',
    'splunkweb_utils',
    'CredentialManager'
], function(React, ReactDOM, _, splunkweb_utils, CredentialManager) {
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

        // Create root and render the React component
        const root = ReactDOM.createRoot(container);
        root.render(React.createElement(CredentialManager));
    }

    /**
     * Initialize the page
     */
    function init() {
        // Wait for DOM to be ready
        document.addEventListener('DOMContentLoaded', function() {
            renderApp();
        });
    }

    // Export initialization function for Splunk's page loader
    return {
        init: init,
        render: renderApp,
    };
});
