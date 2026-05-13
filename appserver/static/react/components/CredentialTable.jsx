/**
 * CredentialTable.jsx - Table component for displaying credentials
 *
 * Displays credentials in a table with pagination, filtering, sorting, selection,
 * and inline row expansion for editing.
 * Uses @splunk/react-ui Table, Paginator, Chip, and CredentialForm components.
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
var ChipMod = require('@splunk/react-ui/Chip');
var Chip = ChipMod.default;
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
var Eye = require('@splunk/react-icons/Eye').default;
var TrashCanCross = require('@splunk/react-icons/TrashCanCross').default;

var CredentialForm = require('./CredentialForm');


/**
 * CredentialTable - Table component for credential management
 *
 * @param {Object} props - Component props
 * @param {Array} props.credentials - Array of credential objects
 * @param {Array} props.selectedRows - Currently selected rows for bulk operations
 * @param {boolean} props.isAllSelected - Whether all rows are selected
 * @param {Function} props.onDelete - Callback when delete is clicked
 * @param {Function} props.onReveal - Callback when reveal password is clicked
 * @param {Function} props.onSelectRow - Callback when row checkbox toggled
 * @param {Function} props.onSelectAll - Callback when select-all checked
 * @param {Function} props.onDeselectAll - Callback when select-all unchecked
 * @param {Function} props.onUpdate - Callback when inline form saves (credential updated)
 * @param {Array} props.availableApps - Apps for form dropdown
 * @param {Array} props.availableUsers - Users for owner dropdown
 * @param {string} props.currentUserIdentity - Current user identity
 * @param {Array} props.availableRoles - Roles for ACL dropdowns
 * @param {string} props.defaultReadRoles - Default read roles CSV
 * @param {string} props.defaultWriteRoles - Default write roles CSV
 */
