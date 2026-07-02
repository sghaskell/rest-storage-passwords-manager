/**
 * ExpiryDashboard.jsx — Dashboard view showing credentials grouped by rotation status
 *
 * Stats bar with 4 cards (total/overdue/due-soon/ok), sortable table with days
 * remaining indicator, color-coded rows, auto-refresh, and threshold slider.
 * Uses @splunk/react-ui Table, Paginator, Button, and Switch components.
 */

const React = require('react');

// Splunk design system imports
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
var SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
var TableMod = require('@splunk/react-ui/Table');
var Table = TableMod.default;
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;
var PaginatorMod = require('@splunk/react-ui/Paginator');
var Paginator = PaginatorMod.default;

// Splunk icons
var ArrowLeft = require('@splunk/react-icons/ArrowLeft').default;
var ArrowClockwise = require('@splunk/react-icons/ArrowClockwise').default;
var ArrowDown = require('@splunk/react-icons/ArrowDown').default;
var ArrowUp = require('@splunk/react-icons/ArrowUp').default;
var ArrowUpDown = require('@splunk/react-icons/ArrowUpDown').default;
var Cog = require('@splunk/react-icons/Cog').default;
var CheckboxMod = require('@splunk/react-ui/Checkbox');
var Checkbox = CheckboxMod.default;

const API = require('../api');
var { isDarkTheme } = require('../utils/theme');

// ─── Column definitions ─────────────────────────────────────────────────────
var COLUMNS = [
    { key: 'name',            label: 'Username',       sortable: true  },
    { key: 'realm',           label: 'Realm',          sortable: true  },
    { key: 'expiryDate',      label: 'Expiry Date',    sortable: true  },
    { key: 'daysRemaining',   label: 'Days Remaining', sortable: false },
    { key: 'rotationStatus',  label: 'Status',         sortable: true  },
    { key: 'actions',         label: 'Actions',        sortable: false }
];

// ─── localStorage keys ────────────────────────────────────────────────────────
const AUTO_REFRESH_KEY = 'expiry-auto-refresh-enabled';
const AUTO_REFRESH_INTERVAL_KEY = 'expiry-auto-refresh-interval';
const ROWS_PER_PAGE_KEY = 'expiry-dashboard-rows-per-page';
const DEFAULT_AUTO_REFRESH = true;
const DEFAULT_AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_ROWS_PER_PAGE = 10;

// ─── Color palette (matches CredentialTable rotation colors) ─────────────────
var STATUS_COLORS = {
    overdue:  '#d32f2f',
    'due-soon': '#f59e0b',
    ok:       '#0d8469',
    none:     '#9e9e9e'
};

