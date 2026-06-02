/**
 * BulkTagModal.jsx — Bulk tag operations modal.
 *
 * Allows adding or removing tags from multiple selected credentials at once.
 * Pattern: Follows BulkRoleAssignmentModal.jsx.
 */

const React = require('react');

var SplunkModalMod = require('@splunk/react-ui/Modal');
var SplunkModal = SplunkModalMod.default;
SplunkModalMod.Header && (SplunkModal.Header = SplunkModalMod.Header);
SplunkModalMod.Body && (SplunkModal.Body = SplunkModalMod.Body);
SplunkModalMod.Footer && (SplunkModal.Footer = SplunkModalMod.Footer);
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

// Detect dark theme
function detectDark() {
    var html = document.documentElement;
    if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (document.body.classList.contains('dark-theme')) return true;
    return false;
}

function BulkTagModal({
    selectedRows,
    availableTags,
    mode, // 'add' | 'remove'
    isOpen,
    onClose,
    onApply,
    onApplyResult
}) {
    var isDark = detectDark();
    var inputBg = isDark ? '#2d2d2d' : '#fff';
    var inputBorder = isDark ? '#555' : '#ccc';
    var inputColor = isDark ? '#e0e0e0' : '#333';
    var subText = isDark ? '#999' : '#666';

    var MultiSelectMod = require('@splunk/react-ui/Multiselect');
    var MultiSelector = MultiSelectMod.default;
    var MultiSelectOption = MultiSelectMod.Option;

    const [selectedTagNames, setSelectedTagNames] = React.useState([]);
    const [newTagName, setNewTagName] = React.useState('');
    const [newTagColor, setNewTagColor] = React.useState('#3b82f6');
    const [applying, setApplying] = React.useState(false);
    const [progress, setProgress] = React.useState({ current: 0, total: 0 });

    // Reset state when modal opens
    React.useEffect(function() {
        if (isOpen) {
            setSelectedTagNames([]);
            setNewTagName('');
            setNewTagColor('#3b82f6');
            setApplying(false);
            setProgress({ current: 0, total: 0 });
        }
    }, [isOpen]);

    // Tag options for selector
    var tagOptions = React.useMemo(function() {
        return (availableTags || []).map(function(t) {
            return { label: t.tag_name, value: t.tag_name };
        });
    }, [availableTags]);

    async function handleApply() {
        if (!selectedTagNames.length && !newTagName.trim()) return;
        setApplying(true);
        setProgress({ current: 0, total: selectedRows.length });

        var tagsToApply = selectedTagNames.slice();
        if (newTagName.trim()) {
            tagsToApply.push(newTagName.trim().toLowerCase());
        }

        try {
            var result;
            if (mode === 'add') {
                result = await onApply(selectedRows, tagsToApply, function(current, total) {
                    setProgress({ current: current, total: total });
                });
            } else {
                result = await onApply(selectedRows, selectedTagNames, function(current, total) {
                    setProgress({ current: current, total: total });
                });
            }
            if (onApplyResult) onApplyResult(result);
        } catch (err) {
            console.error('Bulk tag operation failed:', err);
            alert('Bulk tag operation failed: ' + err.message);
        } finally {
            setApplying(false);
        }
    }

    if (!isOpen) return null;

    var modeLabel = mode === 'add' ? 'Add' : 'Remove';
    var progressBg = isDark ? '#1e1e1e' : '#e0e0e0';

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
                }, modeLabel + ' Tag(' + selectedRows.length + ' credentials)')
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '70vh', overflowY: 'auto' } },
                // Header info
                React.createElement('p', {
                    style: {
                        fontSize: '13px',
                        color: subText,
                        marginBottom: '1rem',
                        lineHeight: '1.5'
                    }
                },
                    mode === 'add'
                        ? 'Add selected tag(s) to ' + selectedRows.length + ' credential(s). Existing tags are preserved.'
                        : 'Remove selected tag(s) from ' + selectedRows.length + ' credential(s).'
                ),

                // Tag selector
                React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', {
                        style: {
                            display: 'block',
                            fontSize: '14px',
                            fontWeight: '500',
                            marginBottom: '0.5rem',
                            color: inputColor
                        }
                    }, 'Select Tags'),
                    React.createElement(MultiSelector, {
                        placeholder: 'Select tags...',
                        values: selectedTagNames,
                        onChange: function(e, data) {
                            setSelectedTagNames(data.values ? data.values.slice() : []);
                        },
                        style: { width: '100%' }
                    }, tagOptions.map(function(t) {
                        return React.createElement(MultiSelectOption, {
                            key: 'bt-' + t.value,
                            label: t.label,
                            value: t.value
                        });
                    }))
                ),

                // Create new tag (add mode only)
                mode === 'add' && React.createElement('div', {
                    style: {
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                        marginBottom: '1rem',
                        padding: '0.75rem',
                        border: '1px dashed ' + inputBorder,
                        borderRadius: '4px',
                        backgroundColor: isDark ? '#1e293b' : '#f8fafc'
                    }
                },
                    React.createElement('span', {
                        style: {
                            fontSize: '12px',
                            color: subText,
                            whiteSpace: 'nowrap'
                        }
                    }, 'Or create new:'),
                    React.createElement('input', {
                        type: 'text',
                        placeholder: 'new-tag',
                        value: newTagName,
                        onChange: function(e) { setNewTagName(e.target.value); },
                        style: {
                            padding: '4px 8px',
                            border: '1px solid ' + inputBorder,
                            borderRadius: '4px',
                            fontSize: '13px',
                            backgroundColor: inputBg,
                            color: inputColor,
                            flex: 1
                        }
                    }),
                    React.createElement('input', {
                        type: 'color',
                        value: newTagColor,
                        onChange: function(e) { setNewTagColor(e.target.value); },
                        title: 'Tag color'
                    })
                ),

                // Progress
                applying && React.createElement('div', {
                    style: {
                        marginBottom: '0.5rem',
                        backgroundColor: progressBg,
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
                    style: { fontSize: '11px', color: subText, textAlign: 'center' }
                }, progress.current + ' / ' + progress.total + ' credentials processed')
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
                        ? modeLabel + 'ing...'
                        : modeLabel + ' to ' + selectedRows.length + ' Credential(s)',
                    disabled: applying || (!selectedTagNames.length && !newTagName.trim())
                })
            )
        )
    );
}

module.exports = BulkTagModal;
