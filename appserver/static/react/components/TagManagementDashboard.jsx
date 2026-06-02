/**
 * TagManagementDashboard.jsx — Tag Management Dashboard.
 *
 * Summary cards + searchable table with descriptions, color presets, bulk delete,
 * click-through to credentials, and inline editing.
 * Uses @splunk/react-ui Table and @splunk/react-icons for consistent styling.
 */

const React = require('react');
const API = require('../api');

var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

// Splunk Table components
var TableMod = require('@splunk/react-ui/Table');
var Table = TableMod.default;
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableRow = TableMod.Row;
var TableCell = TableMod.Cell;
var TableHeadCell = TableMod.HeadCell;

// Splunk icons
var Pencil = require('@splunk/react-icons/Pencil').default;
var TrashCanCross = require('@splunk/react-icons/TrashCanCross').default;
var Eye = require('@splunk/react-icons/Eye').default;
var PlusSquare = require('@splunk/react-icons/PlusSquare').default;
var Checkmark = require('@splunk/react-icons/Checkmark').default;
var Cross = require('@splunk/react-icons/Cross').default;

// ─── Color Palette Presets ─────────────────────────────────────────────────

var COLOR_PRESETS = [
    { name: 'Blue',   hex: '#3b82f6' },
    { name: 'Green',  hex: '#10b981' },
    { name: 'Amber',  hex: '#f59e0b' },
    { name: 'Red',    hex: '#ef4444' },
    { name: 'Purple', hex: '#8b5cf6' },
    { name: 'Pink',   hex: '#ec4899' },
    { name: 'Cyan',   hex: '#06b6d4' },
    { name: 'Orange', hex: '#f97316' },
    { name: 'Teal',   hex: '#14b8a6' },
    { name: 'Indigo', hex: '#6366f1' }
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectDark() {
    var html = document.documentElement;
    if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (document.body.classList.contains('dark-theme')) return true;
    return false;
}

// ─── Color Swatch ───────────────────────────────────────────────────────────

function ColorSwatch({ color, onChange, size, idPrefix }) {
    var swatchSize = size || 20;
    var hidId = '__color-input-' + (idPrefix || color);
    return React.createElement('div', {
        style: { display: 'inline-block', position: 'relative' }
    },
        React.createElement('span', {
            onClick: function() {
                var hidden = document.getElementById(hidId);
                if (hidden) hidden.click();
            },
            style: {
                width: swatchSize + 'px',
                height: swatchSize + 'px',
                borderRadius: '50%',
                backgroundColor: color,
                display: 'inline-block',
                cursor: 'pointer',
                border: '2px solid rgba(255,255,255,0.15)',
                boxSizing: 'border-box',
                transition: 'transform 0.1s',
                flexShrink: 0
            },
            title: 'Click to change color'
        }),
        React.createElement('input', {
            id: hidId,
            type: 'color',
            value: color,
            onChange: function(e) { onChange(e.target.value); },
            style: {
                position: 'absolute',
                opacity: 0,
                width: '1px',
                height: '1px',
                overflow: 'hidden'
            }
        })
    );
}

// ─── Color Preset Picker ────────────────────────────────────────────────────

function ColorPresetPicker({ selectedColor, onChange, idPrefix }) {
    var prefix = idPrefix || 'cp';
    return React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }
    },
        COLOR_PRESETS.map(function(p) {
            var isActive = p.hex === selectedColor;
            return React.createElement('span', {
                key: p.hex,
                onClick: function() { onChange(p.hex); },
                title: p.name,
                style: {
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    backgroundColor: p.hex,
                    display: 'inline-block',
                    cursor: 'pointer',
                    border: isActive ? '3px solid #fff' : '2px solid transparent',
                    boxSizing: 'border-box',
                    boxShadow: isActive ? '0 0 0 1px ' + p.hex : 'none',
                    transition: 'transform 0.1s',
                    flexShrink: 0
                }
            });
        }),
        // Custom color picker
        React.createElement('span', {
            title: 'Custom color',
            style: {
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                display: 'inline-block',
                cursor: 'pointer',
                border: '2px solid #666',
                boxSizing: 'border-box',
                position: 'relative',
                flexShrink: 0
            },
            onClick: function() {
                var el = document.getElementById(prefix + '-custom');
                if (el) el.click();
            }
        }),
        React.createElement('input', {
            id: prefix + '-custom',
            type: 'color',
            value: selectedColor,
            onChange: function(e) { onChange(e.target.value); },
            style: { position: 'absolute', opacity: 0, width: '1px', height: '1px', overflow: 'hidden' }
        })
    );
}