function getStatusColor(status) {
    return STATUS_COLORS[status] || STATUS_COLORS.none;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysRemaining(expiryDate) {
    if (!expiryDate) return null;
    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var expiry = new Date(expiryDate + 'T00:00:00');
    var diffMs = expiry - now;
    return Math.round(diffMs / 86400000);
}

function getAutoRefreshEnabled() {
    try {
        var val = localStorage.getItem(AUTO_REFRESH_KEY);
        if (val !== null) return val === 'true';
    } catch (e) {}
    return DEFAULT_AUTO_REFRESH;
}

function setAutoRefreshEnabled(enabled) {
    try { localStorage.setItem(AUTO_REFRESH_KEY, String(enabled)); } catch (e) {}
}

function getAutoRefreshInterval() {
    try {
        var val = localStorage.getItem(AUTO_REFRESH_INTERVAL_KEY);
        if (val) {
            var ms = parseInt(val, 10);
            if (ms >= 60000 && ms <= 3600000) return ms; // 1min – 60min
        }
    } catch (e) {}
    return DEFAULT_AUTO_REFRESH_MS;
}

function setAutoRefreshInterval(ms) {
    var clamped = Math.max(60000, Math.min(3600000, ms));
    try { localStorage.setItem(AUTO_REFRESH_INTERVAL_KEY, String(clamped)); } catch (e) {}
    return clamped;
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function loadRowsPerPage() {
    try {
        var stored = localStorage.getItem(ROWS_PER_PAGE_KEY);
        if (stored) {
            var parsed = parseInt(stored, 10);
            if ([10, 25, 50].indexOf(parsed) !== -1) return parsed;
        }
    } catch (e) {}
    return DEFAULT_ROWS_PER_PAGE;
}

function saveRowsPerPage(count) {
    try { localStorage.setItem(ROWS_PER_PAGE_KEY, String(count)); } catch (e) {}
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

function compareCreds(a, b, key, direction) {
    var modifier = direction === 'asc' ? 1 : -1;
    if (key === 'daysRemaining') {
        // Sort by numeric daysRemaining, null at bottom
        var aVal = a.daysRemaining;
        var bVal = b.daysRemaining;
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return modifier;
        if (bVal === null) return -modifier;
        return (aVal - bVal) * modifier;
    }
    if (key === 'expiryDate') {
        // Credentials with expiry first (soonest), none at bottom
        var aHas = !!a.expiryDate;
        var bHas = !!b.expiryDate;
        if (aHas && !bHas) return -1 * modifier;
        if (!aHas && bHas) return 1 * modifier;
        if (!aHas && !bHas) {
            // No expiry — sort alphabetically by name
            var aN = (a.name || '').toLowerCase();
            var bN = (b.name || '').toLowerCase();
            if (aN < bN) return -1 * modifier;
            if (aN > bN) return 1 * modifier;
            return 0;
        }
        var aD = (a.expiryDate || '').toString();
        var bD = (b.expiryDate || '').toString();
        if (aD < bD) return -1 * modifier;
        if (aD > bD) return 1 * modifier;
        return 0;
    }
    if (key === 'rotationStatus') {
        // overdue first, then due-soon, then ok, then none
        // Secondary sort: within same status, sort by expiryDate (soonest first)
        var order = { overdue: 0, 'due-soon': 1, ok: 2, none: 3 };
        var aO = order[a.rotationStatus] !== undefined ? order[a.rotationStatus] : 3;
        var bO = order[b.rotationStatus] !== undefined ? order[b.rotationStatus] : 3;
        if (aO < bO) return -1 * modifier;
        if (aO > bO) return 1 * modifier;
        // Same status — secondary sort by expiryDate (ascending, nulls last)
        var aHasExpiry = !!a.expiryDate;
        var bHasExpiry = b.expiryDate != null;
        if (aHasExpiry && !bHasExpiry) return -1;
        if (!aHasExpiry && bHasExpiry) return 1;
        if (!aHasExpiry && !bHasExpiry) {
            var aN2 = (a.name || '').toLowerCase();
            var bN2 = (b.name || '').toLowerCase();
            if (aN2 < bN2) return -1;
            if (aN2 > bN2) return 1;
            return 0;
        }
        var aDate = (a.expiryDate || '').toString();
        var bDate = (b.expiryDate || '').toString();
        if (aDate < bDate) return -1;
        if (aDate > bDate) return 1;
        return 0;
    }
    var aValue = (a[key] || '').toString();
    var bValue = (b[key] || '').toString();
    if (aValue < bValue) return -1 * modifier;
    if (aValue > bValue) return 1 * modifier;
    return 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

function ExpiryDashboard({
    credentials = [],
    onNavigateToTable,
    onOpenAlertConfig,
    onRefresh,
    onRotate,
    onRotateBulk,
    onRotationComplete,
}) {
    const [autoRefresh, setAutoRefreshState] = React.useState(getAutoRefreshEnabled());
    const [autoRefreshInterval, setAutoRefreshIntervalState] = React.useState(getAutoRefreshInterval());
    const [thresholdDays, setThresholdDaysState] = React.useState(API.getDueSoonThreshold());
    const [lastRefresh, setLastRefresh] = React.useState(Date.now());
    const [refreshing, setRefreshing] = React.useState(false);

    // Pagination state
    const [currentPage, setCurrentPage] = React.useState(1);
    const [rowsPerPage, setRowsPerPage] = React.useState(loadRowsPerPage);

    // Sorting state — default to expiryDate desc (soonest first)
    const [sortConfig, setSortConfig] = React.useState({ key: 'expiryDate', direction: 'asc' });

    // Row selection — for bulk rotate of selected credentials
    const [selectedRows, setSelectedRows] = React.useState([]);

    // Credential row key
    function credKey(cred) {
        return (cred.name || '') + '|' + (cred.realm || '') + '|' + (cred.app || 'search');
    }

    // Check if a row is selected
    function isSelected(cred) {
        return selectedRows.some(function(r) { return credKey(r) === credKey(cred); });
    }

    // Toggle row selection

    // Clear row selection after rotation
    function clearSelection() {
        setSelectedRows([]);
    }
    function handleToggleSelect(cred) {
        setSelectedRows(function(prev) {
            var idx = prev.findIndex(function(r) { return credKey(r) === credKey(cred); });
            if (idx >= 0) return prev.filter(function(_, i) { return i !== idx; });
            return prev.concat([cred]);
        });
    }


    // Persist rowsPerPage
    React.useEffect(function() {
        saveRowsPerPage(rowsPerPage);
    }, [rowsPerPage]);

    // Reset page when threshold changes (reclassifies data)
    React.useEffect(function() {
        setCurrentPage(1);
    }, [thresholdDays]);

    // Re-classify credentials using current threshold
    const classifiedCreds = React.useMemo(function() {
        return credentials.map(function(cred) {
            var status = cred.expiryDate
                ? API.getRotationStatus(cred.expiryDate, thresholdDays)
                : 'none';
            return Object.assign({}, cred, {
                rotationStatus: status,
                daysRemaining: cred.expiryDate ? getDaysRemaining(cred.expiryDate) : null,
            });
        });
    }, [credentials, thresholdDays]);

    // Sort credentials by sortConfig
    const sortedCreds = React.useMemo(function() {
        var key = sortConfig.key;
        var direction = sortConfig.direction;
        return [...classifiedCreds].sort(function(a, b) {
            return compareCreds(a, b, key, direction);
        });
    }, [classifiedCreds, sortConfig.key, sortConfig.direction]);

    // Paginate credentials
    const paginatedCreds = React.useMemo(function() {
        var startIndex = (currentPage - 1) * rowsPerPage;
        return sortedCreds.slice(startIndex, startIndex + rowsPerPage);
    }, [sortedCreds, currentPage, rowsPerPage]);
    // Toggle select-all for visible page
    function handlePageSelectAll() {
        if (paginatedCreds.every(function(c) { return isSelected(c); })) {
            setSelectedRows(function(prev) {
                return prev.filter(function(r) {
                    return !paginatedCreds.some(function(c) { return credKey(r) === credKey(c); });
                });
            });
        } else {
            setSelectedRows(function(prev) {
                var newKeys = paginatedCreds.filter(function(c) {
                    return !prev.some(function(r) { return credKey(r) === credKey(c); });
                });
                return prev.concat(newKeys);
            });
        }
    }

    // Determine rowSelection state for header checkbox
    var someSelected = paginatedCreds.some(function(c) { return isSelected(c); });
    var allSelected = paginatedCreds.length > 0 && paginatedCreds.every(function(c) { return isSelected(c); });
    var rowSelectionState = allSelected ? 'all' : (someSelected ? 'some' : 'none');

    const totalPages = Math.ceil(sortedCreds.length / rowsPerPage);

    // Stats
    const stats = React.useMemo(function() {
        var overdue = 0, dueSoon = 0, ok = 0, none = 0;
        classifiedCreds.forEach(function(c) {
            if (c.rotationStatus === 'overdue') overdue++;
            else if (c.rotationStatus === 'due-soon') dueSoon++;
            else if (c.rotationStatus === 'ok') ok++;
            else none++;
        });
        return {
            total: classifiedCreds.length,
            overdue: overdue,
            dueSoon: dueSoon,
            ok: ok,
            none: none,
        };
    }, [classifiedCreds]);

    // Auto-refresh timer — uses interval state directly
    React.useEffect(function() {
        if (!autoRefresh) return;
        var timer = setInterval(function() {
            if (onRefresh) {
                setRefreshing(true);
                onRefresh();
                setLastRefresh(Date.now());
                setTimeout(function() { setRefreshing(false); }, 300);
            }
        }, autoRefreshInterval);
        return function() { clearInterval(timer); };
    }, [autoRefresh, autoRefreshInterval]);

    // Toggle auto-refresh
    function handleToggleAutoRefresh() {
        var next = !autoRefresh;
        setAutoRefreshState(next);
        setAutoRefreshEnabled(next);
    }

    // Auto-refresh interval change — slider (minutes)
    function handleIntervalChange(e) {
        var minutes = parseInt(e.target.value, 10);
        var ms = minutes * 60 * 1000;
        setAutoRefreshInterval(ms); // saves to localStorage
        setAutoRefreshIntervalState(ms); // updates state
    }

    // Format interval for display
    function formatInterval(ms) {
        var minutes = Math.round(ms / 60000);
        return minutes + ' min';
    }

    // Threshold slider change
    function handleThresholdChange(e) {
        var val = parseInt(e.target.value, 10);
        setThresholdDaysState(val);
        API.setDueSoonThreshold(val);
    }

    // Manual refresh — uses CSS animation frame instead of isLoading state
    // (the fetch completes faster than React can render the loading UI)
    function handleRefresh() {
        setRefreshing(true);
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                if (onRefresh) onRefresh();
                setLastRefresh(Date.now());
                // Hide spinner after 300ms regardless of fetch completion
                setTimeout(function() { setRefreshing(false); }, 300);
            });
        });
    }

    // Sort handlers
    function handleSort(key) {
        var direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key: key, direction: direction });
    }

    function getSortIndicator(key) {
        if (sortConfig.key !== key) return React.createElement(ArrowUpDown, { style: { verticalAlign: 'middle', width: '12px', height: '12px' } });
        return sortConfig.direction === 'asc'
            ? React.createElement(ArrowUp, { style: { verticalAlign: 'middle', width: '12px', height: '12px' } })
            : React.createElement(ArrowDown, { style: { verticalAlign: 'middle', width: '12px', height: '12px' } });
    }

    // Dark theme detection
    var isDark = isDarkTheme();

    // Inline theme variables
    var themeCSS = React.createElement('style', null,
        '.expiry-dashboard {',
        '  --ed-bg: ' + (isDark ? '#15191e' : '#fff') + ';',
        '  --ed-text: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --ed-text-muted: ' + (isDark ? '#aaa' : '#666') + ';',
        '  --ed-border: ' + (isDark ? '#444' : '#ccc') + ';',
        '  --ed-card-bg: ' + (isDark ? '#1a1f25' : '#f5f5f5') + ';',
        '  --ed-card-border: ' + (isDark ? '#333' : '#ddd') + ';',
        '  --ed-row-hover: ' + (isDark ? '#2a2a2a' : '#f0f0f0') + ';',
        '  --ed-header-bg: ' + (isDark ? '#0d1117' : '#fafafa') + ';',
        '  --ed-header-color: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --ed-header-border: ' + (isDark ? '#444' : '#ccc') + ';',
        '  --ed-input-bg: ' + (isDark ? '#222' : '#fff') + ';',
        '  --ed-input-border: ' + (isDark ? '#555' : '#ccc') + ';',
        '  --ed-input-color: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '}',
        '@keyframes spin { to { transform: rotate(360deg); } }',
    );

    // ─── Toolbar ──────────────────────────────────────────────────────────
    var toolbar = React.createElement('div', {
        style: {
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '1rem',
            paddingBottom: '0.75rem',
            borderBottom: '1px solid var(--ed-border)',
        }
    },
        // Back button — only render if onNavigateToTable is provided
        onNavigateToTable ? React.createElement(Button, {
            onClick: onNavigateToTable,
            appearance: 'subtle',
            icon: React.createElement(ArrowLeft, null),
            children: 'Credentials Table'
        }) : null,

        // Refresh + timestamp
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' }
        },
            React.createElement(Button, {
                onClick: handleRefresh,
                appearance: 'subtle',
                icon: React.createElement(ArrowClockwise, null),
                children: 'Refresh' + (refreshing ? ' ' + React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        border: '2px solid var(--ed-text-muted)',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 0.6s linear infinite',
                        verticalAlign: 'middle',
                    }
                }) : '')
            }),
            React.createElement('span', {
                style: {
                    fontSize: '11px',
                    color: 'var(--ed-text-muted)',
                    whiteSpace: 'nowrap',
                }
            }, new Date(lastRefresh).toLocaleTimeString())
        ),

        // Auto-refresh toggle + interval slider
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '0.5rem' }
        },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--ed-text-muted)' } }, 'Auto-refresh'),
            React.createElement(Switch, {
                selected: autoRefresh,
                onClick: handleToggleAutoRefresh,
            }),
            autoRefresh && React.createElement('span', {
                style: {
                    fontSize: '10px',
                    color: '#0d8469',
                    display: 'flex',
                    alignItems: 'center',
                }
            },
                React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: '#0d8469',
                        marginRight: '3px',
                    }
                })
            ),
            !autoRefresh ? null : React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', gap: '0.4rem' }
            },
                React.createElement('input', {
                    type: 'range',
                    min: 1,
                    max: 60,
                    value: Math.round(autoRefreshInterval / 60000),
                    onChange: handleIntervalChange,
                    style: { width: '80px', accentColor: '#0d8469' }
                }),
                React.createElement('span', {
                    style: {
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#0d8469',
                        minWidth: '3em',
                    }
                }, formatInterval(autoRefreshInterval))
            )
        ),

        // Threshold slider
        React.createElement('div', {
            style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }
        },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--ed-text-muted)' } }, 'Due-soon within:'),
            React.createElement('input', {
                type: 'range',
                min: 1,
                max: 30,
                value: thresholdDays,
                onChange: handleThresholdChange,
                style: { width: '150px', accentColor: '#f59e0b' }
            }),
            React.createElement('span', {
                style: {
                    fontSize: '13px',
                    fontWeight: '600',
                    color: '#f59e0b',
                    minWidth: '3em',
                }
            }, thresholdDays + 'd')
        ),

        // Rows per page selector
        React.createElement('strong', {
            style: { display: 'flex', alignItems: 'center', height: '28px', fontSize: '13px' }
        }, 'Rows:'),
        React.createElement('select', {
            value: rowsPerPage,
            onChange: function(e) { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); },
            style: {
                padding: '0.25rem 0.5rem',
                border: '1px solid var(--ed-border)',
                borderRadius: '4px',
                fontSize: '13px',
                height: '28px',
                boxSizing: 'border-box',
            }
        },
            React.createElement('option', { value: 10 }, '10'),
            React.createElement('option', { value: 25 }, '25'),
            React.createElement('option', { value: 50 }, '50')
        ),

        // Compact page control in toolbar
        totalPages > 1 ? React.createElement(Paginator.PageControl, {
            current: currentPage,
            totalPages: totalPages,
            onChange: function(event, data) { setCurrentPage(data.page); }
        }) : null,

        // Alert config button — only render if onOpenAlertConfig is provided
        onOpenAlertConfig ? React.createElement(Button, {
            onClick: onOpenAlertConfig,
            appearance: 'subtle',
            icon: React.createElement(Cog, null),
            children: 'Alert Settings'
        }) : null,

        // Rotate Overdue button — only render if onRotateBulk is provided
        onRotateBulk && stats.overdue + stats.dueSoon > 0 ? React.createElement(Button, {
            onClick: function() { onRotateBulk(selectedRows, clearSelection); },
            appearance: 'subtle',
            icon: React.createElement(ArrowClockwise, null),
            children: 'Rotate ' + (selectedRows.length > 0 ? 'Selected (' + selectedRows.length + ')' : 'Overdue/Due-Soon (' + (stats.overdue + stats.dueSoon) + ')')
        }) : null
    );

    // ─── Stats cards ──────────────────────────────────────────────────────
    var statsCards = React.createElement('div', {
        style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: '0.75rem',
            marginBottom: '1rem',
        }
    },
        // Total
        React.createElement('div', { style: buildStatCardStyle(isDark, '#5c6bc0') },
            React.createElement('div', { style: { fontSize: '24px', fontWeight: '700' } }, stats.total),
            React.createElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Total')
        ),
        // Overdue
        React.createElement('div', { style: buildStatCardStyle(isDark, '#d32f2f') },
            React.createElement('div', { style: { fontSize: '24px', fontWeight: '700' } }, stats.overdue),
            React.createElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Overdue')
        ),
        // Due Soon
        React.createElement('div', { style: buildStatCardStyle(isDark, '#f59e0b') },
            React.createElement('div', { style: { fontSize: '24px', fontWeight: '700' } }, stats.dueSoon),
            React.createElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'Due Soon')
        ),
        // OK
        React.createElement('div', { style: buildStatCardStyle(isDark, '#0d8469') },
            React.createElement('div', { style: { fontSize: '24px', fontWeight: '700' } }, stats.ok),
            React.createElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'OK')
        ),
        // None (no expiry)
        React.createElement('div', { style: buildStatCardStyle(isDark, '#9e9e9e') },
            React.createElement('div', { style: { fontSize: '24px', fontWeight: '700' } }, stats.none),
            React.createElement('div', { style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' } }, 'No Expiry')
        )
    );

    // ─── Table ────────────────────────────────────────────────────────────

    // Build header cells with sort indicators
    var headerCells = COLUMNS.map(function(col) {
        if (col.sortable) {
            return React.createElement(TableHeadCell, {
                key: col.key,
                onClick: function() { handleSort(col.key); },
                appearClickable: sortConfig.key === col.key
            }, col.label + ' ', getSortIndicator(col.key));
        }
        return React.createElement(TableHeadCell, { key: col.key }, col.label);
    });

    // Build data rows
    var dataRows;
    if (paginatedCreds.length > 0) {
        dataRows = paginatedCreds.map(function(cred, i) {
            var status = cred.rotationStatus;
            var rowColor = getStatusColor(status);
            var daysRem = cred.daysRemaining;
            var displayRealm = cred.realm || '\u2014';

            // Days remaining display
            var daysDisplay;
            if (daysRem === null) {
                daysDisplay = '\u2014';
            } else if (daysRem < 0) {
                daysDisplay = daysRem + ' days overdue';
            } else if (daysRem === 0) {
                daysDisplay = 'Today';
            } else {
                daysDisplay = daysRem + ' days';
            }

            // Days pill color
            var daysPillColor = daysRem !== null && daysRem < 0 ? '#d32f2f' :
                               daysRem !== null && daysRem <= thresholdDays ? '#f59e0b' :
                               daysRem !== null ? '#0d8469' : '#9e9e9e';

            // Status label
            var statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

return React.createElement(TableRow, {
                key: cred.stanzaKey || (cred.name + ':' + (cred.realm || '') + ':' + i),
                selected: isSelected(cred),
                onRequestToggle: function() { handleToggleSelect(cred); },
                style: {
                    borderLeft: '3px solid ' + rowColor,
                }
            },
                // Username — pill
                React.createElement(TableCell, null,
                    React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: isDark ? '#1a237e' : '#e8eaf6',
                            color: isDark ? '#c5cae9' : '#283593',
                            border: '1px solid ' + (isDark ? '#5c6bc0' : '#9fa8da'),
                            whiteSpace: 'nowrap',
                        }
                    }, cred.name || '\u2014')
                ),
                // Realm — pill
                React.createElement(TableCell, null,
                    React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: isDark ? '#37474f' : '#f5f5f5',
                            color: isDark ? '#b0bec5' : '#757575',
                            border: '1px solid ' + (isDark ? '#546e7a' : '#e0e0e0'),
                            whiteSpace: 'nowrap',
                        }
                    }, displayRealm)
                ),
                // Expiry Date — pill
                React.createElement(TableCell, null,
                    React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: cred.expiryDate ? (isDark ? rowColor + '22' : rowColor + '15') : (isDark ? '#9e9e9e22' : '#9e9e9e22'),
                            color: cred.expiryDate ? rowColor : '#9e9e9e',
                            border: '1px solid ' + (cred.expiryDate ? rowColor + '40' : (isDark ? '#9e9e9e88' : '#9e9e9e55')),
                            whiteSpace: 'nowrap',
                        }
                    }, cred.expiryDate ? formatDateShort(cred.expiryDate) : '\u2014')
                ),
                // Days Remaining — pill
                React.createElement(TableCell, null,
                    React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: daysRem !== null && daysRem <= thresholdDays ? '700' : '600',
                            backgroundColor: isDark ? daysPillColor + '22' : daysPillColor + '15',
                            color: daysPillColor,
                            border: '1px solid ' + daysPillColor + '40',
                            whiteSpace: 'nowrap',
                        }
                    }, daysDisplay)
                ),
                // Status badge
                React.createElement(TableCell, null,
                    React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: rowColor + (isDark ? '33' : '22'),
                            color: rowColor,
                            border: '1px solid ' + rowColor + '40',
                            whiteSpace: 'nowrap',
                        }
                    }, statusLabel)
                ),
                // Actions — Rotate button for overdue and due-soon credentials
                React.createElement(TableCell, null,
                    onRotate && (status === 'overdue' || status === 'due-soon')
                        ? React.createElement(Button, {
                            onClick: function() { onRotate(cred); },
                            appearance: status === 'overdue' ? 'destructive' : 'subtle',
                            icon: React.createElement(ArrowClockwise, null),
                            children: 'Rotate'
                        })
                        : React.createElement('span', { style: { visibility: 'hidden' } }, '-')
                )
            );
        });
    } else {
        dataRows = [React.createElement(TableRow, { key: 'empty' },
            React.createElement(TableCell, { colSpan: COLUMNS.length }, 'No credentials found')
        )];
    }

    // ─── Render ───────────────────────────────────────────────────────────
    return React.createElement('div', { className: 'expiry-dashboard' },
        themeCSS,
        toolbar,
        statsCards,

        // Splunk Table
        React.createElement(Table, {
            outerStyle: { width: '100%', marginBottom: '1rem' },
            tableStyle: { width: '100%' },
            rowSelection: rowSelectionState,
            onRequestToggleAllRows: handlePageSelectAll
        },
            React.createElement(TableHead, null, ...headerCells),
            React.createElement(TableBody, { key: currentPage }, ...dataRows)
        ),

        // Row count + Pagination
        React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--ed-text-muted)' } },
                sortedCreds.length === 0
                    ? 'No credentials'
                    : 'Showing ' + ((currentPage - 1) * rowsPerPage + 1) + '-' + Math.min(currentPage * rowsPerPage, sortedCreds.length) + ' of ' + sortedCreds.length + ' credential' + (sortedCreds.length !== 1 ? 's' : '')
            ),
            totalPages > 1 ? React.createElement(Paginator, {
                current: currentPage,
                totalPages: totalPages,
                numPageLinks: totalPages,
                onChange: function(event, data) { setCurrentPage(data.page); }
            }) : null
        )
    );
}

// ─── Stat card style builder ──────────────────────────────────────────────
function buildStatCardStyle(isDark, accentColor) {
    return {
        padding: '1rem',
        borderRadius: '6px',
        backgroundColor: isDark ? accentColor + '15' : accentColor + '12',
        border: '1px solid ' + accentColor + '40',
        textAlign: 'center',
    };
}

module.exports = ExpiryDashboard;
