/**
 * PasswordPolicySettings.jsx - Settings modal for password policy configuration
 */

const React = require('react');

/**
 * Detect dark theme synchronously at render time.
 */
var detectDark = function() {
    var html = document.documentElement;
    if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (document.body.classList.contains('dark-theme')) return true;
    var bg = getComputedStyle(document.body).backgroundColor;
    var match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
        var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
        return (r * 299 + g * 587 + b * 114) / 1000 < 128;
    }
    return false;
};

var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
var SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
var ControlGroup = require('@splunk/react-ui/ControlGroup').default;
var ModalMod = require('@splunk/react-ui/Modal');
var Modal = ModalMod.default;
ModalMod.Header && (Modal.Header = ModalMod.Header);
ModalMod.Body && (Modal.Body = ModalMod.Body);
ModalMod.Footer && (Modal.Footer = ModalMod.Footer);

var _API = require('../api');
var loadPolicy = _API.loadPolicy;
var savePolicy = _API.savePolicy;

function PasswordPolicySettings({ isOpen, onClose, onSave }) {
    var initial = loadPolicy();
    const [p, setP] = React.useState(initial);
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
        if (onSave) onSave(final);
    }



    // ─── Shared styles ──────────────────────────────────────────────
    var isDark = detectDark();
    var sectionBorder = isDark ? '#444' : '#ddd';
    var sectionBg = isDark ? '#2a2a2a' : '#f9f9f9';
    var inputBorder = isDark ? '#555' : '#ccc';
    var inputBg = isDark ? '#1e1e1e' : '#fff';
    var textColor = isDark ? '#e0e0e0' : '#333';
    var headingColor = isDark ? '#e0e0e0' : '#333';
    var successBg = isDark ? '#0a2a12' : '#d4edda';
    var successBorder = isDark ? '#1a4a2a' : '#c3e6cb';
    var successColor = isDark ? '#66c99a' : '#155724';
    var errorBg = isDark ? '#3d0000' : '#f8d7da';
    var errorBorder = isDark ? '#660000' : '#f5c6cb';
    var errorColor = isDark ? '#ef9a9a' : '#721c24';

    var sectionStyle = {
        border: '1px solid ' + sectionBorder,
        borderRadius: '4px',
        padding: '1rem',
        backgroundColor: sectionBg,
    };

    var rangeStyle = { flex: 1 };

    var numInputStyle = {
        width: '50px', padding: '4px', fontSize: '13px',
        border: '1px solid ' + inputBorder,
        backgroundColor: inputBg,
        color: textColor,
    };

    // ─── Render ────────────────────────────────────────────────────
    if (!isOpen) return null;

    return React.createElement(Modal, {
        open: true,
        onRequestClose: onClose,
        divider: 'both',
        style: { width: '700px', maxWidth: '95%' },
    },
        React.createElement('div', null,
            React.createElement(Modal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, 'Password Policy Settings')
            ),
            React.createElement(Modal.Body, { style: { maxHeight: '75vh', overflowY: 'auto' } },
                React.createElement('div', {
                    style: { display: 'flex', flexDirection: 'column', gap: '1rem' }
                },

                    // ── Enabled toggle ─────────────────────────────
                    React.createElement(ControlGroup, {
                        label: 'Enforce password policy',
                        additionalInfo: 'When disabled, all rules below are ignored',
                    }, React.createElement(Switch, {
                        selected: p.enabled,
                        onClick: function() { set('enabled', !p.enabled); },
                    })),

                    // ── Length ─────────────────────────────────────
                    React.createElement('div', { style: Object.assign({}, sectionStyle, { color: textColor }) },
                        React.createElement('h3', { style: { margin: '0 0 0.75rem', fontSize: '14px', color: headingColor } }, 'Length'),
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

                    // ── Character Requirements ─────────────────────
                    React.createElement('div', { style: Object.assign({}, sectionStyle, { color: textColor }) },
                        React.createElement('h3', { style: { margin: '0 0 0.75rem', fontSize: '14px', color: headingColor } }, 'Character Requirements'),
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

                    // ── Banned Passwords ───────────────────────────
                    React.createElement('div', { style: Object.assign({}, sectionStyle, { color: textColor }) },
                        React.createElement('h3', { style: { margin: '0 0 0.5rem', fontSize: '14px', color: headingColor } }, 'Banned Passwords (one per line)'),
                        React.createElement('textarea', {
                            value: bannedTxt,
                            onChange: function(e) { handleBanned(e.target.value); },
                            placeholder: 'password\npassword123\nadministrator',
                            rows: 6,
                            style: {
                                width: '100%', padding: '6px 8px', border: '1px solid ' + inputBorder,
                                borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical',
                                backgroundColor: inputBg, color: textColor,
                            }
                        })
                    ),

                    // ── Messages ───────────────────────────────────
                    msg && React.createElement('div', {
                        style: {
                            padding: '0.5rem 0.75rem', backgroundColor: successBg,
                            border: '1px solid ' + successBorder, borderRadius: '4px',
                            fontSize: '13px', color: successColor,
                        }
                    }, msg),

                    err && React.createElement('div', {
                        style: {
                            padding: '0.5rem 0.75rem', backgroundColor: errorBg,
                            border: '1px solid ' + errorBorder, borderRadius: '4px',
                            fontSize: '13px', color: errorColor,
                        }
                    }, err)
                )
            ),
            React.createElement(Modal.Footer, { itemAlign: 'end' },
                React.createElement(Button, {
                    onClick: onClose, appearance: 'subtle',
                }, 'Cancel'),
                React.createElement(Button, {
                    onClick: saveLocal, appearance: 'primary',
                }, 'Save')
            )
        )
    );
}

module.exports = PasswordPolicySettings;
