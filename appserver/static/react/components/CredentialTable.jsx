/**
 * CredentialTable.jsx - Table component for displaying credentials
 *
 * Displays credentials in a table with pagination, filtering, sorting, and selection
 * Uses @splunk/react-ui Table, Paginator, and Chip components.
 */

const React = require('react');

// Splunk design system imports
var TableMod = require('@splunk/react-ui/Table');
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;

var PaginatorMod = require('@splunk/react-ui/Paginator');
var Paginator = PaginatorMod.default;
var ChipMod = require('@splunk/react-ui/Chip');
var Chip = ChipMod.default;
var ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

/**
 * CredentialTable - Table component for credential management
 *
 * @param {Object} props - Component props
 * @param {Array} props.credentials - Array of credential objects
 * @param {Array} props.selectedRows - Currently selected rows for bulk operations
 * @param {boolean} props.isAllSelected - Whether all rows are selected
 * @param {Function} props.onEdit - Callback when edit is clicked
 * @param {Function} props.onDelete - Callback when delete is clicked
 * @param {Function} props.onReveal - Callback when reveal password is clicked
 * @param {Function} props.onSelectRow - Callback when row checkbox toggled
 * @param {Function} props.onSelectAll - Callback when select-all checked
 * @param {Function} props.onDeselectAll - Callback when select-all unchecked
 */