// ─── Tag Row ────────────────────────────────────────────────────────────────

function TagRow({ tag, usage, isDark, onRename, onDelete, onUpdateColor, onUpdateDescription, onViewCredentials, isSelected, onToggleSelect }) {
    var inputBg = isDark ? '#2d2d2d' : '#fff';
    var inputBorder = isDark ? '#555' : '#ccc';
    var inputColor = isDark ? '#e0e0e0' : '#333';
    var subText = isDark ? '#999' : '#666';

    const [editingName, setEditingName] = React.useState(false);
    const [editValue, setEditValue] = React.useState(tag.tag_name);
    const [editingDesc, setEditingDesc] = React.useState(false);
    const [descValue, setDescValue] = React.useState(tag.description || '');
    const [deleting, setDeleting] = React.useState(false);

    var tagColor = tag.color || API.hashToColor(tag.tag_name);

    function startRename() {
        setEditValue(tag.tag_name);
        setEditingName(true);
    }

    async function handleRename() {
        var newName = editValue.trim();
        if (!newName || newName === tag.tag_name) { setEditingName(false); return; }
        try { await onRename(tag.tag_name, newName); setEditingName(false); }
        catch (err) { alert('Failed to rename tag: ' + err.message); }
    }

    function startEditDesc() {
        setDescValue(tag.description || '');
        setEditingDesc(true);
    }

    async function handleSaveDesc() {
        var desc = descValue.trim();
        try { await onUpdateDescription(tag.tag_name, desc); } catch(e) { alert('Failed to update description: ' + e.message); }
        setEditingDesc(false);
    }

    async function handleDelete() {
        if (!confirm('Delete tag "' + tag.tag_name + '"? This removes it from all ' + usage + ' credential(s).')) return;
        setDeleting(true);
        try { await onDelete(tag.tag_name); } catch (err) { alert('Failed to delete tag: ' + err.message); }
        finally { setDeleting(false); }
    }

    // ── Inline edit helper ──
    function inlineEditInput(value, onChange, onSave, onCancel, width, placeholder) {
        return React.createElement('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } },
            React.createElement('input', {
                type: 'text',
                value: value,
                onChange: function(e) { onChange(e.target.value); },
                onKeyDown: function(e) {
                    if (e.key === 'Enter') onSave();
                    if (e.key === 'Escape') onCancel();
                },
                style: {
                    padding: '2px 6px',
                    border: '1px solid ' + inputBorder,
                    borderRadius: '4px',
                    fontSize: '12px',
                    backgroundColor: inputBg,
                    color: inputColor,
                    width: width
                },
                autoFocus: true,
                placeholder: placeholder
            }),
            React.createElement(Button, {
                onClick: onSave,
                appearance: 'subtle',
                title: 'Save',
                icon: React.createElement(Checkmark, { variant: 'filled' })
            }),
            React.createElement(Button, {
                onClick: onCancel,
                appearance: 'subtle',
                title: 'Cancel',
                icon: React.createElement(Cross, { variant: 'filled' })
            })
        );
    }

    // ── Action buttons (icon-only, matching CredentialTable) ──
    function actionButtons() {
        var btns = [];

        // View credentials
        if (onViewCredentials) {
            btns.push(
                React.createElement(Button, {
                    key: 'view',
                    onClick: function() { onViewCredentials(tag.tag_name); },
                    appearance: 'subtle',
                    title: 'View credentials with this tag',
                    icon: React.createElement(Eye, { variant: 'filled' })
                })
            );
        }

        // Rename
        if (!editingName) {
            btns.push(
                React.createElement(Button, {
                    key: 'rename',
                    onClick: startRename,
                    appearance: 'subtle',
                    title: 'Rename tag',
                    icon: React.createElement(Pencil, { variant: 'filled' })
                })
            );
        }

        // Delete
        btns.push(
            React.createElement(Button, {
                key: 'delete',
                onClick: handleDelete,
                appearance: 'subtle',
                title: deleting ? 'Deleting...' : 'Delete tag',
                disabled: deleting,
                icon: React.createElement(TrashCanCross, { variant: 'filled' })
            })
        );

        return React.createElement('div', {
            style: { display: 'flex', gap: '0.25rem' }
        }, btns);
    }

    return React.createElement(TableRow, {
        style: {
            backgroundColor: isSelected ? (isDark ? '#1a2332' : '#eef2ff') : 'transparent'
        }
    },
        // Checkbox
        React.createElement(TableCell, { style: { textAlign: 'center', width: '36px' } },
            React.createElement('input', {
                type: 'checkbox',
                checked: !!isSelected,
                onChange: function() { onToggleSelect(tag.tag_name); },
                style: { cursor: 'pointer', width: '14px', height: '14px' }
            })
        ),

        // Name
        React.createElement(TableCell, null,
            editingName
                ? inlineEditInput(
                    editValue, setEditValue,
                    handleRename, function() { setEditingName(false); },
                    '140px', 'Tag name...'
                )
                : React.createElement('span', {
                    style: { fontSize: '13px', fontWeight: '600', fontFamily: 'monospace', color: inputColor }
                }, tag.tag_name)
        ),

        // Description
        React.createElement(TableCell, null,
            editingDesc
                ? inlineEditInput(
                    descValue, setDescValue,
                    handleSaveDesc, function() { setEditingDesc(false); },
                    '160px', 'Description...'
                )
                : React.createElement('span', {
                    onClick: startEditDesc,
                    style: {
                        fontSize: '12px',
                        color: subText,
                        cursor: 'pointer',
                        fontStyle: (tag.description || '').trim() ? 'normal' : 'italic',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                        maxWidth: '200px'
                    }
                }, (tag.description || '').trim() || 'Click to add...')
        ),

        // Color
        React.createElement(TableCell, { style: { textAlign: 'center', width: '60px' } },
            React.createElement(ColorSwatch, {
                color: tagColor,
                onChange: function(newColor) { onUpdateColor(tag.tag_name, newColor); },
                size: 24,
                idPrefix: 'row-' + tag.tag_name
            })
        ),

        // Usage — plain text (no hyperlink)
        React.createElement(TableCell, { style: { textAlign: 'center', width: '100px' } },
            React.createElement('span', {
                style: { fontSize: '13px', color: inputColor }
            }, usage)
        ),

        // Actions (icon buttons)
        React.createElement(TableCell, null,
            actionButtons()
        )
    );
}

