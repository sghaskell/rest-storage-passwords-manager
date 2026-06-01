/**
 * RoleAccessDashboard.jsx — Role Access Dashboard with table and matrix views.
 *
 * Shows which roles have read/write access to which credentials, with
 * least-privilege auditing and a role×credential matrix.
 */

const React = require('react');
const API = require('../api');

// Splunk design system imports
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
var DropdownMod = require('@splunk/react-ui/Dropdown');
var Dropdown = DropdownMod.default;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a credential has open (wildcard) read access */
function hasOpenAccess(cred) {
    var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
    return readRoles.indexOf('*') !== -1 || readRoles.indexOf('* (all)') !== -1;
}

/** Check if a credential is admin-writable */
function isAdminWritable(cred, adminRoleNames) {
    var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); });
    if (writeRoles.indexOf('*') !== -1 || writeRoles.indexOf('* (all)') !== -1) return true;
    return adminRoleNames.some(function(ar) { return writeRoles.indexOf(ar) !== -1; });
}

/** Detect dark theme synchronously */
function detectDark() {
    var html = document.documentElement;
    if (html.classList.contains('dark-theme') || html.classList.contains('theme-dark')) return true;
    if (html.getAttribute('data-theme') === 'dark') return true;
    if (document.body.classList.contains('dark-theme')) return true;
    return false;
}

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({ label, value, color, warning }) {
    var isDark = detectDark();
    var bg = isDark ? '#1e293b' : '#f8fafc';
    var border = color + '40';
    var textColor = isDark ? '#e0e0e0' : '#333';
    var subText = isDark ? '#999' : '#666';

    return React.createElement('div', {
        style: {
            flex: '1 1 140px',
            padding: '0.75rem 1rem',
            backgroundColor: bg,
            border: '1px solid ' + border,
            borderRadius: '6px',
            textAlign: 'center',
        }
    },
        React.createElement('div', {
            style: { fontSize: '24px', fontWeight: '700', color: color, marginBottom: '0.25rem' }
        }, value),
        React.createElement('div', {
            style: { fontSize: '12px', color: subText, textTransform: 'uppercase', letterSpacing: '0.05em' }
        }, label),
        warning && React.createElement('div', {
            style: { fontSize: '11px', color: '#f59e0b', marginTop: '4px' }
        }, '⚠ ' + warning)
    );
}

// ─── Matrix Cell ────────────────────────────────────────────────────────────

function MatrixCell({ accessLevel, isDark }) {
    var cellStyle = {
        textAlign: 'center',
        padding: '4px 8px',
        fontSize: '12px',
        fontWeight: '600',
        border: '1px solid ' + (isDark ? '#333' : '#e0e0e0'),
        minWidth: '48px',
    };

    if (accessLevel === 'WILDCARD') {
        cellStyle.backgroundColor = isDark ? '#3d0000' : '#fff3cd';
        cellStyle.color = '#f59e0b';
        cellStyle.border = '1px solid #f59e0b';
    } else if (accessLevel === 'RW') {
        cellStyle.backgroundColor = isDark ? '#0d2818' : '#e8f5e9';
        cellStyle.color = '#2e7d32';
    } else if (accessLevel === 'R') {
        cellStyle.backgroundColor = isDark ? '#0a1931' : '#e3f2fd';
        cellStyle.color = '#1565c0';
    } else if (accessLevel === 'W') {
        cellStyle.backgroundColor = isDark ? '#1e0a0a' : '#fce4ec';
        cellStyle.color = '#c62828';
    } else {
        cellStyle.backgroundColor = 'transparent';
        cellStyle.color = '#999';
    }

    return React.createElement('div', { style: cellStyle }, accessLevel);
}

// ─── Main Dashboard ────────────────────────────────────────────────────────

