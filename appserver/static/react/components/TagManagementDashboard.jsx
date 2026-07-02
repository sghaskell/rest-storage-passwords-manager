/**
 * TagManagementDashboard.jsx — Tag Management Dashboard.
 *
 * Summary stats + searchable table with descriptions, color presets, bulk delete,
 * click-through to credentials, and inline editing.
 * Uses @splunk/react-ui Table and @splunk/react-icons for consistent styling.
 * Layout mirrors CredentialManager toolbar + table pattern.
 * Uses Splunk rowSelection for consistent checkbox styling.
 */

const React = require('react');
const API = require('../api');

var TagColorPicker = require('./TagColorPicker');
var COLOR_PRESETS = TagColorPicker.COLOR_PRESETS;
var ColorPresetPicker = TagColorPicker.ColorPresetPicker;

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


// ─── Column widths — shared by TableHeadCell and TableCell ────────────────

var COL = {
    name:      '160px',
    desc:      '220px',
    color:     '60px',
    usage:     '100px',
    actions:   'auto'
};

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
                border: '2px solid var(--td-swatch-border)',
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
// ─── Tag Row ────────────────────────────────────────────────────────────────
// Note: row checkbox is handled by Splunk Table rowSelection — no manual input

function TagRow({ tag, usage, onRename, onDelete, onUpdateColor, onUpdateDescription, onViewCredentials, isSelected, onToggleSelect }) {
    const [editingName, setEditingName] = React.useState(false);
    const [editValue, setEditValue] = React.useState(tag.tag_name);
    const [editingDesc, setEditingDesc] = React.useState(false);
    const [descValue, setDescValue] = React.useState(tag.description || '');
    const [deleting, setDeleting] = React.useState(false);
    const [rowError, setRowError] = React.useState('');

    var tagColor = tag.color || API.hashToColor(tag.tag_name);

    function startRename() {
        setEditValue(tag.tag_name);
        setRowError('');
        setEditingName(true);
    }

    async function handleRename() {
        var newName = editValue.trim();
        if (!newName || newName === tag.tag_name) { setEditingName(false); setRowError(''); return; }
        try { await onRename(tag.tag_name, newName); setEditingName(false); setRowError(''); }
        catch (err) { setRowError(err.message || 'Failed to rename'); }
    }

    function startEditDesc() {
        setDescValue(tag.description || '');
        setRowError('');
        setEditingDesc(true);
    }

    async function handleSaveDesc() {
        var desc = descValue.trim();
        try { await onUpdateDescription(tag.tag_name, desc); setRowError(''); } catch(e) { setRowError(e.message || 'Failed to update description'); }
        setEditingDesc(false);
    }

    async function handleDelete() {
        if (!window.confirm('Delete tag "' + tag.tag_name + '"? This removes it from all ' + usage + ' credential(s).')) return;
        setDeleting(true);
        setRowError('');
        try { await onDelete(tag.tag_name); }
        catch (err) { setRowError(err.message || 'Failed to delete tag'); }
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
                    border: '1px solid var(--td-input-border)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    backgroundColor: 'var(--td-input-bg)',
                    color: 'var(--td-input-color)',
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

    // ── Action buttons ──
    function actionButtons() {
        var btns = [];

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

    // Use Splunk TableRow with rowSelection props — no manual checkbox cell
    return React.createElement(TableRow, {
        selected: isSelected,
        onRequestToggle: function() { onToggleSelect(tag.tag_name); }
    },
        // Name
        React.createElement(TableCell, { style: { width: COL.name } },
            editingName
                ? inlineEditInput(
                    editValue, setEditValue,
                    handleRename, function() { setEditingName(false); setRowError(''); },
                    '140px', 'Tag name...'
                )
                : React.createElement('span', {
                    style: { fontSize: '13px', fontWeight: '600', fontFamily: 'monospace', color: 'var(--td-text)' }
                }, tag.tag_name)
        ),

        // Description
        React.createElement(TableCell, { style: { width: COL.desc } },
            editingDesc
                ? inlineEditInput(
                    descValue, setDescValue,
                    handleSaveDesc, function() { setEditingDesc(false); setRowError(''); },
                    '160px', 'Description...'
                )
                : React.createElement('span', {
                    onClick: startEditDesc,
                    style: {
                        fontSize: '12px',
                        color: 'var(--td-text-muted)',
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
        React.createElement(TableCell, { style: { width: COL.color, textAlign: 'center' } },
            React.createElement(ColorSwatch, {
                color: tagColor,
                onChange: function(newColor) { onUpdateColor(tag.tag_name, newColor); },
                size: 24,
                idPrefix: 'row-' + tag.tag_name
            })
        ),

        // Usage
        React.createElement(TableCell, { style: { width: COL.usage, textAlign: 'center' } },
            React.createElement('span', {
                style: { fontSize: '13px', color: 'var(--td-text)' }
            }, usage)
        ),

        // Actions
        React.createElement(TableCell, { style: { width: COL.actions } },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                actionButtons(),
                rowError && React.createElement('span', {
                    style: { color: '#ef4444', fontSize: '10px' }
                }, rowError)
            )
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

    // CSS custom properties
    var themeStyles = React.createElement('style', null,
        '.tag-dashboard-container {',
        '  --td-text: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --td-text-muted: ' + (isDark ? '#aaa' : '#666') + ';',
        '  --td-border: ' + (isDark ? '#333' : '#e0e0e0') + ';',
        '  --td-input-bg: ' + (isDark ? '#15191e' : '#fff') + ';',
        '  --td-input-border: ' + (isDark ? '#555' : '#ccc') + ';',
        '  --td-input-color: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --td-swatch-border: ' + (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)') + ';',
        '  --td-bulk-bg: ' + (isDark ? 'rgba(127, 29, 29, 0.3)' : '#fef2f2') + ';',
        '  --td-bulk-border: ' + (isDark ? '#7f1d1d' : '#fecaca') + ';',
        '  --td-header-bg: ' + (isDark ? '#15191e' : '#f5f5f5') + ';',
        '  --td-header-color: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '}',
        // Header row styling — matches CredentialTable pattern
        '.tag-dashboard-container table thead th,',
        '.tag-dashboard-container table thead th [class*="HeadCell"] {',
        '  background-color: var(--td-header-bg) !important;',
        '  color: var(--td-header-color) !important;',
        '}',
        '.tag-dashboard-container table thead th:not([data-test="toggle-all"]) [class*="sc-"] {',
        '  background-color: var(--td-header-bg) !important;',
        '  color: var(--td-header-color) !important;',
        '}'
    );

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
    const [bulkError, setBulkError] = React.useState('');

    // Toast message
    const [toast, setToast] = React.useState(null);
    const toastTimer = React.useRef(null);

    function showToast(message) {
        setToast(message);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(function() { setToast(null); }, 3000);
    }

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
            showToast('Tag "' + name + '" created');
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
            if (!window.confirm('Some selected tags (' + usedTags.join(', ') + ') are assigned to credentials. Proceed?')) return;
        }
        setBulkDeleting(true);
        setBulkError('');
        var errors = [];
        for (var i = 0; i < selectedTags.length; i++) {
            try { await onDeleteTag(selectedTags[i]); }
            catch (err) { errors.push(selectedTags[i] + ': ' + err.message); }
        }
        setSelectedTags([]);
        setBulkDeleting(false);
        if (errors.length > 0) {
            setBulkError(errors.join('; '));
        } else {
            showToast(selectedTags.length + ' tag(s) deleted');
        }
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

    // rowSelection state — 'none' | 'some' | 'all' (drives Splunk checkbox rendering)
    var allSelected = filteredTags.length > 0 && filteredTags.every(function(t) { return selectedTags.indexOf(t.tag_name) !== -1; });
    var someSelected = filteredTags.some(function(t) { return selectedTags.indexOf(t.tag_name) !== -1; });
    var rowSelectionState = allSelected ? 'all' : (someSelected ? 'some' : 'none');

    function handleToggleSelectAll() {
        if (allSelected) {
            setSelectedTags([]);
        } else {
            setSelectedTags(filteredTags.map(function(t) { return t.tag_name; }));
        }
    }

    // Summary stat helper
    function statBlock(label, value, color, icon) {
        return React.createElement('div', {
            style: {
                flex: '1 1 0',
                minWidth: '120px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
            }
        },
            React.createElement('div', {
                style: {
                    width: '36px', height: '36px',
                    borderRadius: '6px',
                    backgroundColor: color + '18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', flexShrink: 0
                }
            }, icon),
            React.createElement('div', null,
                React.createElement('div', {
                    style: { fontSize: '10px', color: 'var(--td-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }
                }, label),
                React.createElement('div', {
                    style: { fontSize: '20px', fontWeight: '700', color: color }
                }, value)
            )
        );
    }

    // Shared input style
    var inputStyle = {
        padding: '4px 10px',
        border: '1px solid var(--td-input-border)',
        borderRadius: '4px',
        fontSize: '12px',
        backgroundColor: 'var(--td-input-bg)',
        color: 'var(--td-input-color)'
    };

    // ── Toolbar — mirrors CredentialManager toolbar pattern (line 1314) ──
    // Left side: bulk selection info + search
    // Right side: New Tag button / create form
    var toolbarLeft = [];
    var toolbarRight = [];

    // Bulk selection indicator (like credential management)
    if (selectedTags.length > 0) {
        toolbarLeft.push(
            React.createElement('span', {
                key: 'sel',
                style: { color: 'var(--td-text-muted)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '0.35rem' }
            },
                selectedTags.length + ' selected',
                React.createElement('span', {
                    onClick: function() { setSelectedTags([]); setBulkError(''); },
                    style: { cursor: 'pointer', color: 'var(--td-text-muted)', fontSize: '16px', fontWeight: 'bold', marginLeft: '0.25rem' },
                    title: 'Clear selection'
                }, '\u00d7')
            )
        );
    }

    // Search input
    toolbarLeft.push(
        React.createElement('input', {
            key: 'search',
            type: 'text',
            placeholder: 'Search tags...',
            value: searchText,
            onChange: function(e) { setSearchText(e.target.value); },
            style: { ...inputStyle, minWidth: '160px', maxWidth: '300px', flex: '0 1 auto' }
        })
    );

    // Bulk delete button — wrap in fit-content div to prevent full-width stretch
    if (selectedTags.length > 0) {
        toolbarLeft.push(
            React.createElement('div', {
                key: 'bulk-del',
                style: { width: 'fit-content' }
            },
                React.createElement(Button, {
                    onClick: handleBulkDelete,
                    appearance: 'destructive',
                    children: bulkDeleting ? 'Deleting...' : 'Delete Selected (' + selectedTags.length + ')',
                    disabled: bulkDeleting,
                    style: { width: 'fit-content' }
                })
            )
        );
    }

    // New Tag button / inline create form — left side with search/bulk (like "Create Credential")
    // Wrap in fit-content div to prevent Splunk Button from stretching full-width on wrap
    if (!showCreate) {
        toolbarLeft.push(
            React.createElement('div', {
                key: 'new-btn',
                style: { width: 'fit-content' }
            },
                React.createElement(Button, {
                    onClick: function() { setShowCreate(true); setCreateError(''); },
                    appearance: 'primary',
                    icon: React.createElement(PlusSquare, { variant: 'filled' }),
                    children: 'New Tag'
                })
            )
        );
    } else {
        toolbarLeft.push(
            React.createElement('div', {
                key: 'create-form',
                style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }
            },
                React.createElement('input', {
                    type: 'text',
                    placeholder: 'tag-name',
                    value: newTagName,
                    onChange: function(e) { setNewTagName(e.target.value); setCreateError(''); },
                    onKeyDown: handleCreateKeyDown,
                    style: { ...inputStyle, width: '110px' },
                    autoFocus: true
                }),
                React.createElement('input', {
                    type: 'text',
                    placeholder: 'description (optional)',
                    value: newTagDesc,
                    onChange: function(e) { setNewTagDesc(e.target.value); },
                    onKeyDown: handleCreateKeyDown,
                    style: { ...inputStyle, width: '150px' }
                }),
                React.createElement(ColorPresetPicker, {
                    selectedColor: newTagColor,
                    onChange: function(c) { setNewTagColor(c); },
                    idPrefix: 'create-new'
                }),
                React.createElement(Button, {
                    onClick: handleCreateTag,
                    appearance: 'primary',
                    children: creating ? '...' : 'Create'
                }),
                React.createElement(Button, {
                    onClick: function() { setShowCreate(false); setNewTagName(''); setCreateError(''); setNewTagDesc(''); },
                    appearance: 'subtle',
                    title: 'Cancel',
                    icon: React.createElement(Cross, { variant: 'filled' })
                }),
                createError && React.createElement('span', {
                    key: 'err',
                    style: { color: '#ef4444', fontSize: '11px', whiteSpace: 'nowrap' }
                }, createError)
            )
        );
    }

    return React.createElement('div', { className: 'tag-dashboard-container', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        themeStyles,

        // ── Summary Stats ──
        React.createElement('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } },
            statBlock('Total Tags', totalTags, '#3b82f6', '\u{1f3f3}'),
            statBlock('Assignments', totalTagAssignments, '#10b981', '\u{1f517}'),
            statBlock('Unused', unusedTags, '#f59e0b', '\u{1f6ab}')
        ),

        // ── Toolbar ──
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }
        }, ...toolbarLeft, ...toolbarRight),

        bulkError && React.createElement('div', {
            style: { color: '#ef4444', fontSize: '11px' }
        }, bulkError),

        // ── Toast ──
        toast && React.createElement('div', {
            style: {
                position: 'fixed',
                bottom: '1rem',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'var(--td-header-bg)',
                color: 'var(--td-text)',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                zIndex: 9999,
                border: '1px solid var(--td-border)'
            }
        }, toast),

        // ── Table ──
        // Matches CredentialTable: outerStyle + tableStyle + rowSelection + onRequestToggleAllRows
        React.createElement(Table, {
            outerStyle: { width: '100%', marginBottom: '1rem' },
            tableStyle: { width: '100%' },
            rowSelection: rowSelectionState,
            onRequestToggleAllRows: handleToggleSelectAll
        },
            React.createElement(TableHead, null,
                // No manual checkbox cell — Splunk rowSelection renders its own header checkbox
                React.createElement(TableHeadCell, { style: { width: COL.name } }, 'Name'),
                React.createElement(TableHeadCell, { style: { width: COL.desc } }, 'Description'),
                React.createElement(TableHeadCell, { style: { width: COL.color } }, 'Color'),
                React.createElement(TableHeadCell, { style: { width: COL.usage, textAlign: 'center' } }, 'Usage'),
                React.createElement(TableHeadCell, { style: { width: COL.actions } }, 'Actions')
            ),
            React.createElement(TableBody, null,
                filteredTags.length === 0
                    ? React.createElement(TableRow, null,
                        React.createElement(TableCell, {
                            // 5 data columns (rowSelection adds its own checkbox column automatically)
                            colSpan: 5,
                            style: { textAlign: 'center', padding: '2rem', color: 'var(--td-text-muted)', fontStyle: 'italic' }
                        }, searchText ? 'No tags match "' + searchText + '"' : 'No tags defined yet. Click "New Tag" above to get started.')
                    )
                    : filteredTags.map(function(tag) {
                        return React.createElement(TagRow, {
                            key: tag.tag_name,
                            tag: tag,
                            usage: tagUsages[tag.tag_name] || 0,
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
    );
}

module.exports = TagManagementDashboard;
