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
    { key: 'info', label: 'Details' },
];

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
};

function getActionLabel(action) {
    return ACTION_LABELS[action] || (action || 'Unknown');
}

function AuditLog({ mvc }) {
    var [timeRange, setTimeRange] = React.useState(3600000);
    var [auditData, setAuditData] = React.useState([]);
    var [rawData, setRawData] = React.useState([]);
    var [selectedUsers, setSelectedUsers] = React.useState([]);
    var [loading, setLoading] = React.useState(false);
    var [error, setError] = React.useState(null);
    var [currentPage, setCurrentPage] = React.useState(1);
    var [rowsPerPage, setRowsPerPage] = React.useState(10);
    var [currentPage, setCurrentPage] = React.useState(1);
    var [rowsPerPage, setRowsPerPage] = React.useState(10);

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

    // Filter data by selected users
    React.useEffect(function() {
        if (selectedUsers.length === 0) {
            setAuditData([]);
        } else {
            var userSet = {};
            selectedUsers.forEach(function(u) { userSet[u] = true; });
            setAuditData(rawData.filter(function(entry) { return userSet[entry.user]; }));
        }
    }, [rawData, selectedUsers.join(',')]);

    // Paginate audit data
    var paginatedAuditData = React.useMemo(function() {
        var startIndex = (currentPage - 1) * rowsPerPage;
        return auditData.slice(startIndex, startIndex + rowsPerPage);
    }, [auditData, currentPage, rowsPerPage]);

    var totalPages = Math.ceil(auditData.length / rowsPerPage);

    // Paginate audit data
    var paginatedAuditData = React.useMemo(function() {
        var startIndex = (currentPage - 1) * rowsPerPage;
        return auditData.slice(startIndex, startIndex + rowsPerPage);
    }, [auditData, currentPage, rowsPerPage]);

    var totalPages = Math.ceil(auditData.length / rowsPerPage);

    var handleTimeRangeChange = function(e, data) {
        var val = data && data.value != null ? data.value : timeRange;
        setTimeRange(val);
    };

    var handleRefresh = function() {
        fetchData();
    };

    var handleUserFilterChange = function(e, data) {
        var vals = data && Array.isArray(data.values) ? data.values : [];
        setSelectedUsers(vals);
    };

    var headerCells = AUDIT_COLUMNS.map(function(col) {
        return React.createElement(TableHeadCell, { key: col.key }, col.label);
    });

    // Loading state
    if (loading) {
        return React.createElement('div', { className: 'audit-log-app' },
            React.createElement('h1', { style: { margin: '0 0 1rem 0' } }, 'Audit Log'),
            React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: '#666' } }, 'Loading audit log...')
        );
    }

    // Error state
    if (error) {
        return React.createElement('div', { className: 'audit-log-app' },
            React.createElement('h1', { style: { margin: '0 0 1rem 0' } }, 'Audit Log'),
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
                    if (col.key === 'action') {
                        value = getActionLabel(value);
                    }
                    return React.createElement(TableCell, { key: col.key }, value);
                })
            );
        });
    }

    var labelStyle = { display: 'flex', alignItems: 'center', height: '28px', fontSize: '13px' };

    return React.createElement('div', { className: 'audit-log-app' },
        // Header with controls
        React.createElement('div', {
            style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '0.5rem',
            }
        },
            React.createElement('h1', { style: { margin: 0 } }, 'Audit Log'),
            React.createElement('div', {
                style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }
            },
                React.createElement('label', {
                    style: { fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center' }
                }, 'Time Range: '),
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
                React.createElement('label', {
                    style: { fontSize: '13px', fontWeight: '500', display: 'flex', alignItems: 'center' }
                }, 'Users: '),
                React.createElement(MultiSelector, {
                    values: selectedUsers,
                    onChange: handleUserFilterChange,
                    placeholder: 'Select users',
                    style: { minWidth: '200px' },
                }, uniqueUsers.map(function(u) {
                    return React.createElement(MultiSelectOption, {
                        key: u,
                        label: u,
                        value: u,
                    });
                })),
                React.createElement(Button, {
                    onClick: handleRefresh,
                    appearance: 'subtle',
                    children: 'Refresh',
                }),
                React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'baseline' } },
                    React.createElement('strong', { style: labelStyle }, 'Rows per page:'),
                    React.createElement('select', {
                        value: rowsPerPage,
                        onChange: function(e) { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); },
                        style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', height: '28px', boxSizing: 'border-box' },
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
