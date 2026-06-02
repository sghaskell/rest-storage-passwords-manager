/**
 * CellEditPopover.jsx — Floating popover for editing a single matrix cell.
 *
 * Shown when a user clicks a matrix cell in the RoleAccessDashboard.
 * Allows changing a single role's capability (RW, R, W, None) on a single credential.
 * Handles wildcard-inherited access with Option A (warn + require removal).
 */

const React = require('react');

var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Detect dark theme synchronously */
function detectDark() {
    var html = document.documentElement;
    if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (document.body.classList.contains('dark-theme')) return true;
    return false;
}

/** Parse a comma-delimited ACL string into a clean array */
function parseRoles(str) {
    return (str || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
}

/** Check if role array contains wildcard */
function hasWildcard(roles) {
    return roles.indexOf('*') !== -1 || roles.indexOf('* (all)') !== -1;
}

/** Remove wildcard from role array */
function removeWildcard(roles) {
    return roles.filter(function(r) { return r !== '*' && r !== '* (all)'; });
}

// ─── Access level colour map (matches MatrixCell palette) ───────────────────

function getLevelStyle(level, isDark) {
    if (level === 'WILDCARD' || level === 'WildcardBoth') {
        return { bg: isDark ? '#3d0000' : '#fff3cd', color: '#f59e0b', border: '#f59e0b' };
    }
    if (level === 'RW') {
        return { bg: isDark ? '#0d2818' : '#e8f5e9', color: '#2e7d32', border: '#2e7d32' };
    }
    if (level === 'R') {
        return { bg: isDark ? '#0a1931' : '#e3f2fd', color: '#1565c0', border: '#1565c0' };
    }
    if (level === 'W' || level === 'WildcardWrite') {
        return { bg: isDark ? '#1e0a0a' : '#fce4ec', color: '#c62828', border: '#c62828' };
    }
    if (level === 'WildcardRead') {
        return { bg: isDark ? '#0a1931' : '#e3f2fd', color: '#1565c0', border: '#1565c0' };
    }
    // None / '-'
    return { bg: 'transparent', color: '#999', border: '#999' };
}

// ─── Component ───────────────────────────────────────────────────────────────

function CellEditPopover({
    cred,
    role,
    accessLevel,
    isWildcardDerived,
    onClose,
    onSave,
    isDark,
    anchorRect
}) {
    // If we have a pre-existing isDark prop, use it; otherwise detect
    var themeDark = isDark !== undefined ? isDark : detectDark();
    var cardBg = themeDark ? '#1e293b' : '#fff';
    var cardBorder = themeDark ? '#333' : '#e0e0e0';
    var inputBg = themeDark ? '#2d2d2d' : '#fff';
    var inputBorder = themeDark ? '#555' : '#ccc';
    var inputColor = themeDark ? '#e0e0e0' : '#333';
    var subText = themeDark ? '#999' : '#666';

    // Determine if this is the sentinel * (all) column
    var isSentinel = role === '* (all)';

    // Access level options depend on whether this is the sentinel column
    var normalOptions = [
        { value: 'RW', label: 'RW' },
        { value: 'R', label: 'R' },
        { value: 'W', label: 'W' },
        { value: '-', label: 'None' }
    ];
    var sentinelOptions = [
        { value: 'WildcardBoth', label: 'Both' },
        { value: 'WildcardRead', label: 'Read' },
        { value: 'WildcardWrite', label: 'Write' },
        { value: '-', label: 'None' }
    ];
    var options = isSentinel ? sentinelOptions : normalOptions;

    // Map current accessLevel to a selectable option value
    var currentSelection = accessLevel;

    const [selectedLevel, setSelectedLevel] = React.useState(currentSelection);
    const [wildcardRemoved, setWildcardRemoved] = React.useState(!isWildcardDerived);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState('');
    const [position, setPosition] = React.useState({ top: 0, left: 0 });

    // Position the popover near the anchor rect
    React.useEffect(function() {
        if (anchorRect) {
            var top = anchorRect.bottom + 4;
            var left = anchorRect.left;
            // Keep within viewport
            var popoverWidth = 340;
            var popoverHeight = 260;
            if (left + popoverWidth > window.innerWidth) {
                left = window.innerWidth - popoverWidth - 8;
            }
            if (top + popoverHeight > window.innerHeight) {
                top = anchorRect.top - popoverHeight - 4;
            }
            if (top < 8) top = 8;
            if (left < 8) left = 8;
            setPosition({ top: top, left: left });
        }
    }, [anchorRect]);

    // Click-outside handler
    React.useEffect(function() {
        var handleClick = function(e) {
            var popover = document.getElementById('cell-edit-popover');
            if (popover && !popover.contains(e.target)) {
                onClose();
            }
        };
        // Delay adding listener so the click that opened the popover doesn't immediately close it
        var timer = setTimeout(function() {
            document.addEventListener('mousedown', handleClick);
        }, 100);
        return function() {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClick);
        };
    }, [onClose]);

    // Build the new role arrays for the selected level
    function buildRoleArrays(level) {
        var currentRead = parseRoles(cred.aclRead);
        var currentWrite = parseRoles(cred.aclWrite);

        // If wildcard was removed, strip it from both arrays
        if (!wildcardRemoved) {
            currentRead = removeWildcard(currentRead);
            currentWrite = removeWildcard(currentWrite);
        }

        if (isSentinel) {
            // Sentinel column: manipulate the * entry directly
            // Remove existing * first
            currentRead = removeWildcard(currentRead);
            currentWrite = removeWildcard(currentWrite);

            if (level === 'WildcardBoth') {
                currentRead.push('*');
                currentWrite.push('*');
            } else if (level === 'WildcardRead') {
                currentRead.push('*');
            } else if (level === 'WildcardWrite') {
                currentWrite.push('*');
            }
            // '-' = no wildcard
        } else {
            // Normal column: manipulate the specific role
            if (level === 'RW') {
                if (currentRead.indexOf(role) === -1) currentRead.push(role);
                if (currentWrite.indexOf(role) === -1) currentWrite.push(role);
            } else if (level === 'R') {
                if (currentRead.indexOf(role) === -1) currentRead.push(role);
                var writeIdx = currentWrite.indexOf(role);
                if (writeIdx !== -1) currentWrite.splice(writeIdx, 1);
            } else if (level === 'W') {
                var readIdx = currentRead.indexOf(role);
                if (readIdx !== -1) currentRead.splice(readIdx, 1);
                if (currentWrite.indexOf(role) === -1) currentWrite.push(role);
            } else if (level === '-') {
                var rIdx = currentRead.indexOf(role);
                if (rIdx !== -1) currentRead.splice(rIdx, 1);
                var wIdx = currentWrite.indexOf(role);
                if (wIdx !== -1) currentWrite.splice(wIdx, 1);
            }
        }

        return { read: currentRead, write: currentWrite };
    }

    async function handleSave() {
        setError('');

        // Validate: if wildcard-derived and wildcard not removed
        if (isWildcardDerived && !wildcardRemoved) {
            setError('Cannot modify access for individual role while wildcard (*) is active. Click "Remove Wildcard & Edit" first.');
            return;
        }

        // Check if level changed
        if (selectedLevel === currentSelection && !isWildcardDerived) {
            // No change — just close
            onClose();
            return;
        }

        setSaving(true);
        var roles = buildRoleArrays(selectedLevel);
        try {
            await onSave(cred, roles.read, roles.write);
        } catch (err) {
            setError('Save failed: ' + (err.message || String(err)));
        } finally {
            setSaving(false);
        }
    }

    // Display credential name (realm:username)
    var credRealm = cred.realm || 'global';
    var credName = cred.name || '';
    var displayName = credRealm + ':' + credName;
    var displayRole = role;

    // Wildcard warning section
    var wildcardWarningHtml = null;
    if (isWildcardDerived && !isSentinel) {
        var wildcardRemovedBtn = wildcardRemoved
            ? null
            : React.createElement(Button, {
                onClick: function() { setWildcardRemoved(true); },
                appearance: 'subtle',
                children: 'Remove Wildcard & Edit',
                style: { fontSize: '12px', padding: '4px 12px', color: '#f59e0b', marginTop: '4px' }
            });

        wildcardWarningHtml = React.createElement('div', {
            style: {
                backgroundColor: themeDark ? '#3d3400' : '#fff3cd',
                border: '1px solid ' + (themeDark ? '#665c00' : '#ffc107'),
                borderRadius: '4px',
                padding: '0.5rem 0.75rem',
                fontSize: '12px',
                color: themeDark ? '#ffd54f' : '#856404',
                marginBottom: '0.75rem'
            }
        },
            React.createElement('div', { style: { marginBottom: '4px' } },
                '\u26a0\ufe0f Access inherited from wildcard (*). To modify this cell, the wildcard must be replaced with explicit roles for all other roles currently covered.'
            ),
            wildcardRemovedBtn
        );
    }

    // Access level selector buttons
    var selectorHtml = options.map(function(opt) {
        var isSelected = selectedLevel === opt.value;
        var style = getLevelStyle(opt.value, themeDark);
        var btnStyle = {
            flex: 1,
            padding: '6px 4px',
            fontSize: '13px',
            fontWeight: '600',
            textAlign: 'center',
            backgroundColor: isSelected ? style.bg : inputBg,
            color: isSelected ? style.color : inputColor,
            border: '1px solid ' + (isSelected ? style.border : inputBorder),
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'all 0.1s'
        };

        return React.createElement('div', {
            key: opt.value,
            'data-level': opt.value,
            style: btnStyle,
            onClick: function() {
                setSelectedLevel(opt.value);
                setError('');
            }
        }, opt.label);
    });

    return React.createElement('div', {
        id: 'cell-edit-popover',
        style: {
            position: 'fixed',
            top: position.top + 'px',
            left: position.left + 'px',
            width: '340px',
            backgroundColor: cardBg,
            border: '1px solid ' + cardBorder,
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
            padding: '0.75rem',
            fontSize: '13px',
            color: inputColor
        }
    },
        // Header: credential + role
        React.createElement('div', {
            style: { marginBottom: '0.5rem' }
        },
            React.createElement('div', {
                style: { fontSize: '12px', fontWeight: '700', marginBottom: '2px', color: inputColor }
            }, displayName),
            React.createElement('div', {
                style: { fontSize: '12px', color: subText }
            }, 'Role: ', React.createElement('strong', null, displayRole)),
            React.createElement('div', {
                style: { fontSize: '11px', color: subText, marginTop: '2px' }
            }, 'Current: ',
                React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: getLevelStyle(accessLevel, themeDark).bg,
                        color: getLevelStyle(accessLevel, themeDark).color,
                        fontWeight: '600',
                        fontSize: '11px'
                    }
                }, accessLevel)
            )
        ),

        // Wildcard warning (if applicable)
        wildcardWarningHtml,

        // Access level selector
        React.createElement('div', {
            style: { marginBottom: '0.75rem' }
        },
            React.createElement('div', {
                style: { fontSize: '12px', fontWeight: '500', marginBottom: '0.4rem', color: inputColor }
            }, 'Set access to:'),
            React.createElement('div', {
                style: { display: 'flex', gap: '0.4rem' }
            }, selectorHtml)
        ),

        // Error message
        error && React.createElement('div', {
            style: {
                fontSize: '11px',
                color: '#ef4444',
                marginBottom: '0.5rem',
                padding: '4px 8px',
                backgroundColor: themeDark ? '#3d0000' : '#fce4ec',
                borderRadius: '3px'
            }
        }, error),

        // Actions
        React.createElement('div', {
            style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }
        },
            React.createElement(Button, {
                onClick: onClose,
                appearance: 'subtle',
                children: 'Cancel',
                disabled: saving,
                style: { fontSize: '12px' }
            }),
            React.createElement(Button, {
                onClick: handleSave,
                appearance: 'primary',
                children: saving ? 'Saving...' : 'Save',
                disabled: saving,
                style: { fontSize: '12px' }
            })
        )
    );
}

module.exports = CellEditPopover;
