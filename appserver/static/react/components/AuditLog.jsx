/**
 * AuditLog.jsx - Audit log viewer for REST activity against storage/passwords
 *
 * Uses SplunkJS MVC SearchManager to query the _audit index.
 * Displays results in a table with time range filtering, human-readable
 * action labels, and loading/error/empty states.
 */

const React = require('react');

// Splunk design system imports
var TableMod = require('@splunk/react-ui/Table');
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;
var Table = TableMod.default;

var PaginatorMod = require('@splunk/react-ui/Paginator');
var Paginator = PaginatorMod.default;

var SelectMod = require('@splunk/react-ui/Select');
var Selector = SelectMod.default;
var SelectOption = SelectMod.Option;

var MultiSelectMod = require('@splunk/react-ui/Multiselect');
var MultiSelector = MultiSelectMod.default;
var MultiSelectOption = MultiSelectMod.Option;

var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

var API = require('../api');

// Canonical column definitions — single source of truth for order
var AUDIT_COLUMNS = [
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'user', label: 'User' },
    { key: 'action', label: 'Action' },
    { key: 'credential', label: 'Credential' },
    { key: 'status', label: 'Status' },
    { key: 'info', label: 'Details' },
];

// Chip style helper
function chipStyle(bg, color, border) {
    return {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: '600',
        backgroundColor: bg,
        color: color,
        border: '1px solid ' + border,
        whiteSpace: 'nowrap',
    };
}

