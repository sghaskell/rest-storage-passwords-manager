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

    // Handle row expansion toggle — called from onClick
    function handleExpansion(cred) {
        setExpandedRowKey(expandedRowKey === cred.stanzaKey ? null : cred.stanzaKey);
    }

    // Handle inline form save
    function handleInlineSave(cred, formData) {
        setExpandedRowKey(null);
        onUpdate && onUpdate(cred, formData);
    }

    // Build expansion content — white wrapper with negative margins to mask Splunk's border
    function buildExpansionContent(cred) {
        return React.createElement(TableRow, {
            key: cred.stanzaKey + '-expansion',
            className: 'cred-expansion-row',
        },
            React.createElement(TableCell, { colSpan: 6, style: { padding: 0, border: 'none' } },
                React.createElement('div', {
                    onClick: function(e) { e.stopPropagation(); },
                    style: {
                        background: '#fff',
                        margin: 0,
                        padding: '1rem 1.5rem',
                        boxSizing: 'border-box',
                    }
                },
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
                className: isExpanded ? 'cred-expanded-row' : undefined,
                selected: isSelected(cred),
                style: isExpanded ? { backgroundColor: '#fff', cursor: 'pointer' } : { cursor: 'pointer' },
                onRequestToggle: function() { handleToggleSelect(cred); },
                expandable: true,
                onMouseDown: function(e) {
                    if (e.target.closest('input[type="checkbox"]') || e.target.closest('button')) return;
                    e.preventDefault(); // prevent focus from painting the blue ring
                    handleExpansion(cred);
                },
                expanded: isExpanded,
                expansionRow: buildExpansionContent(cred),
            },
                React.createElement(TableCell, null, cred.name || cred.realm),
                React.createElement(TableCell, null,
                    React.createElement(Chip, { backgroundColor: (!cred.realm || cred.realm === 'nobody') ? '#bdbdbd' : '#e3f2fd', foregroundColor: (!cred.realm || cred.realm === 'nobody') ? '#212121' : '#1565c0' },
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

    var labelStyle = { display: 'flex', alignItems: 'center', height: '28px', fontSize: '13px' };

    return React.createElement(
        'div',
        { className: 'credential-table-container' },
        // CSS override: expansion rows get solid white bg, no hover, no blue border; expanded parent row also loses hover
        React.createElement('style', null,
            /* Target expansion row and its td only — do NOT touch form descendants */
            '.credential-table-container .cred-expansion-row,\n' +
            '.credential-table-container .cred-expansion-row td {\n' +
            '  background: #fff !important;\n' +
            '  border: none !important;\n' +
            '  border-top: 0 !important;\n' +
            '  border-left: 0 !important;\n' +
            '  border-top-color: transparent !important;\n' +
            '  border-left-color: transparent !important;\n' +
            '  box-shadow: none !important;\n' +
            '  outline: none !important;\n' +
            '  outline-color: transparent !important;\n' +
            '}\n' +
            '.credential-table-container .cred-expansion-row::before,\n' +
            '.credential-table-container .cred-expansion-row::after,\n' +
            '.credential-table-container .cred-expansion-row td::before,\n' +
            '.credential-table-container .cred-expansion-row td::after {\n' +
            '  border: none !important;\n' +
            '  border-top: 0 !important;\n' +
            '  border-left: 0 !important;\n' +
            '  border-top-color: transparent !important;\n' +
            '  border-left-color: transparent !important;\n' +
            '  box-shadow: none !important;\n' +
            '  outline: none !important;\n' +
            '  display: none !important;\n' +
            '}\n' +
            /* Kill blue focus ring on expand chevron button */
            '.credential-table-container button[title*="Expand"],\n' +
            '.credential-table-container button[title*="Collapse"] {\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '  border: none !important;\n' +
            '}\n' +
            '.credential-table-container button[title*="Expand"]:focus,\n' +
            '.credential-table-container button[title*="Collapse"]:focus {\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '  border: none !important;\n' +
            '}\n' +
            /* Kill focus ring on expanded row — the blue box that appears on click */
            '.credential-table-container .cred-expanded-row:focus,\n' +
            '.credential-table-container .cred-expanded-row:focus-visible {\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '  border: none !important;\n' +
            '}\n' +
            '.credential-table-container .cred-expanded-row:focus td,\n' +
            '.credential-table-container .cred-expanded-row:focus-visible td {\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '  border: none !important;\n' +
            '  border-color: transparent !important;\n' +
            '}\n' +
            '.credential-table-container .cred-expanded-row:focus::before,\n' +
            '.credential-table-container .cred-expanded-row:focus::after,\n' +
            '.credential-table-container .cred-expanded-row:focus-visible::before,\n' +
            '.credential-table-container .cred-expanded-row:focus-visible::after,\n' +
            '.credential-table-container .cred-expanded-row:focus td::before,\n' +
            '.credential-table-container .cred-expanded-row:focus td::after {\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '  border: none !important;\n' +
            '  display: none !important;\n' +
            '}\n' +
            /* Kill hover on the expanded parent row too — always white, never highlight */
            '.credential-table-container .cred-expanded-row,\n' +
            '.credential-table-container .cred-expanded-row:hover,\n' +
            '.credential-table-container .cred-expanded-row:hover td {\n' +
            '  background: #fff !important;\n' +
            '  background-color: #fff !important;\n' +
            '  border: none !important;\n' +
            '  border-top: 0 !important;\n' +
            '  border-left: 0 !important;\n' +
            '  border-top-color: transparent !important;\n' +
            '  border-left-color: transparent !important;\n' +
            '  box-shadow: none !important;\n' +
            '  outline: none !important;\n' +
            '}\n' +
            '.credential-table-container .cred-expanded-row td,\n' +
            '.credential-table-container .cred-expanded-row:hover td {\n' +
            '  background: #fff !important;\n' +
            '  background-color: #fff !important;\n' +
            '  border: none !important;\n' +
            '  border-color: transparent !important;\n' +
            '  outline: none !important;\n' +
            '  outline-color: transparent !important;\n' +
            '  box-shadow: none !important;\n' +
            '}\n' +
            '.credential-table-container .cred-expanded-row td::before,\n' +
            '.credential-table-container .cred-expanded-row td::after {\n' +
            '  border: none !important;\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '}\n' +
            '.credential-table-container .cred-expanded-row td > * {\n' +
            '  background: transparent !important;\n' +
            '  background-color: transparent !important;\n' +
            '}\n' +
            /* Kill blue focus ring on all interactive elements */
            '.credential-table-container input:focus,\n' +
            '.credential-table-container select:focus,\n' +
            '.credential-table-container button:focus,\n' +
            '.credential-table-container input:focus-visible,\n' +
            '.credential-table-container select:focus-visible,\n' +
            '.credential-table-container button:focus-visible,\n' +
            '.credential-table-container input[type="checkbox"]:focus,\n' +
            '.credential-table-container input[type="checkbox"]:focus-visible {\n' +
            '  outline: none !important;\n' +
            '  box-shadow: none !important;\n' +
            '  border-color: inherit !important;\n' +
            '}\n'
        ),
        // Filter bar + pagination controls
        React.createElement(
            'div',
            { style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' } },
            React.createElement('strong', { style: labelStyle }, 'Search:'),
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
                    fontSize: '13px',
                    height: '28px',
                    boxSizing: 'border-box',
                },
            }),
            React.createElement('select', {
                value: filterType,
                onChange: function(e) { setFilterType(e.target.value); },
                style: { padding: '0.25rem 0.5rem', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px', height: '28px', boxSizing: 'border-box' },
            },
                React.createElement('option', { value: 'all' }, 'All Fields'),
                React.createElement('option', { value: 'username' }, 'Username'),
                React.createElement('option', { value: 'realm' }, 'Realm'),
                React.createElement('option', { value: 'app' }, 'App')
            ),
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
        ),

        // Credentials table — rowSelection + rowExpansion + onRequestToggleAllRows on Table
        React.createElement(Table, {
            outerStyle: { width: '100%', marginBottom: '1rem' },
            tableStyle: { width: '100%' },
            rowSelection: rowSelectionState,
            onRequestToggleAllRows: handlePageSelectAll,
            rowExpansion: 'controlled',
            stripeRows: true,
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