function CredentialTable({
    credentials = [],
    selectedRows = [],
    isAllSelected = false,
    onEdit,
    onDelete,
    onReveal,
    onSelectRow,
    onSelectAll,
    onDeselectAll,
}) {
    const [sortConfig, setSortConfig] = React.useState({ key: null, direction: 'asc' });
    const [currentPage, setCurrentPage] = React.useState(1);
    const [filterText, setFilterText] = React.useState('');
    const [filterType, setFilterType] = React.useState('all');

    const itemsPerPage = 10;

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
        var startIndex = (currentPage - 1) * itemsPerPage;
        return sortedCredentials.slice(startIndex, startIndex + itemsPerPage);
    }, [sortedCredentials, currentPage]);

    const totalPages = Math.ceil(sortedCredentials.length / itemsPerPage);

    // Handle sort
    function handleSort(key) {
        var direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key: key, direction: direction });
    }

    // Handle page change — Splunk Paginator passes { index: zero-basedPage }
    function handlePageChange(data) {
        setCurrentPage((data.index || 0) + 1);
    }

    // Handle filter change
    function handleFilterChange(value) {
        setFilterText(value);
        setCurrentPage(1); // Reset to first page on filter
    }

    // Get sort indicator
    function getSortIndicator(key) {
        if (sortConfig.key !== key) return '\u2195';
        return sortConfig.direction === 'asc' ? '\u2191' : '\u2193';
    }

    // Check if a row is selected
    function isSelected(cred) {
        return selectedRows.some(function(r) { return r.stanzaKey === cred.stanzaKey; });
    }

    // Toggle row selection
    function handleToggleSelect(cred, e) {
        e.stopPropagation();
        onSelectRow && onSelectRow(cred);
    }

    // Toggle select-all for visible page
    function handlePageSelectAll(e) {
        e.stopPropagation();
        if (isAllSelected || paginatedCredentials.every(function(c) { return isSelected(c); })) {
            onDeselectAll && onDeselectAll();
        } else {
            onSelectAll && onSelectAll();
        }
    }

    // Check if all visible rows on current page are selected (for checkbox state)
    const pageAllSelected = paginatedCredentials.length > 0 && paginatedCredentials.every(function(c) { return isSelected(c); });

    // Any row on current page is partially selected (for indeterminate header checkbox)
    const pagePartiallySelected = !pageAllSelected && paginatedCredentials.some(function(c) { return isSelected(c); });

    // Build pagination data array for Splunk Paginator (label per page)
    var pageNumberData = [];
    for (var p = 1; p <= totalPages; p++) {
        pageNumberData.push({ label: String(p), value: String(p), index: p - 1 });
    }

    // Create checkbox cell factory
    function createCheckboxCell(cred) {
        return React.createElement(TableCell, null,
            React.createElement('input', {
                type: 'checkbox',
                checked: isSelected(cred),
                onChange: function(e) { handleToggleSelect(cred, e); },
                style: { cursor: 'pointer' },
            })
        );
    }

    // Create action cell factory — uses Splunk Button with minimal styling for row actions
    function createActionCell(cred) {
        return React.createElement(TableCell, null,
            React.createElement(
                'div',
                { style: { display: 'flex', gap: '0.25rem' } },
                React.createElement(Button, { onClick: function() { onEdit && onEdit(cred); }, children: 'Edit' }),
                React.createElement(Button, { onClick: function() { onReveal && onReveal(cred); }, children: 'Reveal' }),
                React.createElement(Button, { onClick: function() { onDelete && onDelete(cred); }, appearance: 'destructive', children: 'Delete' })
            )
        );
    }

    // Build header cells with sorting
    var headerCells = [
        React.createElement(TableHeadCell, { key: 'select', onClick: handlePageSelectAll, style: { cursor: 'pointer', textAlign: 'left' } },
            React.createElement('input', {
                type: 'checkbox',
                checked: pageAllSelected,
                ref: function(el) { if (el) el.indeterminate = pagePartiallySelected; },
                style: { cursor: 'pointer' },
            })
        ),
        React.createElement(TableHeadCell, { key: 'username', onClick: function() { handleSort('name'); }, style: { cursor: 'pointer', textAlign: 'left' } }, 'Username ', getSortIndicator('name')),
        React.createElement(TableHeadCell, { key: 'realm', onClick: function() { handleSort('realm'); }, style: { cursor: 'pointer', textAlign: 'left' } }, 'Realm ', getSortIndicator('realm')),
        React.createElement(TableHeadCell, { key: 'app', onClick: function() { handleSort('app'); }, style: { cursor: 'pointer', textAlign: 'left' } }, 'App ', getSortIndicator('app')),
        React.createElement(TableHeadCell, { key: 'owner', onClick: function() { handleSort('owner'); }, style: { cursor: 'pointer', textAlign: 'left' } }, 'Owner ', getSortIndicator('owner')),
        React.createElement(TableHeadCell, { key: 'actions', style: { textAlign: 'left' } }, 'Actions')
    ];

    // Build data rows
    var dataRows = paginatedCredentials.length > 0
        ? paginatedCredentials.map(function(cred) {
            return React.createElement(TableRow, { key: cred.stanzaKey },
                createCheckboxCell(cred),
                React.createElement(TableCell, null, cred.name || cred.realm),
                React.createElement(TableCell, null,
                    React.createElement(Chip, { label: (!cred.realm || cred.realm === 'nobody') ? 'global' : (cred.realm || ''), backgroundColor: (!cred.realm || cred.realm === 'nobody') ? '#e0e0e0' : '#e3f2fd', color: (!cred.realm || cred.realm === 'nobody') ? 'inherit' : '#1565c0' })
                ),
                React.createElement(TableCell, null,
                    React.createElement(Chip, { label: cred.app || 'search', backgroundColor: '#e8f5e9', color: '#2e7d32' })
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
        // Filter bar (keeps native filter+select — Splunk Text + Select would be Task 8 territory)
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
            )
        ),

        // Credentials table — Splunk Table component
        React.createElement(TableMod, { style: { width: '100%', marginBottom: '1rem' } },
            React.createElement(TableHead, null,
                React.createElement(TableRow, null, ...headerCells)
            ),
            React.createElement(TableBody, null, ...dataRows)
        ),

        // Pagination — Splunk Paginator component (or native fallback for <2 pages)
        totalPages > 1 ? React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' } },
            pageNumberData.length <= 0
                ? null
                : React.createElement(Paginator, {
                    pageLabel: 'Pages',
                    data: pageNumberData,
                    activeItem: { label: String(currentPage), value: String(currentPage) },
                    onSelect: handlePageChange,
                })
        ) : null
    );
}

// Export component
module.exports = CredentialTable;