// Status chip colors — light theme defaults
var STATUS_COLORS_LIGHT = {
    'Success': { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
    'Duplicate': { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
    'Conflict': { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
    'Not Found': { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
    'Forbidden': { bg: '#fce4ec', color: '#c62828', border: '#f48fb1' },
    'Client Error': { bg: '#fce4ec', color: '#c62828', border: '#f48fb1' },
    'Server Error': { bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' },
    'Unknown': { bg: '#f5f5f5', color: '#757575', border: '#e0e0e0' },
};

var STATUS_COLORS_DARK = {
    'Success': { bg: '#1b5e20', color: '#a5d6a7', border: '#66bb6a' },
    'Duplicate': { bg: '#4e342e', color: '#ffcc80', border: '#ffa726' },
    'Conflict': { bg: '#4e342e', color: '#ffcc80', border: '#ffa726' },
    'Not Found': { bg: '#0d47a1', color: '#90caf9', border: '#42a5f5' },
    'Forbidden': { bg: '#b71c1c', color: '#f48fb1', border: '#e57373' },
    'Client Error': { bg: '#b71c1c', color: '#f48fb1', border: '#e57373' },
    'Server Error': { bg: '#4a148c', color: '#ce93d8', border: '#ab47bc' },
    'Unknown': { bg: '#363636', color: '#999', border: '#555' },
};

function getStatusChipStyle(status, isDark) {
    var colors = isDark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
    var c = colors[status] || colors['Unknown'];
    return chipStyle(c.bg, c.color, c.border);
}

// Column chip colors for audit log — light theme defaults
var COLUMN_CHIP_COLORS_LIGHT = {
    timestamp: { bg: '#f5f5f5', color: '#757575', border: '#e0e0e0' },
    user: { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
    action: { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
    credential: { bg: '#e8eaf6', color: '#283593', border: '#9fa8da' },
    info: { bg: '#f5f5f5', color: '#757575', border: '#e0e0e0' },
};

var COLUMN_CHIP_COLORS_DARK = {
    timestamp: { bg: '#363636', color: '#999', border: '#555' },
    user: { bg: '#4e342e', color: '#ffcc80', border: '#ffa726' },
    action: { bg: '#0d47a1', color: '#90caf9', border: '#42a5f5' },
    credential: { bg: '#1a237e', color: '#9fa8da', border: '#5c6bc0' },
    info: { bg: '#363636', color: '#999', border: '#555' },
};

// Time range options — maps label to milliseconds
var TIME_RANGES = [
    { label: 'Last hour', value: 3600000 },
    { label: '6 hours', value: 21600000 },
    { label: '24 hours', value: 86400000 },
    { label: '7 days', value: 604800000 },
];

// Map Splunk password action codes to human-readable labels
var ACTION_LABELS = {
    CREATE_PASSWORD: 'Created',
    EDIT_PASSWORD: 'Updated',
    GET_PASSWORD: 'Viewed',
    REMOVE_PASSWORD: 'Deleted',
    ACL_EDIT: 'ACL Changed',
};

function getActionLabel(action) {
    return ACTION_LABELS[action] || (action || 'Unknown');
}

// Strip leading/trailing colons from credential IDs (e.g., ":svc-archive:" → "svc-archive")
function formatCredential(cred) {
    if (!cred) return '';
    return cred.replace(/^:+|:+$/g, '');
}

function formatTimestamp(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    return mm + '/' + dd + '/' + d.getFullYear() + ' ' + hh + ':' + mi + ':' + ss;
}

function AuditLog({ mvc }) {
    var [timeRange, setTimeRange] = React.useState(3600000);
    var [auditData, setAuditData] = React.useState([]);
    var [rawData, setRawData] = React.useState([]);
    var [selectedUsers, setSelectedUsers] = React.useState([]);
    var [loading, setLoading] = React.useState(false);
    var [error, setError] = React.useState(null);
    var [filterText, setFilterText] = React.useState('');
    var [filterType, setFilterType] = React.useState('all');
    var [currentPage, setCurrentPage] = React.useState(1);
    var [rowsPerPage, setRowsPerPage] = React.useState(10);
    var [isDark, setIsDark] = React.useState(false);

    // Detect dark theme — same approach as CredentialTable
    React.useEffect(function() {
        var check = function() {
            return document.documentElement.classList.contains('dark-theme') ||
                document.documentElement.classList.contains('theme-dark') ||
                document.documentElement.getAttribute('data-theme') === 'dark' ||
                document.body.classList.contains('dark-theme');
        };
        setIsDark(check());
        var observer = new MutationObserver(function() { setIsDark(check()); });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return function() { observer.disconnect(); };
    }, []);

    var fetchData = React.useCallback(function() {
        setLoading(true);
        setError(null);

        API.fetchAuditLog(timeRange)
            .then(function(results) {
                setRawData(results);
                setError(null);
            })
            .catch(function(err) {
                console.error('Audit log fetch error:', err);
                setError(err.message || 'Failed to fetch audit log');
                setRawData([]);
            })
            .finally(function() {
                setLoading(false);
            });
    }, [timeRange]);

    // Load on mount
    React.useEffect(function() {
        fetchData();
    }, [fetchData]);

    // Derive unique users from raw data, pre-select all on new data load
    var uniqueUsers = React.useMemo(function() {
        var seen = {};
        var users = [];
        rawData.forEach(function(entry) {
            if (entry.user && !seen[entry.user]) {
                seen[entry.user] = true;
                users.push(entry.user);
            }
        });
        return users.sort();
    }, [rawData]);

    // Auto-select all users when raw data changes
    React.useEffect(function() {
        setSelectedUsers(uniqueUsers.slice());
    }, [uniqueUsers.join(',')]);

    // Filter data by selected users, then by text search
    React.useEffect(function() {
        var userFiltered;
        if (selectedUsers.length === 0) {
            userFiltered = [];
        } else {
            var userSet = {};
            selectedUsers.forEach(function(u) { userSet[u] = true; });
            userFiltered = rawData.filter(function(entry) { return userSet[entry.user]; });
        }

        if (!filterText) {
            setAuditData(userFiltered);
            return;
        }

        var search = filterText.toLowerCase();
        setAuditData(userFiltered.filter(function(entry) {
            var timestamp = (entry.timestamp || '').toLowerCase();
            var user = (entry.user || '').toLowerCase();
            var action = (entry.action || '').toLowerCase();
            var credential = (entry.credential || '').toLowerCase();
            var status = (entry.status || '').toLowerCase();
            var info = (entry.info || '').toLowerCase();

            if (filterType === 'all') {
                return timestamp.includes(search) || user.includes(search) || action.includes(search) || credential.includes(search) || status.includes(search) || info.includes(search);
            } else if (filterType === 'timestamp') {
                return timestamp.includes(search);
            } else if (filterType === 'user') {
                return user.includes(search);
            } else if (filterType === 'action') {
                return action.includes(search);
            } else if (filterType === 'credential') {
                return credential.includes(search);
            } else if (filterType === 'status') {
                return status.includes(search);
            } else if (filterType === 'details') {
                return info.includes(search);
            }
            return true;
        }));
    }, [rawData, selectedUsers.join(','), filterText, filterType]);

    // Paginate audit data
    var paginatedAuditData = React.useMemo(function() {
        var startIndex = (currentPage - 1) * rowsPerPage;
        return auditData.slice(startIndex, startIndex + rowsPerPage);
    }, [auditData, currentPage, rowsPerPage]);

    var totalPages = Math.ceil(auditData.length / rowsPerPage);

    var handleTimeRangeChange = function(e, data) {
        var val = data && data.value != null ? data.value : timeRange;
        setTimeRange(val);
        setCurrentPage(1);
    };

    var handleRefresh = function() {
        fetchData();
    };

    var handleUserFilterChange = function(e, data) {
        var vals = data && Array.isArray(data.values) ? data.values : [];
        setSelectedUsers(vals);
        setCurrentPage(1);
    };

    var headerCells = AUDIT_COLUMNS.map(function(col) {
        return React.createElement(TableHeadCell, { key: col.key }, col.label);
    });

    // Loading state
    if (loading) {
        return React.createElement('div', { className: 'audit-log-app' },
            React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: '#666' } }, 'Loading audit log...')
        );
    }

    // Error state
    if (error) {
        return React.createElement('div', { className: 'audit-log-app' },
            React.createElement('div', {
                style: {
                    padding: '1rem',
                    border: '1px solid #d32f2f',
                    borderRadius: '4px',
                    backgroundColor: '#ffebee',
                    color: '#d32f2f',
                }
            }, error),
            React.createElement('div', { style: { marginTop: '1rem' } },
                React.createElement(Button, { onClick: handleRefresh, children: 'Retry' })
            )
        );
    }

    // Data rows
    var dataRows;
    if (auditData.length === 0) {
        dataRows = [React.createElement(TableRow, { key: 'empty' },
            React.createElement(TableCell, {
                colSpan: AUDIT_COLUMNS.length,
                style: { textAlign: 'center', padding: '2rem', color: '#666' }
            }, 'No audit activity found in selected time range')
        )];
    } else {
        dataRows = paginatedAuditData.map(function(entry, i) {
            return React.createElement(TableRow, { key: i },
                AUDIT_COLUMNS.map(function(col) {
                    var value = entry[col.key] || '';
                    if (col.key === 'timestamp') {
                        value = formatTimestamp(value);
                    } else if (col.key === 'action') {
                        value = getActionLabel(value);
                    } else if (col.key === 'credential') {
                        value = formatCredential(value);
                    } else if (col.key === 'status') {
                        return React.createElement(TableCell, { key: col.key },
                            React.createElement('span', {
                                style: getStatusChipStyle(value || 'Unknown', isDark),
                            }, value || 'Unknown')
                        );
                    }

                    var cc = (isDark ? COLUMN_CHIP_COLORS_DARK : COLUMN_CHIP_COLORS_LIGHT)[col.key];
                    if (cc) {
                        return React.createElement(TableCell, { key: col.key },
                            React.createElement('span', {
                                style: chipStyle(cc.bg, cc.color, cc.border),
                            }, value)
                        );
                    }
                    return React.createElement(TableCell, { key: col.key }, value);
                })
            );
        });
    }

    var labelStyle = { display: 'flex', alignItems: 'center', height: '28px', fontSize: '13px', fontWeight: '500' };
    var inputStyle = { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', height: '28px', boxSizing: 'border-box' };

    return React.createElement('div', { className: 'audit-log-app' },
        // Filter bar — search left, pagination right (matches CredentialTable layout)
        React.createElement('div', {
            style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }
        },
            // Left: time range, users, search
            React.createElement('strong', { style: labelStyle }, 'Time Range:'),
            React.createElement(Selector, {
                value: timeRange,
                onChange: handleTimeRangeChange,
                style: { minWidth: '140px' },
            }, TIME_RANGES.map(function(tr) {
                return React.createElement(SelectOption, {
                    key: tr.value,
                    label: tr.label,
                    value: tr.value,
                });
            })),
            React.createElement('strong', { style: labelStyle }, 'Users:'),
            React.createElement('div', { style: { width: '250px' } },
                React.createElement(MultiSelector, {
                    values: selectedUsers,
                    onChange: handleUserFilterChange,
                    placeholder: 'Select users',
                    width: '100%',
                }, uniqueUsers.map(function(u) {
                    return React.createElement(MultiSelectOption, {
                        key: u,
                        label: u,
                        value: u,
                    });
                }))
            ),
            React.createElement('strong', { style: labelStyle }, 'Search:'),
            React.createElement('input', {
                type: 'text',
                value: filterText,
                onChange: function(e) { setFilterText(e.target.value); setCurrentPage(1); },
                placeholder: 'Search audit log...',
                style: Object.assign({}, inputStyle, { minWidth: '200px' }),
            }),
            React.createElement('select', {
                value: filterType,
                onChange: function(e) { setFilterType(e.target.value); },
                style: inputStyle,
            },
                React.createElement('option', { value: 'all' }, 'All Fields'),
                React.createElement('option', { value: 'timestamp' }, 'Timestamp'),
                React.createElement('option', { value: 'user' }, 'User'),
                React.createElement('option', { value: 'action' }, 'Action'),
                React.createElement('option', { value: 'credential' }, 'Credential'),
                React.createElement('option', { value: 'status' }, 'Status'),
                React.createElement('option', { value: 'details' }, 'Details')
            ),
            // Right: refresh, rows per page, paginator
            React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'baseline' } },
                React.createElement(Button, {
                    onClick: handleRefresh,
                    appearance: 'subtle',
                    children: 'Refresh',
                }),
                React.createElement('strong', { style: labelStyle }, 'Rows per page:'),
                React.createElement('select', {
                    value: rowsPerPage,
                    onChange: function(e) { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); },
                    style: inputStyle,
                },
                    React.createElement('option', { value: 10 }, '10'),
                    React.createElement('option', { value: 25 }, '25'),
                    React.createElement('option', { value: 50 }, '50'),
                    React.createElement('option', { value: 100 }, '100')
                ),
                totalPages > 1 ? React.createElement(Paginator.PageControl, {
                    current: currentPage,
                    totalPages: totalPages,
                    onChange: function(event, data) { setCurrentPage(data.page); },
                }) : null
            )
        ),

        // Results table
        React.createElement(Table, {
            outerStyle: { width: '100%', marginBottom: '1rem' },
            tableStyle: { width: '100%' },
            stripeRows: true,
        },
            React.createElement(TableHead, null, ...headerCells),
            React.createElement(TableBody, null, ...dataRows)
        ),

        // Bottom pagination
        totalPages > 1 ? React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' } },
            React.createElement(Paginator, {
                current: currentPage,
                totalPages: totalPages,
                numPageLinks: totalPages,
                onChange: function(event, data) { setCurrentPage(data.page); },
            })
        ) : null
    );
}

module.exports = AuditLog;