// ─── Main Dashboard ─────────────────────────────────────────────────────────

function TagManagementDashboard({
    tags,
    tagUsages,
    onNavigateToTable,
    onCreateTag,
    onRenameTag,
    onDeleteTag,
    onUpdateTagColor,
    onUpdateTagDescription,
    onViewCredentials
}) {
    var isDark = detectDark();
    var cardBg = isDark ? '#1e293b' : '#fff';
    var cardBorder = isDark ? '#333' : '#e0e0e0';
    var inputBg = isDark ? '#2d2d2d' : '#fff';
    var inputBorder = isDark ? '#555' : '#ccc';
    var inputColor = isDark ? '#e0e0e0' : '#333';
    var subText = isDark ? '#999' : '#666';

    // Create tag state
    const [newTagName, setNewTagName] = React.useState('');
    const [newTagColor, setNewTagColor] = React.useState('#3b82f6');
    const [newTagDesc, setNewTagDesc] = React.useState('');
    const [creating, setCreating] = React.useState(false);
    const [createError, setCreateError] = React.useState('');
    const [showCreate, setShowCreate] = React.useState(false);

    // Search state
    const [searchText, setSearchText] = React.useState('');

    // Bulk selection state
    const [selectedTags, setSelectedTags] = React.useState([]);
    const [bulkDeleting, setBulkDeleting] = React.useState(false);

    async function handleCreateTag() {
        var name = newTagName.trim();
        if (!name) { setCreateError('Tag name is required'); return; }
        if (!/^[a-z0-9_-]{1,50}$/.test(name.toLowerCase())) {
            setCreateError('Lowercase alphanumeric with hyphens/underscores (max 50)');
            return;
        }
        setCreating(true);
        setCreateError('');
        try {
            await onCreateTag(name, newTagColor, newTagDesc);
            setNewTagName('');
            setNewTagColor(API.hashToColor(name));
            setNewTagDesc('');
            setCreateError('');
        } catch (err) {
            setCreateError(err.message || 'Failed to create tag');
        } finally {
            setCreating(false);
        }
    }

    function handleCreateKeyDown(e) {
        if (e.key === 'Enter') { e.preventDefault(); handleCreateTag(); }
        if (e.key === 'Escape') { setShowCreate(false); setNewTagName(''); setCreateError(''); setNewTagDesc(''); }
    }

    function toggleSelect(tagName) {
        setSelectedTags(function(prev) {
            if (prev.indexOf(tagName) !== -1) return prev.filter(function(t) { return t !== tagName; });
            return prev.concat([tagName]);
        });
    }

    async function handleBulkDelete() {
        var usedTags = selectedTags.filter(function(t) { return (tagUsages[t] || 0) > 0; });
        if (usedTags.length > 0) {
            if (!confirm('Some selected tags (' + usedTags.join(', ') + ') are assigned to credentials. Proceed?')) return;
        }
        setBulkDeleting(true);
        var errors = [];
        for (var i = 0; i < selectedTags.length; i++) {
            try { await onDeleteTag(selectedTags[i]); }
            catch (err) { errors.push(selectedTags[i] + ': ' + err.message); }
        }
        setSelectedTags([]);
        setBulkDeleting(false);
        if (errors.length > 0) alert('Errors: ' + errors.join('\n'));
    }

    // Stats
    var totalTags = tags.length;
    var totalTagAssignments = tags.reduce(function(acc, tag) {
        return acc + (tagUsages[tag.tag_name] || 0);
    }, 0);
    var unusedTags = tags.filter(function(tag) {
        return (tagUsages[tag.tag_name] || 0) === 0;
    }).length;

    // Filter + sort
    var filteredTags = tags.filter(function(tag) {
        if (!searchText) return true;
        var q = searchText.toLowerCase();
        return tag.tag_name.toLowerCase().includes(q) ||
            (tag.description || '').toLowerCase().includes(q);
    });
    filteredTags.sort(function(a, b) { return a.tag_name.localeCompare(b.tag_name); });

    // Summary card helper
    function summaryCard(label, value, color, icon) {
        return React.createElement('div', {
            style: {
                flex: '1 1 0',
                minWidth: '140px',
                backgroundColor: cardBg,
                border: '1px solid ' + cardBorder,
                borderRadius: '8px',
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }
        },
            React.createElement('div', {
                style: {
                    width: '40px', height: '40px',
                    borderRadius: '8px',
                    backgroundColor: color + '18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '18px', flexShrink: 0
                }
            }, icon),
            React.createElement('div', null,
                React.createElement('div', {
                    style: { fontSize: '11px', color: subText, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }
                }, label),
                React.createElement('div', {
                    style: { fontSize: '22px', fontWeight: '700', color: color }
                }, value)
            )
        );
    }

    // ── Column definitions ──
    var TAG_COLUMNS = [
        { key: 'name', label: 'Name' },
        { key: 'description', label: 'Description', width: '220px' },
        { key: 'color', label: 'Color', width: '60px' },
        { key: 'usage', label: 'Usage', width: '100px' },
        { key: 'actions', label: 'Actions' }
    ];

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        // ── Summary Cards ──
        React.createElement('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } },
            summaryCard('Total Tags', totalTags, '#3b82f6', '\u{1f3f3}'),
            summaryCard('Assignments', totalTagAssignments, '#10b981', '\u{1f517}'),
            summaryCard('Unused', unusedTags, '#f59e0b', '\u{1f6ab}')
        ),

        // ── Toolbar Row: Search + New Tag ──
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px' }
        },
            // Search input (left)
            React.createElement('input', {
                type: 'text',
                placeholder: 'Search tags...',
                value: searchText,
                onChange: function(e) { setSearchText(e.target.value); },
                style: {
                    padding: '4px 10px',
                    border: '1px solid ' + inputBorder,
                    borderRadius: '6px',
                    fontSize: '12px',
                    backgroundColor: inputBg,
                    color: inputColor,
                    flex: '1 1 0',
                    minWidth: '160px',
                    maxWidth: '300px'
                }
            }),
            // Spacer
            React.createElement('div', { style: { flex: 1 } }),
            // New Tag button / form (right)
            !showCreate
                ? React.createElement(Button, {
                    onClick: function() { setShowCreate(true); },
                    appearance: 'primary',
                    icon: React.createElement(PlusSquare, { variant: 'filled' }),
                    children: 'New Tag',
                    style: { fontSize: '12px', padding: '2px 10px', height: '28px' }
                })
                : React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
                },
                    React.createElement('input', {
                        type: 'text',
                        placeholder: 'tag-name',
                        value: newTagName,
                        onChange: function(e) { setNewTagName(e.target.value); setCreateError(''); },
                        onKeyDown: handleCreateKeyDown,
                        style: {
                            padding: '4px 8px', border: '1px solid ' + inputBorder,
                            borderRadius: '4px', fontSize: '12px',
                            backgroundColor: inputBg, color: inputColor, width: '120px'
                        },
                        autoFocus: true
                    }),
                    React.createElement('input', {
                        type: 'text',
                        placeholder: 'description (optional)',
                        value: newTagDesc,
                        onChange: function(e) { setNewTagDesc(e.target.value); },
                        onKeyDown: handleCreateKeyDown,
                        style: {
                            padding: '4px 8px', border: '1px solid ' + inputBorder,
                            borderRadius: '4px', fontSize: '12px',
                            backgroundColor: inputBg, color: inputColor, width: '160px'
                        }
                    }),
                    React.createElement(ColorPresetPicker, {
                        selectedColor: newTagColor,
                        onChange: function(c) { setNewTagColor(c); },
                        idPrefix: 'create-new'
                    }),
                    React.createElement(Button, {
                        onClick: handleCreateTag,
                        appearance: 'primary',
                        children: creating ? '...' : 'Create',
                        style: { fontSize: '12px', padding: '2px 10px', height: '28px', width: 'auto', minWidth: 'auto', flexShrink: 0 }
                    }),
                    React.createElement(Button, {
                        onClick: function() { setShowCreate(false); setNewTagName(''); setCreateError(''); setNewTagDesc(''); },
                        appearance: 'subtle',
                        title: 'Cancel',
                        icon: React.createElement(Cross, { variant: 'filled' }),
                        style: { width: 'auto', minWidth: 'auto', flexShrink: 0 }
                    }),
                    createError && React.createElement('span', {
                        style: { color: '#ef4444', fontSize: '11px', whiteSpace: 'nowrap' }
                    }, createError)
                )
        ),

        // ── Bulk Delete Bar ──
        selectedTags.length > 0 && React.createElement('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 12px',
                backgroundColor: isDark ? '#1a2332' : '#fef2f2',
                border: '1px solid ' + (isDark ? '#7f1d1d' : '#fecaca'),
                borderRadius: '6px',
                fontSize: '12px'
            }
        },
            React.createElement('span', { style: { color: inputColor } },
                selectedTags.length + ' tag' + (selectedTags.length !== 1 ? 's' : '') + ' selected'),
            React.createElement('div', { style: { flex: 1 } }),
            React.createElement(Button, {
                onClick: function() { setSelectedTags([]); },
                appearance: 'subtle',
                children: 'Clear',
                style: { fontSize: '11px', height: '24px', width: 'auto', minWidth: 'auto', flexShrink: 0 }
            }),
            React.createElement(Button, {
                onClick: handleBulkDelete,
                appearance: 'primary',
                children: bulkDeleting ? 'Deleting...' : 'Delete Selected',
                style: { fontSize: '11px', height: '24px', backgroundColor: '#ef4444', color: '#fff', width: 'auto', minWidth: 'auto', flexShrink: 0 }
            })
        ),

        // ── Table Card ──
        React.createElement('div', {
            style: {
                backgroundColor: cardBg,
                border: '1px solid ' + cardBorder,
                borderRadius: '8px',
                overflow: 'hidden'
            }
        },
            React.createElement(Table, null,
                React.createElement(TableHead, null,
                    React.createElement(TableRow, null,
                        React.createElement(TableHeadCell, {
                            style: { textAlign: 'center', width: '36px' }
                        },
                            React.createElement('input', {
                                type: 'checkbox',
                                checked: tags.length > 0 && selectedTags.length === filteredTags.length && filteredTags.length > 0,
                                onChange: function() {
                                    if (selectedTags.length === filteredTags.length) {
                                        setSelectedTags([]);
                                    } else {
                                        setSelectedTags(filteredTags.map(function(t) { return t.tag_name; }));
                                    }
                                },
                                style: { cursor: 'pointer', width: '14px', height: '14px' }
                            })
                        ),
                        TAG_COLUMNS.map(function(col) {
                            return React.createElement(TableHeadCell, {
                                key: col.key,
                                style: { width: col.width || 'auto' }
                            }, col.label);
                        })
                    )
                ),
                React.createElement(TableBody, null,
                    filteredTags.length === 0
                        ? React.createElement(TableRow, null,
                            React.createElement(TableCell, {
                                colSpan: 6,
                                style: { textAlign: 'center', padding: '2rem', color: subText, fontStyle: 'italic' }
                            }, searchText ? 'No tags match "' + searchText + '"' : 'No tags defined yet. Click "New Tag" above to get started.')
                        )
                        : filteredTags.map(function(tag) {
                            return React.createElement(TagRow, {
                                key: tag.tag_name,
                                tag: tag,
                                usage: tagUsages[tag.tag_name] || 0,
                                isDark: isDark,
                                onRename: onRenameTag,
                                onDelete: onDeleteTag,
                                onUpdateColor: onUpdateTagColor,
                                onUpdateDescription: onUpdateTagDescription,
                                onViewCredentials: onViewCredentials,
                                isSelected: selectedTags.indexOf(tag.tag_name) !== -1,
                                onToggleSelect: toggleSelect
                            });
                        })
                )
            )
        )
    );
}

module.exports = TagManagementDashboard;