function CredentialTable({
    credentials = [],
    selectedRows = [],
    isAllSelected = false,
    onDelete,
    onReveal,
    onSelectRow,
    onSelectAll,
    onDeselectAll,
    onUpdate,
    availableApps = [],
    availableUsers = [],
    currentUserIdentity = 'nobody',
    availableRoles = [],
    defaultReadRoles = '',
    defaultWriteRoles = '',
}) {
    const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });
    const [currentPage, setCurrentPage] = React.useState(1);
    const [rowsPerPage, setRowsPerPage] = React.useState(10);
    const [filterText, setFilterText] = React.useState('');
    const [filterType, setFilterType] = React.useState('all');
    const [expandedRowKey, setExpandedRowKey] = React.useState(null);

    // Filter credentials
    const filteredCredentials = React.useMemo(function() {
        if (!filterText) return credentials;

        return credentials.filter(function(credential) {
            var name = credential.name || '';
            var realm = credential.realm || '';
            var app = credential.app || '';
            var owner = credential.owner || '';

            if (filterType === 'all') {
                return (
                    name.toLowerCase().includes(filterText.toLowerCase()) ||
                    realm.toLowerCase().includes(filterText.toLowerCase()) ||
                    app.toLowerCase().includes(filterText.toLowerCase()) ||
                    owner.toLowerCase().includes(filterText.toLowerCase())
                );
            } else if (filterType === 'username') {
                return name.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'realm') {
                return realm.toLowerCase().includes(filterText.toLowerCase());
            } else if (filterType === 'app') {
                return app.toLowerCase().includes(filterText.toLowerCase());
            }
            return true;
        });
    }, [credentials, filterText, filterType]);

    // Sort credentials
    const sortedCredentials = React.useMemo(function() {
        if (!sortConfig.key) return filteredCredentials;

        return [...filteredCredentials].sort(function(a, b) {
            var aValue = a[sortConfig.key] || '';
            var bValue = b[sortConfig.key] || '';

            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredCredentials, sortConfig.key, sortConfig.direction]);

    // Paginate credentials
    const paginatedCredentials = React.useMemo(function() {
        var startIndex = (currentPage - 1) * rowsPerPage;
        return sortedCredentials.slice(startIndex, startIndex + rowsPerPage);
    }, [sortedCredentials, currentPage, rowsPerPage]);

    const totalPages = Math.ceil(sortedCredentials.length / rowsPerPage);

    // Handle sort
    function handleSort(key) {
        var direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key: key, direction: direction });
    }

    // Handle filter change
    function handleFilterChange(value) {
        setFilterText(value);
        setCurrentPage(1); // Reset to first page on filter
    }

    // Get sort indicator
    function getSortIndicator(key) {
        if (sortConfig.key !== key) return '↕';
        return sortConfig.direction === 'asc' ? '↑' : '↓';
    }

    // Check if a row is selected
    function isSelected(cred) {
        return selectedRows.some(function(r) { return r.stanzaKey === cred.stanzaKey; });
    }

    // Toggle row selection
    function handleToggleSelect(cred) {
        onSelectRow && onSelectRow(cred);
    }

    // Toggle select-all for visible page
    function handlePageSelectAll() {
        if (isAllSelected || paginatedCredentials.every(function(c) { return isSelected(c); })) {
            onDeselectAll && onDeselectAll();
        } else {
            onSelectAll && onSelectAll(sortedCredentials);
        }
    }

    // Handle row expansion toggle
    function handleExpansion(cred) {
        setExpandedRowKey(expandedRowKey === cred.stanzaKey ? null : cred.stanzaKey);
    }

    // Handle inline form save
    function handleInlineSave(cred, formData) {
        setExpandedRowKey(null);
        onUpdate && onUpdate(cred, formData);
    }

    // Build expansion row with inline CredentialForm
    function buildExpansionRow(cred) {
        return React.createElement(TableRow, { key: cred.stanzaKey + '-expansion' },
            React.createElement(TableCell, { colSpan: 5 },
                React.createElement('div', { style: { padding: '1rem' } },
                    React.createElement(CredentialForm, {
                        credential: cred,
                        onSave: function(formData) { handleInlineSave(cred, formData); },
                        onCancel: function() { setExpandedRowKey(null); },
                        availableApps: availableApps,
                        availableUsers: availableUsers,
                        currentUserIdentity: currentUserIdentity,
                        availableRoles: availableRoles,
                        defaultReadRoles: defaultReadRoles,
                        defaultWriteRoles: defaultWriteRoles,
                    })
                )
            )
        );
    }

    // Create action cell factory — icon buttons for Reveal, Delete
    function createActionCell(cred) {
        return React.createElement(TableCell, null,
            React.createElement(
                'div',
                { style: { display: 'flex', gap: '0.25rem' } },
                React.createElement(Button, { onClick: function() { onReveal && onReveal(cred); }, appearance: 'subtle', icon: React.createElement(Eye, { variant: 'filled' }) }),
                React.createElement(Button, { onClick: function() { onDelete && onDelete(cred); }, appearance: 'subtle', icon: React.createElement(TrashCanCross, { variant: 'filled' }) })
            )
        );
    }

    // Determine rowSelection state for header checkbox: 'all', 'some', or 'none'
    var someSelected = paginatedCredentials.some(function(c) { return isSelected(c); });
    var allSelected = paginatedCredentials.length > 0 && paginatedCredentials.every(function(c) { return isSelected(c); });
    var rowSelectionState = allSelected ? 'all' : (someSelected ? 'some' : 'none');

    // Build header cells — no checkbox cell needed; TableHead renders it via rowSelection
    var headerCells = [
        React.createElement(TableHeadCell, { key: 'username', onClick: function() { handleSort('name'); }, appearClickable: true }, 'Username ', getSortIndicator('name')),
        React.createElement(TableHeadCell, { key: 'realm', onClick: function() { handleSort('realm'); }, appearClickable: true }, 'Realm ', getSortIndicator('realm')),
        React.createElement(TableHeadCell, { key: 'app', onClick: function() { handleSort('app'); }, appearClickable: true }, 'App ', getSortIndicator('app')),
        React.createElement(TableHeadCell, { key: 'owner', onClick: function() { handleSort('owner'); }, appearClickable: true }, 'Owner ', getSortIndicator('owner')),
        React.createElement(TableHeadCell, { key: 'actions' }, 'Actions')
    ];

    // Build data rows — TableRow with expansion, selection, and actions
    var dataRows = paginatedCredentials.length > 0
        ? paginatedCredentials.map(function(cred) {
            var isExpanded = expandedRowKey === cred.stanzaKey;
            return React.createElement(TableRow, {
                key: cred.stanzaKey,
                selected: isSelected(cred),
                onRequestToggle: function() { handleToggleSelect(cred); },
                expandable: true,
                expanded: isExpanded,
                onExpansion: function() { handleExpansion(cred); },
                expansionRow: isExpanded ? buildExpansionRow(cred) : undefined,
            },
                React.createElement(TableCell, null, cred.name || cred.realm),
                React.createElement(TableCell, null,
                    React.createElement(Chip, { backgroundColor: (!cred.realm || cred.realm === 'nobody') ? '#e0e0e0' : '#e3f2fd', foregroundColor: (!cred.realm || cred.realm === 'nobody') ? 'inherit' : '#1565c0' },
                        (!cred.realm || cred.realm === 'nobody') ? 'global' : (cred.realm || ''))
                ),
                React.createElement(TableCell, null,
                    React.createElement(Chip, { backgroundColor: '#e8f5e9', foregroundColor: '#2e7d32' }, cred.app || 'search')
                ),
                React.createElement(TableCell, null, cred.owner || 'nobody'),
                createActionCell(cred)
            );
        })
        : [React.createElement(TableRow, { key: 'empty' },
            React.createElement(TableCell, { colSpan: 6, style: { textAlign: 'center', padding: '2rem', color: '#666' } }, 'No credentials found')
        )];

    return React.createElement(
        'div',
        { className: 'credential-table-container' },
        // Filter bar + pagination controls
        React.createElement(
            'div',
            { style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement('strong', null, 'Search:'),
            React.createElement('input', {
                type: 'text',
                value: filterText,
                onChange: function(e) { handleFilterChange(e.target.value); },
                placeholder: 'Search credentials...',
                style: {
                    padding: '0.25rem 0.5rem',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    minWidth: '200px',
                },
            }),
            React.createElement('select', {
                value: filterType,
                onChange: function(e) { setFilterType(e.target.value); },
                style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px' },
            },
                React.createElement('option', { value: 'all' }, 'All Fields'),
                React.createElement('option', { value: 'username' }, 'Username'),
                React.createElement('option', { value: 'realm' }, 'Realm'),
                React.createElement('option', { value: 'app' }, 'App')
            ),
            React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' } },
                React.createElement('strong', null, 'Rows per page:'),
                React.createElement('select', {
                    value: rowsPerPage,
                    onChange: function(e) { setRowsPerPage(Number(e.target.value)); setCurrentPage(1); },
                    style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px' },
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

        // Credentials table — rowSelection + rowExpansion + onRequestToggleAllRows on Table
        React.createElement(Table, {
            outerStyle: { width: '100%', marginBottom: '1rem' },
            tableStyle: { width: '100%' },
            rowSelection: rowSelectionState,
            onRequestToggleAllRows: handlePageSelectAll,
            rowExpansion: 'controlled',
        },
            React.createElement(TableHead, null, ...headerCells),
            React.createElement(TableBody, null, ...dataRows)
        ),

        // Pagination
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

// Export component
module.exports = CredentialTable;
