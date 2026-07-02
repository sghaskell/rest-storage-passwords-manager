/**
 * BulkRoleAssignmentModal.jsx — Bulk role assignment modal.
 *
 * Allows assigning read/write roles to multiple credentials at once.
 * Supports replace mode (overwrite existing) and add mode (merge with existing).
 */

const React = require('react');

var SplunkModalMod = require('@splunk/react-ui/Modal');
var SplunkModal = SplunkModalMod.default;
SplunkModalMod.Header && (SplunkModal.Header = SplunkModalMod.Header);
SplunkModalMod.Body && (SplunkModal.Body = SplunkModalMod.Body);
SplunkModalMod.Footer && (SplunkModal.Footer = SplunkModalMod.Footer);
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

/** Detect dark theme synchronously */
function detectDark() {
    var html = document.documentElement;
    if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (document.body.classList.contains('dark-theme')) return true;
    return false;
}

function BulkRoleAssignmentModal({
    selectedRows,
    availableRoles,
    isOpen,
    onClose,
    onApply,
}) {
    var isDark = detectDark();
    var inputBg = isDark ? '#2d2d2d' : '#fff';
    var inputBorder = isDark ? '#555' : '#ccc';
    var inputColor = isDark ? '#e0e0e0' : '#333';

    var MultiSelectMod = require('@splunk/react-ui/Multiselect');
    var MultiSelector = MultiSelectMod.default;
    var MultiSelectOption = MultiSelectMod.Option;

    const [mode, setMode] = React.useState('replace'); // 'replace' | 'add'
    const [readRoles, setReadRoles] = React.useState([]);
    const [writeRoles, setWriteRoles] = React.useState([]);
    const [applying, setApplying] = React.useState(false);
    const [progress, setProgress] = React.useState({ current: 0, total: 0 });

    // Reset state when modal opens
    React.useEffect(function() {
        if (isOpen) {
            setReadRoles([]);
            setWriteRoles([]);
            setMode('replace');
            setApplying(false);
            setProgress({ current: 0, total: 0 });
        }
    }, [isOpen]);

    // Build role options for selectors
    var roleOptions = React.useMemo(function() {
        return (availableRoles || []).map(function(r) {
            return { label: r, value: r };
        });
    }, [availableRoles]);

    // Check if wildcard is selected in either set
    var hasWildcard = React.useMemo(function() {
        return readRoles.indexOf('* (all)') !== -1 || writeRoles.indexOf('* (all)') !== -1;
    }, [readRoles, writeRoles]);

    function handleRoleChange(e, data, isRead) {
        var newVals = data.values ? data.values.slice() : [];
        var prevVals = isRead ? readRoles : writeRoles;
        var added = newVals.filter(function(v) { return prevVals.indexOf(v) === -1; });

        if (added.includes('* (all)')) {
            newVals = ['* (all)'];
        } else if (added.length > 0 && prevVals.includes('* (all)')) {
            newVals = newVals.filter(function(v) { return v !== '* (all)'; });
        }
        if (isRead) setReadRoles(newVals);
        else setWriteRoles(newVals);
    }

    function selectAllRoles(isRead) {
        var all = roleOptions.map(function(r) { return r.value; });
        if (isRead) setReadRoles(all);
        else setWriteRoles(all);
    }

    function resetRoles(isRead) {
        if (isRead) setReadRoles([]);
        else setWriteRoles([]);
    }

    // Resolve roles — map '* (all)' to '*' for the API
    function resolveRoles(rolesArr) {
        if (!rolesArr.length) return [];
        return rolesArr.includes('* (all)') ? ['*'] : rolesArr.slice();
    }

    async function handleApply() {
        if (!readRoles.length && !writeRoles.length) return;
        setApplying(true);
        setProgress({ current: 0, total: selectedRows.length });
        try {
            var results = await API.bulkAssignRoles(
                selectedRows,
                resolveRoles(readRoles),
                resolveRoles(writeRoles),
                mode,
                function(current, total) {
                    setProgress({ current: current + 1, total: total });
                }
            );
            onApply(results);
        } catch (err) {
            console.error('Bulk role assignment failed:', err);
        } finally {
            setApplying(false);
        }
    }

    if (!isOpen) return null;

    var warnBg = isDark ? '#3d3400' : '#fff3cd';
    var warnBorder = isDark ? '#665c00' : '#ffc107';
    var warnColor = isDark ? '#ffd54f' : '#856404';

    return React.createElement(SplunkModal, {
        open: isOpen,
        onRequestClose: onClose,
        divider: 'both',
        style: { width: '600px', maxWidth: '95%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', {
                    style: { margin: 0, fontSize: '16px', fontWeight: '500', color: inputColor }
                }, 'Bulk Role Assignment (' + selectedRows.length + ' credentials)')
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '70vh', overflowY: 'auto' } },
                // Mode selector
                React.createElement('div', {
                    style: {
                        marginBottom: '1rem',
                        padding: '0.75rem',
                        border: '1px solid ' + inputBorder,
                        borderRadius: '4px',
                        backgroundColor: inputBg,
                    }
                },
                    React.createElement('div', {
                        style: { fontSize: '13px', fontWeight: '500', marginBottom: '0.5rem', color: inputColor }
                    }, 'Mode'),
                    React.createElement('div', { style: { display: 'flex', gap: '1rem' } },
                        React.createElement('label', {
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                cursor: 'pointer',
                                fontSize: '13px',
                                color: inputColor,
                            }
                        },
                            React.createElement('input', {
                                type: 'radio',
                                name: 'roleMode',
                                checked: mode === 'replace',
                                onChange: function() { setMode('replace'); }
                            }),
                            'Replace existing roles'
                        ),
                        React.createElement('label', {
                            style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                cursor: 'pointer',
                                fontSize: '13px',
                                color: inputColor,
                            }
                        },
                            React.createElement('input', {
                                type: 'radio',
                                name: 'roleMode',
                                checked: mode === 'add',
                                onChange: function() { setMode('add'); }
                            }),
                            'Add to existing roles'
                        )
                    )
                ),

                // Read roles
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem'
                        }
                    },
                        React.createElement('label', {
                            style: { fontSize: '14px', fontWeight: '500', color: inputColor }
                        }, 'Read Roles'),
                        React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                            React.createElement(Button, {
                                onClick: function() { selectAllRoles(true); },
                                appearance: 'subtle',
                                children: 'Select All',
                                style: { fontSize: '11px', padding: '2px 8px' }
                            }),
                            React.createElement(Button, {
                                onClick: function() { resetRoles(true); },
                                appearance: 'subtle',
                                children: 'Reset',
                                style: { fontSize: '11px', padding: '2px 8px' }
                            })
                        )
                    ),
                    React.createElement(MultiSelector, {
                        placeholder: 'Select roles...',
                        values: readRoles,
                        onChange: function(e, data) { handleRoleChange(e, data, true); },
                    }, roleOptions.map(function(r) {
                        return React.createElement(MultiSelectOption, {
                            key: 'br-rd-' + r.value,
                            label: r.label,
                            value: r.value
                        });
                    }))
                ),

                // Write roles
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('div', {
                        style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '0.5rem'
                        }
                    },
                        React.createElement('label', {
                            style: { fontSize: '14px', fontWeight: '500', color: inputColor }
                        }, 'Write Roles'),
                        React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
                            React.createElement(Button, {
                                onClick: function() { selectAllRoles(false); },
                                appearance: 'subtle',
                                children: 'Select All',
                                style: { fontSize: '11px', padding: '2px 8px' }
                            }),
                            React.createElement(Button, {
                                onClick: function() { resetRoles(false); },
                                appearance: 'subtle',
                                children: 'Reset',
                                style: { fontSize: '11px', padding: '2px 8px' }
                            })
                        )
                    ),
                    React.createElement(MultiSelector, {
                        placeholder: 'Select roles...',
                        values: writeRoles,
                        onChange: function(e, data) { handleRoleChange(e, data, false); },
                    }, roleOptions.map(function(r) {
                        return React.createElement(MultiSelectOption, {
                            key: 'br-wr-' + r.value,
                            label: r.label,
                            value: r.value
                        });
                    }))
                ),

                // Wildcard warning
                hasWildcard && React.createElement('div', {
                    style: {
                        backgroundColor: warnBg,
                        border: '1px solid ' + warnBorder,
                        borderRadius: '4px',
                        padding: '0.5rem 0.75rem',
                        fontSize: '13px',
                        color: warnColor,
                        marginBottom: '1rem'
                    }
                },
                    '\u26a0\ufe0f ',
                    'Assigning \'* (all)\' grants access to ALL roles. This is equivalent to open access for everyone with read access to this app.'
                ),

                // Progress
                applying && React.createElement('div', {
                    style: {
                        marginBottom: '0.5rem',
                        backgroundColor: isDark ? '#1e1e1e' : '#e0e0e0',
                        borderRadius: '4px',
                        height: '8px',
                        overflow: 'hidden'
                    }
                },
                    React.createElement('div', {
                        style: {
                            width: (progress.total > 0 ? (progress.current / progress.total * 100) : 0) + '%',
                            height: '100%',
                            backgroundColor: '#3b82f6',
                            borderRadius: '4px',
                            transition: 'width 0.15s'
                        }
                    })
                ),
                applying && React.createElement('div', {
                    style: { fontSize: '11px', color: isDark ? '#aaa' : '#666', textAlign: 'center' }
                }, progress.current + ' / ' + progress.total + ' credentials updated')
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, {
                    onClick: onClose,
                    appearance: 'subtle',
                    children: 'Cancel',
                    disabled: applying
                }),
                React.createElement(Button, {
                    onClick: handleApply,
                    appearance: 'primary',
                    children: applying
                        ? 'Applying...'
                        : 'Apply to ' + selectedRows.length + ' Credential(s)',
                    disabled: applying || (!readRoles.length && !writeRoles.length)
                })
            )
        )
    );
}

module.exports = BulkRoleAssignmentModal;
