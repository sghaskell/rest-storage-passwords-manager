/**
 * ExpiryAlertConfig.jsx — Email alert configuration modal
 *
 * Manage Splunk saved search for credential expiry alerts. Save locally or
 * push to Splunk. Delete existing alerts.
 */

const React = require('react');
const ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
const SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
const ModalMod = require('@splunk/react-ui/Modal');
var Modal = ModalMod.default;
ModalMod.Header && (Modal.Header = ModalMod.Header);
ModalMod.Body && (Modal.Body = ModalMod.Body);
ModalMod.Footer && (Modal.Footer = ModalMod.Footer);
const API = require('../api');

// ─── localStorage key for local draft ────────────────────────────────────────
const ALERT_CONFIG_KEY = 'expiry-alert-config';

function loadLocalConfig() {
    try {
        var stored = localStorage.getItem(ALERT_CONFIG_KEY);
        if (stored) return JSON.parse(stored);
    } catch (e) {}
    return getDefaultConfig();
}

function saveLocalConfig(cfg) {
    try { localStorage.setItem(ALERT_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
}

function getDefaultConfig() {
    return {
        enabled: false,
        recipients: '',
        cronHour: 9,
        cronMinute: 0,
        thresholdDays: API.getDueSoonThreshold(),
        includeDueSoon: true,
        lastSent: null,
    };
}

// ─── Component ────────────────────────────────────────────────────────────────

function ExpiryAlertConfig({ isOpen, onClose }) {
    const [config, setConfig] = React.useState(loadLocalConfig);
    const [status, setStatus] = React.useState('');
    const [statusType, setStatusType] = React.useState(''); // 'success' | 'error' | 'info'
    const [loading, setLoading] = React.useState(false);

    // Load existing Splunk alert on open
    React.useEffect(function() {
        if (!isOpen) return;
        // Reset status each time modal opens
        setStatus('');
        setStatusType('');
    }, [isOpen]);

    // Detect dark theme
    var isDark = document.documentElement.classList.contains('dark-theme') ||
        document.documentElement.classList.contains('theme-dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        (document.body && document.body.classList.contains('dark-theme'));

    // Theme CSS variables
    var themeCSS = React.createElement('style', null,
        '.expiry-alert-config {',
        '  --eac-bg: ' + (isDark ? '#15191e' : '#fff') + ';',
        '  --eac-text: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --eac-text-muted: ' + (isDark ? '#aaa' : '#666') + ';',
        '  --eac-border: ' + (isDark ? '#444' : '#ccc') + ';',
        '  --eac-input-bg: ' + (isDark ? '#222' : '#fff') + ';',
        '  --eac-input-border: ' + (isDark ? '#555' : '#ccc') + ';',
        '  --eac-input-color: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --eac-label: ' + (isDark ? '#bbb' : '#555') + ';',
        '}',
    );

    // ─── Handlers ─────────────────────────────────────────────────────────────
    function handleFieldChange(field, value) {
        setConfig(prev => ({ ...prev, [field]: value }));
        // Also sync thresholdDays to shared localStorage
        if (field === 'thresholdDays') {
            API.setDueSoonThreshold(value);
        }
    }

    async function handleSaveLocally() {
        saveLocalConfig(config);
        setStatus('Saved locally. Changes will be applied to Splunk when you choose "Save & Apply to Splunk".');
        setStatusType('info');
    }

    async function handleSaveAndApply() {
        setLoading(true);
        setStatus('');
        try {
            saveLocalConfig(config);
            await API.createOrUpdateExpiryAlert(config);
            setStatus('Alert saved and applied to Splunk.');
            setStatusType('success');
        } catch (err) {
            setStatus('Failed to apply to Splunk: ' + (err.message || err));
            setStatusType('error');
        } finally {
            setLoading(false);
        }
    }

    async function handleDeleteAlert() {
        if (!confirm('Delete the Splunk saved search for credential expiry alerts? Local settings are preserved.')) return;
        setLoading(true);
        setStatus('');
        try {
            await API.deleteExpiryAlert();
            setStatus('Alert deleted from Splunk.');
            setStatusType('success');
        } catch (err) {
            // 404 means it wasn't there — treat as success
            if (err.status === 404) {
                setStatus('No existing Splunk alert found.');
                setStatusType('info');
            } else {
                setStatus('Failed to delete alert: ' + (err.message || err));
                setStatusType('error');
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleLoadFromSplunk() {
        setLoading(true);
        setStatus('');
        try {
            var alert = await API.getExpiryAlert();
            if (alert) {
                // Parse cron schedule
                var cronParts = (alert.cron_schedule || '0 9 * * *').split(' ');
                var parsedConfig = {
                    enabled: alert.disabled !== '1' && alert.disabled !== 'true',
                    recipients: alert.alert_email_to || '',
                    cronHour: parseInt(cronParts[1], 10) || 9,
                    cronMinute: parseInt(cronParts[0], 10) || 0,
                    thresholdDays: config.thresholdDays, // Not stored in alert — keep local value
                    includeDueSoon: true,
                    lastSent: alert.last_run_time || null,
                };
                setConfig(parsedConfig);
                saveLocalConfig(parsedConfig);
                setStatus('Loaded from Splunk. Last run: ' + (parsedConfig.lastSent || 'never'));
                setStatusType('success');
            } else {
                setStatus('No existing alert found in Splunk.');
                setStatusType('info');
            }
        } catch (err) {
            setStatus('Failed to load from Splunk: ' + (err.message || err));
            setStatusType('error');
        } finally {
            setLoading(false);
        }
    }

    // ─── Form fields ──────────────────────────────────────────────────────────
    function formField(label, child, extraStyle) {
        return React.createElement('div', {
            style: Object.assign({
                marginBottom: '0.75rem',
            }, extraStyle || {}),
        },
            React.createElement('label', {
                style: {
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: 'var(--eac-label)',
                    marginBottom: '4px',
                }
            }, label),
            child
        );
    }

    var inputStyle = {
        padding: '0.35rem 0.5rem',
        border: '1px solid var(--eac-input-border)',
        borderRadius: '4px',
        fontSize: '13px',
        backgroundColor: 'var(--eac-input-bg)',
        color: 'var(--eac-input-color)',
        width: '100%',
        boxSizing: 'border-box',
    };

    var bodyContent = React.createElement('div', { className: 'expiry-alert-config' },
        // Enable toggle
        formField('Enable alerts',
            React.createElement(Switch, {
                selected: config.enabled,
                onClick: function() { handleFieldChange('enabled', !config.enabled); },
            })
        ),

        // Recipients
        formField('Recipients (comma-separated email addresses)',
            React.createElement('input', {
                type: 'email',
                value: config.recipients,
                onChange: function(e) { handleFieldChange('recipients', e.target.value); },
                placeholder: 'admin@example.com, team@example.com',
                style: inputStyle,
            })
        ),

        // Schedule
        React.createElement('div', {
            style: { display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }
        },
            React.createElement('div', { style: { flex: 1 } },
                formField('Hour (24h)',
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 23,
                        value: config.cronHour,
                        onChange: function(e) { handleFieldChange('cronHour', parseInt(e.target.value, 10) || 0); },
                        style: Object.assign({}, inputStyle, { width: '80px' }),
                    })
                )
            ),
            React.createElement('div', { style: { flex: 1 } },
                formField('Minute',
                    React.createElement('input', {
                        type: 'number',
                        min: 0,
                        max: 59,
                        value: config.cronMinute,
                        onChange: function(e) { handleFieldChange('cronMinute', parseInt(e.target.value, 10) || 0); },
                        style: Object.assign({}, inputStyle, { width: '80px' }),
                    })
                )
            )
        ),

        // Threshold (shared with dashboard)
        formField('Alert when credentials expire within (days)',
            React.createElement('input', {
                type: 'number',
                min: 1,
                max: 30,
                value: config.thresholdDays,
                onChange: function(e) { handleFieldChange('thresholdDays', parseInt(e.target.value, 10) || 7); },
                style: Object.assign({}, inputStyle, { width: '80px' }),
            }),
            { extraStyle: { marginBottom: '0.5rem' } }
        ),

        // Include due-soon
        formField('Include "due soon" credentials in alerts',
            React.createElement(Switch, {
                selected: config.includeDueSoon,
                onClick: function() { handleFieldChange('includeDueSoon', !config.includeDueSoon); },
            })
        ),

        // Status message
        status && React.createElement('div', {
            style: {
                padding: '0.5rem 0.75rem',
                borderRadius: '4px',
                fontSize: '12px',
                backgroundColor: statusType === 'success' ? '#e8f5e9' : (statusType === 'error' ? '#ffebee' : '#e3f2fd'),
                color: statusType === 'success' ? '#2e7d32' : (statusType === 'error' ? '#d32f2f' : '#1565c0'),
                marginBottom: '0.75rem',
            }
        }, status),

        // Action buttons
        React.createElement('div', {
            style: {
                display: 'flex',
                gap: '0.5rem',
                flexWrap: 'wrap',
                marginTop: '1rem',
            }
        },
            React.createElement(Button, {
                onClick: handleSaveLocally,
                appearance: 'subtle',
                children: 'Save Locally',
            }),
            React.createElement(Button, {
                onClick: handleSaveAndApply,
                appearance: 'primary',
                disabled: loading,
                children: 'Save & Apply to Splunk',
            }),
            React.createElement(Button, {
                onClick: handleLoadFromSplunk,
                appearance: 'subtle',
                disabled: loading,
                children: 'Load from Splunk',
            }),
            React.createElement(Button, {
                onClick: handleDeleteAlert,
                appearance: 'destructive',
                disabled: loading,
                children: 'Delete Alert',
            })
        )
    );

    if (!isOpen) return null;

    return React.createElement(Modal, {
        open: true,
        onRequestClose: function() { onClose(); },
        divider: 'both',
        style: { width: '550px', maxWidth: '90%' },
    },
        React.createElement('div', null,
            React.createElement(Modal.Header, null,
                React.createElement('h3', {
                    style: { margin: 0, fontSize: '16px', fontWeight: '500' }
                }, 'Email Alert Configuration')
            ),
            React.createElement(Modal.Body, { style: { padding: '1rem' } },
                themeCSS,
                bodyContent
            ),
            React.createElement(Modal.Footer, { itemAlign: 'end' },
                React.createElement(Button, {
                    onClick: onClose,
                    appearance: 'subtle',
                    children: 'Close',
                })
            )
        )
    );
}

module.exports = ExpiryAlertConfig;
