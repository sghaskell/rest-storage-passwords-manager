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

(function() {
    'use strict';

    console.log('Credential Manager: Script loaded');

    /**
     * Main CredentialManager component
     * Placeholder for now - will be implemented in Phase 1.2
     */
    function CredentialManager() {
        console.log('Credential Manager: Rendering component');
        return React.createElement(
            'div',
            { className: 'credential-manager-app' },
            React.createElement(
                'h1',
                null,
                'Credential Manager'
            ),
            React.createElement(
                'p',
                null,
                'Loading...'
            )
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
