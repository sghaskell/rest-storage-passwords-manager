/**
 * PasswordPolicySettings.jsx - Settings modal for password policy configuration
 */

const React = require('react');

var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
var SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
var ControlGroup = require('@splunk/react-ui/ControlGroup').default;
var ModalMod = require('@splunk/react-ui/Modal');
var Modal = ModalMod.default;

var _API = require('../api');
var loadPolicy = _API.loadPolicy;
var savePolicy = _API.savePolicy;
var updateSplunkValidator = _API.updateSplunkValidator;

function PasswordPolicySettings({ isOpen, onClose, onSave }) {
    var initial = loadPolicy();
    const [p, setP] = React.useState(initial);
    const [saving, setSaving] = React.useState(false);
    const [msg, setMsg] = React.useState('');
    const [err, setErr] = React.useState('');
    const [bannedTxt, setBannedTxt] = React.useState((initial.bannedPasswords || []).join('\n'));

    // Update a single policy field
    function set(key, val) {
        setP(function(prev) { return Object.assign({}, prev, { [key]: val }); });
    }

    // Handle banned text changes — sync to policy state
    function handleBanned(text) {
        setBannedTxt(text);
        setP(function(prev) {
            return Object.assign({}, prev, {
                bannedPasswords: text.split('\n').map(function(s) { return s.trim(); }).filter(Boolean),
            });
        });
    }

    // Save to localStorage only
    function saveLocal() {
        var final = Object.assign({}, p, { bannedPasswords: bannedTxt.split('\n').map(function(s) { return s.trim(); }).filter(Boolean) });
        savePolicy(final);
        setMsg('Password policy saved locally.');
        setErr('');
        if (onSave) onSave(Object.assign({}, final, { appliedToSplunk: false }));
    }

    // Save and sync to Splunk
    async function saveAndSync() {
        setSaving(true);
        setErr('');
        setMsg('');
        var final = Object.assign({}, p, { bannedPasswords: bannedTxt.split('\n').map(function(s) { return s.trim(); }).filter(Boolean) });
        try {
            savePolicy(final);
            await updateSplunkValidator(final);
            setMsg('Password policy saved and synced to Splunk.');
            if (onSave) onSave(Object.assign({}, final, { appliedToSplunk: true }));
        } catch (e) {
            savePolicy(final);
            setMsg('Password policy saved locally.');
            setErr('Failed to sync to Splunk: ' + (e.message || String(e)) + '. Local policy was saved.');
        } finally {
            setSaving(false);
        }
    }

    // ─── Shared styles ──────────────────────────────────────────────
    var sectionStyle = {
        border: '1px solid #ddd',
        borderRadius: '4px',
        padding: '1rem',
        backgroundColor: '#f9f9f9',
    };

    var rangeStyle = { flex: 1 };

    var numInputStyle = { width: '50px', padding: '4px', fontSize: '13px' };

    // ─── Render ────────────────────────────────────────────────────
    return React.createElement(Modal, {
        isOpen: isOpen,
        onClose: onClose,
        title: 'Password Policy Settings',
        size: 'large',
    },
        React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '1rem' }
        },

            // ── Enabled toggle ─────────────────────────────────────
            React.createElement(ControlGroup, {
                label: 'Enforce password policy',
                additionalInfo: 'When disabled, all rules below are ignored',
            }, React.createElement(Switch, {
                selected: p.enabled,
                onClick: function() { set('enabled', !p.enabled); },
            })),

            // ── Length ─────────────────────────────────────────────
            React.createElement('div', { style: sectionStyle },
                React.createElement('h3', { style: { margin: '0 0 0.75rem', fontSize: '14px' } }, 'Length'),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' } },

                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                        React.createElement('label', { style: { fontSize: '13px', minWidth: '80px' } }, 'Minimum:'),
                        React.createElement('input', {
                            type: 'range', min: 1, max: 32, value: p.minLength,
                            onChange: function(e) { set('minLength', parseInt(e.target.value)); },
                            style: rangeStyle,
                        }),
                        React.createElement('span', { style: { fontSize: '13px' } }, p.minLength),
                    ),

                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem' } },
                        React.createElement('label', { style: { fontSize: '13px', minWidth: '80px' } }, 'Maximum:'),
                        React.createElement('input', {
                            type: 'range', min: 8, max: 256, value: p.maxLength,
                            onChange: function(e) { set('maxLength', parseInt(e.target.value)); },
                            style: rangeStyle,
                        }),
                        React.createElement('span', { style: { fontSize: '13px' } }, p.maxLength),
                    )
                )
            ),

            // ── Character Requirements ─────────────────────────────
            React.createElement('div', { style: sectionStyle },
                React.createElement('h3', { style: { margin: '0 0 0.75rem', fontSize: '14px' } }, 'Character Requirements'),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' } },

                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
                        React.createElement(Switch, {
                            selected: p.requireUppercase,
                            onClick: function() { set('requireUppercase', !p.requireUppercase); },
                        }),
                        React.createElement('label', { style: { fontSize: '13px', minWidth: '120px' } }, 'Require uppercase'),
                        React.createElement('span', { style: { fontSize: '13px' } }, 'Min:'),
                        React.createElement('input', {
                            type: 'number', min: 0, max: 32, value: p.minUppercase,
                            onChange: function(e) { set('minUppercase', parseInt(e.target.value) || 0); },
                            style: numInputStyle,
                        }),
                    ),

                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
                        React.createElement(Switch, {
                            selected: p.requireLowercase,
                            onClick: function() { set('requireLowercase', !p.requireLowercase); },
                        }),
                        React.createElement('label', { style: { fontSize: '13px', minWidth: '120px' } }, 'Require lowercase'),
                        React.createElement('span', { style: { fontSize: '13px' } }, 'Min:'),
                        React.createElement('input', {
                            type: 'number', min: 0, max: 32, value: p.minLowercase,
                            onChange: function(e) { set('minLowercase', parseInt(e.target.value) || 0); },
                            style: numInputStyle,
                        }),
                    ),

                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
                        React.createElement(Switch, {
                            selected: p.requireDigits,
                            onClick: function() { set('requireDigits', !p.requireDigits); },
                        }),
                        React.createElement('label', { style: { fontSize: '13px', minWidth: '120px' } }, 'Require digits'),
                        React.createElement('span', { style: { fontSize: '13px' } }, 'Min:'),
                        React.createElement('input', {
                            type: 'number', min: 0, max: 32, value: p.minDigits,
                            onChange: function(e) { set('minDigits', parseInt(e.target.value) || 0); },
                            style: numInputStyle,
                        }),
                    ),

                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' } },
                        React.createElement(Switch, {
                            selected: p.requireSpecial,
                            onClick: function() { set('requireSpecial', !p.requireSpecial); },
                        }),
                        React.createElement('label', { style: { fontSize: '13px', minWidth: '120px' } }, 'Require special'),
                        React.createElement('span', { style: { fontSize: '13px' } }, 'Min:'),
                        React.createElement('input', {
                            type: 'number', min: 0, max: 32, value: p.minSpecial,
                            onChange: function(e) { set('minSpecial', parseInt(e.target.value) || 0); },
                            style: numInputStyle,
                        }),
                    )
                )
            ),

            // ── Banned Passwords ───────────────────────────────────
            React.createElement('div', { style: sectionStyle },
                React.createElement('h3', { style: { margin: '0 0 0.5rem', fontSize: '14px' } }, 'Banned Passwords (one per line)'),
                React.createElement('textarea', {
                    value: bannedTxt,
                    onChange: function(e) { handleBanned(e.target.value); },
                    placeholder: 'password\npassword123\nadministrator',
                    rows: 6,
                    style: {
                        width: '100%', padding: '6px 8px', border: '1px solid #ccc',
                        borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical',
                    }
                })
            ),

            // ── Messages ───────────────────────────────────────────
            msg && React.createElement('div', {
                style: {
                    padding: '0.5rem 0.75rem', backgroundColor: '#d4edda',
                    border: '1px solid #c3e6cb', borderRadius: '4px',
                    fontSize: '13px', color: '#155724',
                }
            }, msg),

            err && React.createElement('div', {
                style: {
                    padding: '0.5rem 0.75rem', backgroundColor: '#f8d7da',
                    border: '1px solid #f5c6cb', borderRadius: '4px',
                    fontSize: '13px', color: '#721c24',
                }
            }, err)
        ),

        // ── Action buttons ────────────────────────────────────────
        React.createElement('div', {
            style: { display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }
        },
            React.createElement(Button, {
                onClick: onClose, appearance: 'subtle',
            }, 'Cancel'),
            React.createElement(Button, {
                onClick: saveLocal, appearance: 'subtle', disabled: saving,
            }, 'Save Locally'),
            React.createElement(Button, {
                onClick: saveAndSync, appearance: 'primary', disabled: saving,
            }, saving ? 'Saving...' : 'Save & Apply to Splunk')
        )
    );
}

module.exports = PasswordPolicySettings;