function RoleAccessDashboard({
    credentials,
    rolesWithCapabilities,
    onOpenBulkAssign,
    onViewCredential,
}) {
    var isDark = detectDark();

    const [viewMode, setViewMode] = React.useState('table'); // 'table' | 'matrix'
    const [filterRole, setFilterRole] = React.useState('');
    const [showOpenAccess, setShowOpenAccess] = React.useState(false);
    const [showAdminWritable, setShowAdminWritable] = React.useState(false);

    // Derive admin role names and all role names
    var adminRoleNames = React.useMemo(function() {
        return (rolesWithCapabilities || []).filter(function(r) { return r.isAdmin; })
            .map(function(r) { return r.name; });
    }, [rolesWithCapabilities]);

    var allRoleNames = React.useMemo(function() {
        var names = (rolesWithCapabilities || []).map(function(r) { return r.name; });
        if (!names.some(function(r) { return r === '* (all)'; })) {
            names.unshift('* (all)');
        }
        return names;
    }, [rolesWithCapabilities]);

    /** Deduplicate credentials by stanzaKey — Splunk returns the same credential
     * at each namespace level (user/app/global). Merge ACL permissions across
     * all entries so each credential appears once.
     */
    function dedupCredentials(list) {
        var byKey = {};
        list.forEach(function(cred) {
            var key = cred.stanzaKey || '';
            if (!key) return;
            if (!byKey[key]) {
                byKey[key] = Object.assign({}, cred, { aclReadRoles: [], aclWriteRoles: [] });
            }
            var merged = byKey[key];
            // Merge read roles
            (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean).forEach(function(r) {
                if (merged.aclReadRoles.indexOf(r) === -1) merged.aclReadRoles.push(r);
            });
            // Merge write roles
            (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean).forEach(function(r) {
                if (merged.aclWriteRoles.indexOf(r) === -1) merged.aclWriteRoles.push(r);
            });
            // Update merged ACL strings
            merged.aclRead = merged.aclReadRoles.join(', ');
            merged.aclWrite = merged.aclWriteRoles.join(', ');
        });
        return Object.keys(byKey).map(function(k) { return byKey[k]; });
    }

    // Deduplicated credential list (base for all views)
    var uniqueCredentials = React.useMemo(function() {
        return dedupCredentials(credentials);
    }, [credentials]);

    // Aggregate credentials by role (use deduplicated list)
    var aggregation = React.useMemo(function() {
        return API && API.aggregateByRole ? API.aggregateByRole(uniqueCredentials, allRoleNames) : { roleMap: {}, openAccessCount: 0, adminWritableCount: 0 };
    }, [uniqueCredentials, allRoleNames]);

    // Filtered credentials (deduplicated)
    var filteredCreds = React.useMemo(function() {
        return uniqueCredentials.filter(function(cred) {
            var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
            var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);

            if (filterRole) {
                var hasRole = readRoles.indexOf(filterRole) !== -1 || writeRoles.indexOf(filterRole) !== -1;
                if (!hasRole) return false;
            }
            if (showOpenAccess) {
                if (!hasOpenAccess(cred)) return false;
            }
            if (showAdminWritable) {
                if (!isAdminWritable(cred, adminRoleNames)) return false;
            }
            return true;
        });
    }, [uniqueCredentials, filterRole, showOpenAccess, showAdminWritable, adminRoleNames]);

    // Sort: open access first, then by name
    filteredCreds.sort(function(a, b) {
        var aOpen = hasOpenAccess(a) ? 0 : 1;
        var bOpen = hasOpenAccess(b) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return (a.name || '').localeCompare(b.name || '');
    });

    // Performance cap for matrix
    var matrixRoles = allRoleNames.slice(0, 50);
    var matrixCreds = filteredCreds.slice(0, 200);

    // Compute matrix cell — get access level for role × credential
    function getAccessLevel(role, cred) {
        var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
        var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);

        // Check for wildcard first — * in ACL means ALL roles get that access
        var readWildcard = readRoles.indexOf('*') !== -1 || readRoles.indexOf('* (all)') !== -1;
        var writeWildcard = writeRoles.indexOf('*') !== -1 || writeRoles.indexOf('* (all)') !== -1;

        // If role is the sentinel * (all), show WILDCARD for wildcard ACLs
        if (role === '* (all)') {
            if (readWildcard || writeWildcard) return 'WILDCARD';
            return '-';
        }

        // For real roles: wildcard ACL grants access, OR explicit role match
        var hasRead = readWildcard || readRoles.indexOf(role) !== -1;
        var hasWrite = writeWildcard || writeRoles.indexOf(role) !== -1;
        if (hasRead && hasWrite) return 'RW';
        if (hasRead) return 'R';
        if (hasWrite) return 'W';
        return '-';
    }

    // CSS variables for theme
    var cardBg = isDark ? '#1e293b' : '#fff';
    var cardBorder = isDark ? '#333' : '#e0e0e0';
    var headerBg = isDark ? '#15191e' : '#f5f5f5';
    var headerColor = isDark ? '#e0e0e0' : '#333';
    var subText = isDark ? '#999' : '#666';
    var inputBg = isDark ? '#2d2d2d' : '#fff';
    var inputBorder = isDark ? '#555' : '#ccc';
    var inputColor = isDark ? '#e0e0e0' : '#333';

    // ── Role dropdown options ──
    var roleDropdownOptions = [
        React.createElement('option', { key: 'all-roles', value: '' }, 'All Roles'),
        allRoleNames.map(function(r) {
            return React.createElement('option', { key: r, value: r }, r);
        })
    ];

    return React.createElement('div', {
        style: { padding: '0', backgroundColor: isDark ? '#15191e' : '#f9fafb', borderRadius: '8px' }
    },
        // ── Header ──
        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '1rem',
                borderBottom: '1px solid ' + cardBorder,
            }
        },
            React.createElement('h3', {
                style: { margin: 0, fontSize: '16px', fontWeight: '600', color: headerColor }
            }, 'Role Access Dashboard'),
            React.createElement('div', {
                style: { display: 'flex', gap: '0.5rem' }
            },
                React.createElement(Button, {
                    onClick: function() { setViewMode('table'); },
                    appearance: viewMode === 'table' ? 'primary' : 'subtle',
                    children: 'Table View'
                }),
                React.createElement(Button, {
                    onClick: function() { setViewMode('matrix'); },
                    appearance: viewMode === 'matrix' ? 'primary' : 'subtle',
                    children: 'Matrix View'
                }),
                React.createElement(Button, {
                    onClick: function() { onOpenBulkAssign(filteredCreds); },
                    appearance: 'subtle',
                    children: 'Bulk Assign Roles (' + filteredCreds.length + ')'
                })
            )
        ),

        // ── Stats cards ──
        React.createElement('div', {
            style: { display: 'flex', gap: '0.75rem', padding: '1rem', flexWrap: 'wrap' }
        },
            React.createElement(StatCard, {
                label: 'Total Credentials',
                value: uniqueCredentials.length,
                color: '#3b82f6'
            }),
            React.createElement(StatCard, {
                label: 'Open Access',
                value: aggregation.openAccessCount,
                color: '#f59e0b',
                warning: aggregation.openAccessCount > 0 ? 'Anyone can read these' : null
            }),
            React.createElement(StatCard, {
                label: 'Admin-Writable',
                value: aggregation.adminWritableCount,
                color: '#ef4444'
            }),
            React.createElement(StatCard, {
                label: 'Unique Roles',
                value: allRoleNames.length,
                color: '#10b981'
            })
        ),

        // ── Filters ──
        React.createElement('div', {
            style: { display: 'flex', gap: '0.75rem', padding: '0.75rem 1rem', alignItems: 'center', flexWrap: 'wrap' }
        },
            React.createElement('label', {
                style: { fontSize: '13px', color: subText, display: 'flex', alignItems: 'center', gap: '0.35rem' }
            }, 'Filter by role:'),
            React.createElement('select', {
                value: filterRole,
                onChange: function(e) { setFilterRole(e.target.value); },
                style: {
                    padding: '4px 8px',
                    border: '1px solid ' + inputBorder,
                    borderRadius: '4px',
                    fontSize: '13px',
                    backgroundColor: inputBg,
                    color: inputColor,
                }
            }, roleDropdownOptions),

            React.createElement('label', {
                style: {
                    fontSize: '13px',
                    color: subText,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    cursor: 'pointer',
                }
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: showOpenAccess,
                    onChange: function(e) { setShowOpenAccess(e.target.checked); }
                }),
                'Open access only'
            ),
            React.createElement('label', {
                style: {
                    fontSize: '13px',
                    color: subText,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    cursor: 'pointer',
                }
            },
                React.createElement('input', {
                    type: 'checkbox',
                    checked: showAdminWritable,
                    onChange: function(e) { setShowAdminWritable(e.target.checked); }
                }),
                'Admin-writable only'
            ),

            // Result count
            React.createElement('span', {
                style: { marginLeft: 'auto', fontSize: '12px', color: subText }
            }, filteredCreds.length + ' credential(s) shown')
        ),

        // ── Table view ──
        viewMode === 'table' ? React.createElement('div', {
            style: { overflowX: 'auto', padding: '0 1rem 1rem' }
        },
            React.createElement('table', {
                style: {
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '13px',
                    color: inputColor,
                }
            },
                React.createElement('thead', null,
                    React.createElement('tr', {
                        style: { backgroundColor: headerBg, borderBottom: '2px solid ' + cardBorder }
                    },
                        ['Username', 'Realm', 'Read Roles', 'Write Roles', 'Admin-Writable', 'Actions'].map(function(h) {
                            return React.createElement('th', {
                                key: h,
                                style: {
                                    padding: '8px 12px',
                                    textAlign: 'left',
                                    fontWeight: '600',
                                    color: headerColor,
                                    borderBottom: '1px solid ' + cardBorder,
                                }
                            }, h);
                        })
                    )
                ),
                React.createElement('tbody', null,
                    filteredCreds.length === 0 ?
                        React.createElement('tr', null,
                            React.createElement('td', {
                                colSpan: 6,
                                style: { textAlign: 'center', padding: '2rem', color: subText, fontStyle: 'italic' }
                            }, 'No credentials match the current filters')
                        ) :
                        filteredCreds.map(function(cred) {
                            var readRoles = (cred.aclRead || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
                            var writeRoles = (cred.aclWrite || '').split(',').map(function(r) { return r.trim(); }).filter(Boolean);
                            var isAW = isAdminWritable(cred, adminRoleNames);
                            var isOpen = hasOpenAccess(cred);

                            // Pill color map for read roles
                            var readPillColor = isDark ? '#e1bee7' : '#7b1fa2';
                            var readPillBg = isDark ? '#4a148c' : '#f3e5f5';
                            var writePillColor = isDark ? '#f8bbd0' : '#c62828';
                            var writePillBg = isDark ? '#b71c1c' : '#fce4ec';

                            return React.createElement('tr', {
                                key: cred.stanzaKey + ':' + cred.app + ':' + cred.owner,
                                style: { borderBottom: '1px solid ' + cardBorder, backgroundColor: cardBg }
                            },
                                // Username
                                React.createElement('td', { style: { padding: '8px 12px' } },
                                    React.createElement('span', {
                                        onClick: onViewCredential ? function() { onViewCredential(cred); } : null,
                                        style: { cursor: onViewCredential ? 'pointer' : 'default', color: '#3b82f6', textDecoration: 'underline' }
                                    }, cred.name || ''),
                                    isOpen && React.createElement('span', {
                                        style: { display: 'inline-block', marginLeft: '6px', fontSize: '11px', color: '#f59e0b' }
                                    }, '⚠ open')
                                ),
                                // Realm
                                React.createElement('td', { style: { padding: '8px 12px' } }, cred.realm || 'global'),
                                // Read roles
                                React.createElement('td', { style: { padding: '8px 12px' } },
                                    React.createElement('div', {
                                        style: { display: 'flex', gap: '4px', flexWrap: 'wrap' }
                                    },
                                        readRoles.map(function(role, i) {
                                            return React.createElement('span', {
                                                key: i,
                                                style: {
                                                    display: 'inline-block',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '11px',
                                                    fontWeight: '600',
                                                    backgroundColor: readPillBg,
                                                    color: readPillColor,
                                                    border: '1px solid ' + readPillColor + '40',
                                                    whiteSpace: 'nowrap',
                                                }
                                            }, role);
                                        })
                                    )
                                ),
                                // Write roles
                                React.createElement('td', { style: { padding: '8px 12px' } },
                                    React.createElement('div', {
                                        style: { display: 'flex', gap: '4px', flexWrap: 'wrap' }
                                    },
                                        writeRoles.map(function(role, i) {
                                            return React.createElement('span', {
                                                key: i,
                                                style: {
                                                    display: 'inline-block',
                                                    padding: '2px 8px',
                                                    borderRadius: '12px',
                                                    fontSize: '11px',
                                                    fontWeight: '600',
                                                    backgroundColor: writePillBg,
                                                    color: writePillColor,
                                                    border: '1px solid ' + writePillColor + '40',
                                                    whiteSpace: 'nowrap',
                                                }
                                            }, role);
                                        })
                                    )
                                ),
                                // Admin-writable flag
                                React.createElement('td', { style: { padding: '8px 12px', textAlign: 'center' } },
                                    React.createElement('span', {
                                        style: {
                                            display: 'inline-block',
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            fontSize: '11px',
                                            fontWeight: '600',
                                            backgroundColor: isAW ? (isDark ? '#3d0000' : '#fce4ec') : (isDark ? '#0d2818' : '#e8f5e9'),
                                            color: isAW ? '#ef4444' : '#2e7d32',
                                        }
                                    }, isAW ? 'Yes' : 'No')
                                ),
                                // Actions
                                React.createElement('td', { style: { padding: '8px 12px' } },
                                    React.createElement(Button, {
                                        onClick: function() { onOpenBulkAssign([cred]); },
                                        appearance: 'subtle',
                                        children: 'Assign Roles'
                                    })
                                )
                            );
                        })
                )
            )
        ) : null,

        // ── Matrix view ──
        viewMode === 'matrix' ? React.createElement('div', {
            style: { padding: '0 1rem 1rem', overflowX: 'auto' }
        },
            // Legend
            React.createElement('div', {
                style: {
                    display: 'flex',
                    gap: '1rem',
                    padding: '0.5rem 0',
                    fontSize: '11px',
                    color: subText,
                    marginBottom: '0.5rem'
                }
            },
                ['RW = Both', 'R = Read', 'W = Write', '✓ = Wildcard', '= No access'].map(function(item) {
                    return React.createElement('span', { key: item }, item);
                })
            ),
            React.createElement('div', {
                style: {
                    fontSize: '11px',
                    color: '#f59e0b',
                    marginBottom: '0.5rem'
                }
            }, '⚠ Performance cap: showing ' + matrixCreds.length + ' credentials × ' + matrixRoles.length + ' roles (max 200×50)'),
            React.createElement('table', {
                style: {
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: '12px',
                    color: inputColor,
                }
            },
                // Header row — roles as columns
                React.createElement('thead', null,
                    React.createElement('tr', {
                        style: { backgroundColor: headerBg, borderBottom: '2px solid ' + cardBorder }
                    },
                        React.createElement('th', {
                            style: {
                                padding: '8px',
                                fontWeight: '600',
                                color: headerColor,
                                position: 'sticky',
                                left: 0,
                                backgroundColor: headerBg,
                                zIndex: 1,
                                borderRight: '1px solid ' + cardBorder,
                                minWidth: '140px',
                            }
                        }, 'Credential →'),
                        matrixRoles.map(function(role) {
                            var isWildcard = role === '* (all)';
                            return React.createElement('th', {
                                key: 'role-th-' + role,
                                style: {
                                    padding: '4px 6px',
                                    textAlign: 'center',
                                    fontWeight: '500',
                                    color: isWildcard ? '#f59e0b' : headerColor,
                                    borderBottom: '1px solid ' + cardBorder,
                                    minWidth: '60px',
                                    whiteSpace: 'nowrap',
                                }
                            }, React.createElement('div', {
                                style: { fontSize: '11px', fontWeight: '600' }
                            }, role),
                            );
                        })
                    )
                ),
                // Data rows — one per credential
                React.createElement('tbody', null,
                    matrixCreds.map(function(cred) {
                        var realm = cred.realm || 'global';
                        var displayName = cred.name || '';
                        var isOpen = hasOpenAccess(cred);
                        return React.createElement('tr', {
                            key: cred.stanzaKey + ':' + cred.app + ':' + cred.owner,
                            style: { borderBottom: '1px solid ' + cardBorder, backgroundColor: cardBg }
                        },
                            // Credential label (sticky first column)
                            React.createElement('td', {
                                style: {
                                    padding: '6px 8px',
                                    fontWeight: '600',
                                    fontSize: '12px',
                                    color: inputColor,
                                    position: 'sticky',
                                    left: 0,
                                    backgroundColor: cardBg,
                                    zIndex: 0,
                                    borderRight: '1px solid ' + cardBorder,
                                    whiteSpace: 'nowrap',
                                },
                                title: cred.stanzaKey || ''
                            }, React.createElement('span', {
                                style: { cursor: 'pointer', color: '#3b82f6', textDecoration: 'underline' }
                            }, realm + ':' + displayName),
                            isOpen && React.createElement('span', {
                                style: { marginLeft: '4px', fontSize: '10px', color: '#f59e0b' }
                            }, '⚠')
                            ),
                            // Access cells — one per role
                            matrixRoles.map(function(role) {
                                var level = getAccessLevel(role, cred);
                                return React.createElement('td', {
                                    key: role + ':' + cred.stanzaKey
                                }, React.createElement(MatrixCell, {
                                    accessLevel: level,
                                    isDark: isDark
                                }));
                            })
                        );
                    })
                )
            )
        ) : null
    );
}

module.exports = RoleAccessDashboard;
