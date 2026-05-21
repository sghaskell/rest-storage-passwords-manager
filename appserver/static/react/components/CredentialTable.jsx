/**
 * CredentialTable.jsx - Table component for displaying credentials
 *
 * Displays credentials in a table with pagination, filtering, sorting, selection,
 * and edit/reveal/delete actions per row.
 * Uses @splunk/react-ui Table, Paginator, Chip, and Button components.
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
var Pencil = require('@splunk/react-icons/Pencil').default;
var PlusSquare = require('@splunk/react-icons/PlusSquare').default;
var TrashCanCross = require('@splunk/react-icons/TrashCanCross').default;

// Splunk Dropdown, Checkbox for column picker
var DropdownMod = require('@splunk/react-ui/Dropdown');
var Dropdown = DropdownMod.default;
var CheckboxMod = require('@splunk/react-ui/Checkbox');
var Checkbox = CheckboxMod.default;

// Column definitions — drives headers, data cells, sorting, and picker
var COLUMNS = [
    { key: 'name',     label: 'Username',   sortable: true,  fixed: true  },
    { key: 'realm',    label: 'Realm',      sortable: true,  fixed: false },
    { key: 'app',      label: 'App',        sortable: true,  fixed: false },
    { key: 'owner',    label: 'Owner',      sortable: true,  fixed: false },
    { key: 'mtime',    label: 'Modified',   sortable: true,  fixed: false },
    { key: 'aclRead',  label: 'Read Roles', sortable: true,  fixed: false },
    { key: 'aclWrite', label: 'Write Roles',sortable: true,  fixed: false },
    { key: 'actions',  label: 'Actions',    sortable: false, fixed: true  }
];

var VISIBLE_COLUMNS_KEY = 'credential-table-visible-columns';
var DEFAULT_VISIBLE = ['name', 'realm', 'app', 'owner', 'aclRead', 'aclWrite', 'actions'];
var ROWS_PER_PAGE_KEY = 'credential-table-rows-per-page';
var DEFAULT_ROWS_PER_PAGE = 10;

function loadVisibleColumns() {
    try {
        var stored = localStorage.getItem(VISIBLE_COLUMNS_KEY);
        if (stored) {
            var parsed = JSON.parse(stored);
            var hasAllFixed = COLUMNS.filter(function(c) { return c.fixed; }).every(function(c) { return parsed.indexOf(c.key) !== -1; });
            if (Array.isArray(parsed) && hasAllFixed) {
                var validKeys = COLUMNS.map(function(c) { return c.key; });
                var valid = parsed.filter(function(k) { return validKeys.indexOf(k) !== -1; });
                return COLUMNS.map(function(c) { return c.key; }).filter(function(k) { return valid.indexOf(k) !== -1; });
            }
        }
    } catch (e) {}
    return DEFAULT_VISIBLE.slice();
}

function saveVisibleColumns(columns) {
    try { localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify(columns)); } catch (e) {}
}

function loadRowsPerPage() {
    try {
        var stored = localStorage.getItem(ROWS_PER_PAGE_KEY);
        if (stored) {
            var parsed = parseInt(stored, 10);
            if ([10, 25, 50, 100].indexOf(parsed) !== -1) return parsed;
        }
    } catch (e) {}
    return DEFAULT_ROWS_PER_PAGE;
}

function saveRowsPerPage(count) {
    try { localStorage.setItem(ROWS_PER_PAGE_KEY, String(count)); } catch (e) {}
}

/**
 * CredentialTable - Table component for credential management
 *
 * @param {Object} props - Component props
 * @param {Array} props.credentials - Array of credential objects (already filtered/sorted by parent)
 * @param {Array} props.selectedRows - Currently selected rows for bulk operations
 * @param {Function} props.onDelete - Callback when delete is clicked
 * @param {Function} props.onReveal - Callback when reveal password is clicked
 * @param {Function} props.onSelectRow - Callback when row checkbox toggled
 * @param {Function} props.onSelectAll - Callback when select-all checked
 * @param {Function} props.onDeselectAll - Callback when select-all unchecked
 * @param {Function} props.onEdit - Callback when edit button clicked
 * @param {Function} props.onCopy - Callback when copy button clicked
 * @param {string} props.filterText - Search text (controlled from parent)
 * @param {Function} props.onFilterChange - Callback when filter text changes
 * @param {string} props.filterType - Filter field type (controlled from parent)
 * @param {Function} props.onFilterTypeChange - Callback when filter type changes
 * @param {Object} props.sortConfig - Sort config {key, direction} (controlled from parent)
 * @param {Function} props.onSortChange - Callback when sort changes
 */
function CredentialTable({
    credentials = [],
    selectedRows = [],
    onDelete,
    onReveal,
    onSelectRow,
    onSelectAll,
    onDeselectAll,
    onEdit,
    onCopy,
    filterText: filterTextProp,
    onFilterChange,
    filterType: filterTypeProp,
    onFilterTypeChange,
    sortConfig: sortConfigProp,
    onSortChange,
}) {
    // Filter/sort: accept from parent or fall back to local state for backwards compat
    const useParentState = filterTextProp !== undefined;
    const [localFilterText, setLocalFilterText] = React.useState('');
    const [localFilterType, setLocalFilterType] = React.useState('all');
    const [localSortConfig, setLocalSortConfig] = React.useState({ key: null, direction: 'asc' });

    const filterText = useParentState ? filterTextProp : localFilterText;
    const filterType = useParentState ? filterTypeProp : localFilterType;
    const sortConfig = useParentState ? sortConfigProp : localSortConfig;

    const setFilterText = useParentState ? onFilterChange : setLocalFilterText;
    const setFilterType = useParentState ? onFilterTypeChange : setLocalFilterType;
    const setSortConfig = useParentState ? onSortChange : setLocalSortConfig;

    const [currentPage, setCurrentPage] = React.useState(1);
    const [rowsPerPage, setRowsPerPage] = React.useState(loadRowsPerPage);
    const [visibleColumns, setVisibleColumns] = React.useState(loadVisibleColumns);
    const [dropdownOpen, setDropdownOpen] = React.useState(false);

    // Quick filter chips state
    const [activeChip, setActiveChip] = React.useState(null);

    React.useEffect(function() {
        saveVisibleColumns(visibleColumns);
    }, [visibleColumns]);

    React.useEffect(function() {
        saveRowsPerPage(rowsPerPage);
    }, [rowsPerPage]);

    // Filter credentials — only when using local state; parent already provides filtered data
    const filteredCredentials = useParentState ? credentials : React.useMemo(function() {
        if (!filterText) return credentials;
        return credentials.filter(function(credential) {
            var name = (credential.name || '').toLowerCase();
            var realm = (credential.realm || '').toLowerCase();
            var app = (credential.app || '').toLowerCase();
            var owner = (credential.owner || '').toLowerCase();
            var aclRead = (credential.aclRead || '').toLowerCase();
            var aclWrite = (credential.aclWrite || '').toLowerCase();
            var mtime = (credential.mtime || '').toString();
            var search = filterText.toLowerCase();

            if (filterType === 'all') {
                return (
                    name.includes(search) ||
                    realm.includes(search) ||
                    app.includes(search) ||
                    owner.includes(search) ||
                    aclRead.includes(search) ||
                    aclWrite.includes(search) ||
                    mtime.includes(search)
                );
            } else if (filterType === 'username') {
                return name.includes(search);
            } else if (filterType === 'realm') {
                return realm.includes(search);
            } else if (filterType === 'app') {
                return app.includes(search);
            } else if (filterType === 'owner') {
                return owner.includes(search);
            } else if (filterType === 'readRoles') {
                return aclRead.includes(search);
            } else if (filterType === 'writeRoles') {
                return aclWrite.includes(search);
            } else if (filterType === 'modified') {
                return mtime.includes(search);
            }
            return true;
        });
    }, [credentials, filterText, filterType]);

    // Sort credentials — only when using local state; parent already provides sorted data
    const sortedCredentials = useParentState ? credentials : React.useMemo(function() {
        if (!sortConfig.key) return filteredCredentials;
        return [...filteredCredentials].sort(function(a, b) {
            var aValue = a[sortConfig.key] || '';
            var bValue = b[sortConfig.key] || '';
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredCredentials, sortConfig.key, sortConfig.direction]);

    // Compute unique realms and apps from sorted credentials
    const uniqueRealms = React.useMemo(function() {
        var set = {};
        sortedCredentials.forEach(function(c) {
            var r = c.realm || '';
            var label = (!r || r === 'nobody') ? 'global' : r;
            set[label] = true;
        });
        return Object.keys(set).sort(function(a, b) {
            if (a === 'global') return -1;
            if (b === 'global') return 1;
            return a.localeCompare(b);
        });
    }, [sortedCredentials]);

    const uniqueApps = React.useMemo(function() {
        var set = {};
        sortedCredentials.forEach(function(c) {
            var a = c.app || 'search';
            set[a] = true;
        });
        return Object.keys(set).sort();
    }, [sortedCredentials]);

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
        setActiveChip(null);
        setCurrentPage(1);
    }

    // Handle chip click
    function handleChipClick(type, value) {
        if (type === 'all' || value === '') {
            setActiveChip(null);
            setFilterText('');
            setFilterType('all');
            setCurrentPage(1);
            return;
        }
        if (activeChip && activeChip.type === type && activeChip.value === value) {
            setActiveChip(null);
            setFilterText('');
            setFilterType('all');
            setCurrentPage(1);
        } else {
            setActiveChip({ type: type, value: value });
            setFilterText(value);
            setFilterType(type === 'realm' ? 'realm' : 'app');
            setCurrentPage(1);
        }
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
    function handleToggleSelect(cred) {
        onSelectRow && onSelectRow(cred);
    }

    // Toggle select-all for visible page
    function handlePageSelectAll() {
        if (paginatedCredentials.every(function(c) { return isSelected(c); })) {
            onDeselectAll && onDeselectAll();
        } else {
            onSelectAll && onSelectAll(paginatedCredentials);
        }
    }

    // colSpan = visible columns + 1 (checkbox column from rowSelection)
    function getColSpan() {
        return visibleColumns.length + 1;
    }

    // Toggle column visibility — respects fixed flag
    function toggleColumnVisibility(colKey) {
        setVisibleColumns(function(prev) {
            var col = COLUMNS.find(function(c) { return c.key === colKey; });
            if (col && col.fixed) return prev;
            var idx = prev.indexOf(colKey);
            if (idx !== -1) {
                return prev.filter(function(k) { return k !== colKey; });
            } else {
                return COLUMNS.map(function(c) { return c.key; })
                    .filter(function(k) { return k === colKey || prev.indexOf(k) !== -1; });
            }
        });
    }

    // Build header cell for a column definition
    function buildHeaderCell(col) {
        if (col.sortable) {
            return React.createElement(TableHeadCell, {
                onClick: function() { handleSort(col.key); },
                appearClickable: true
            }, col.label + ' ', getSortIndicator(col.key));
        }
        return React.createElement(TableHeadCell, null, col.label);
    }

    // Format mtime epoch seconds to readable date
    function formatMtime(mtime) {
        if (!mtime) return '';
        var d = new Date(Number(mtime) * 1000);
        if (isNaN(d.getTime())) return String(mtime);
        var month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var day = d.getDate();
        var mon = month[d.getMonth()];
        var year = d.getFullYear();
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return day + ' ' + mon + ' ' + year + ' ' + hh + ':' + mm;
    }

    // Build data cell for a column + credential
    function buildDataCell(col, cred) {
        if (col.key === 'actions') {
            return React.createElement(TableCell, null,
                React.createElement(
                    'div',
                    { style: { display: 'flex', gap: '0.25rem' } },
                    React.createElement(Button, { onClick: function() { onCopy && onCopy(cred); }, appearance: 'subtle', title: 'Copy credential', icon: React.createElement(PlusSquare, { variant: 'filled' }) }),
                    React.createElement(Button, { onClick: function() { onEdit && onEdit(cred); }, appearance: 'subtle', title: 'Edit credential', icon: React.createElement(Pencil, { variant: 'filled' }) }),
                    React.createElement(Button, { onClick: function() { onReveal && onReveal(cred); }, appearance: 'subtle', title: 'Reveal password', icon: React.createElement(Eye, { variant: 'filled' }) }),
                    React.createElement(Button, { onClick: function() { onDelete && onDelete(cred); }, appearance: 'subtle', title: 'Delete credential', icon: React.createElement(TrashCanCross, { variant: 'filled' }) })
                )
            );
        }
        if (col.key === 'mtime') {
            return React.createElement(TableCell, {
                style: { fontSize: '12px', color: '#666', whiteSpace: 'nowrap' }
            }, formatMtime(cred.mtime));
        }
        if (col.key === 'realm') {
            var isGlobal = !cred.realm || cred.realm === 'nobody';
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: isGlobal ? '#f5f5f5' : '#e3f2fd',
                        color: isGlobal ? '#757575' : '#1565c0',
                        border: '1px solid ' + (isGlobal ? '#e0e0e0' : '#90caf9'),
                        whiteSpace: 'nowrap',
                    }
                }, isGlobal ? 'global' : (cred.realm || ''))
            );
        }
        if (col.key === 'app') {
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: '#e8f5e9',
                        color: '#2e7d32',
                        border: '1px solid #a5d6a7',
                        whiteSpace: 'nowrap',
                    }
                }, cred.app || 'search')
            );
        }
        if (col.key === 'owner') {
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: '#fff3e0',
                        color: '#e65100',
                        border: '1px solid #ffcc80',
                        whiteSpace: 'nowrap',
                    }
                }, cred[col.key] || '')
            );
        }
        if (col.key === 'aclRead' || col.key === 'aclWrite') {
            var roles = (cred[col.key] || '').split(',').map(function(r) { return r.trim(); }).filter(function(r) { return r; });
            var c = col.key === 'aclRead' ? { bg: '#f3e5f5', color: '#7b1fa2', border: '#ce93d8' } : { bg: '#fce4ec', color: '#c62828', border: '#f48fb1' };
            return React.createElement(TableCell, null,
                React.createElement(
                    'div',
                    { style: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' } },
                    roles.map(function(role, i) {
                        return React.createElement('span', {
                            key: i,
                            style: {
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: '600',
                                backgroundColor: c.bg,
                                color: c.color,
                                border: '1px solid ' + c.border,
                                whiteSpace: 'nowrap',
                            }
                        }, role);
                    })
                )
            );
        }
        if (col.key === 'name') {
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: '#e8eaf6',
                        color: '#283593',
                        border: '1px solid #9fa8da',
                        whiteSpace: 'nowrap',
                    }
                }, cred[col.key] || '')
            );
        }
        return React.createElement(TableCell, null, cred[col.key] || '');
    }

    // Determine rowSelection state for header checkbox
    var someSelected = paginatedCredentials.some(function(c) { return isSelected(c); });
    var allSelected = paginatedCredentials.length > 0 && paginatedCredentials.every(function(c) { return isSelected(c); });
    var rowSelectionState = allSelected ? 'all' : (someSelected ? 'some' : 'none');

    // Build header cells dynamically from visible columns
    var headerCells = visibleColumns.map(function(k) {
        var col = COLUMNS.find(function(c) { return c.key === k; });
        return buildHeaderCell(col);
    });

    // Build data rows
    var dataRows = paginatedCredentials.length > 0
        ? paginatedCredentials.map(function(cred) {
            return React.createElement(TableRow, {
                key: cred.stanzaKey,
                selected: isSelected(cred),
                onRequestToggle: function() { handleToggleSelect(cred); },
            },
                visibleColumns.map(function(vk) {
                    var col = COLUMNS.find(function(cc) { return cc.key === vk; });
                    return buildDataCell(col, cred);
                })
            );
        })
        : [React.createElement(TableRow, { key: 'empty' },
            React.createElement(TableCell, { colSpan: getColSpan(), style: { textAlign: 'center', padding: '2rem', color: '#666' } }, 'No credentials found')
        )];

    var labelStyle = { display: 'flex', alignItems: 'center', height: '28px', fontSize: '13px' };

    // Quick filter chips
    var renderChip = function(label, type, value, isActive) {
        var isRealm = type === 'realm';
        var bg = isActive ? (isRealm ? '#bbdefb' : '#a5d6a7') : (isRealm ? '#e3f2fd' : '#e8f5e9');
        var color = isActive ? (isRealm ? '#0d47a1' : '#1b5e20') : (isRealm ? '#1565c0' : '#2e7d32');
        var border = isActive ? (isRealm ? '#1565c0' : '#2e7d32') : (isRealm ? '#90caf9' : '#a5d6a7');
        return React.createElement(
            'span',
            {
                key: type + '-' + value,
                onClick: function() { handleChipClick(type, value); },
                style: {
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: isActive ? '700' : '600',
                    backgroundColor: bg,
                    color: color,
                    border: '2px solid ' + border,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s',
                }
            },
            label
        );
    };

    var chipsContent = React.createElement(
        'div',
        { style: { overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: '4px', marginBottom: '0.5rem' } },
        React.createElement(
            'span',
            { style: { marginRight: '0.5rem', fontSize: '11px', color: '#888', lineHeight: '24px' } },
            'Realms: '
        ),
        renderChip('All', 'all', '', !activeChip),
        uniqueRealms.map(function(r) {
            return renderChip(r, 'realm', r, activeChip && activeChip.type === 'realm' && activeChip.value === r);
        }),
        React.createElement(
            'span',
            { style: { display: 'inline-block', marginRight: '0.5rem', marginLeft: '1rem', fontSize: '11px', color: '#888', lineHeight: '24px' } },
            'Apps: '
        ),
        uniqueApps.map(function(a) {
            return renderChip(a, 'app', a, activeChip && activeChip.type === 'app' && activeChip.value === a);
        })
    );

    return React.createElement(
        'div',
        { className: 'credential-table-container' },
        // Quick filter chips
        chipsContent,

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
                React.createElement('option', { value: 'app' }, 'App'),
                React.createElement('option', { value: 'owner' }, 'Owner'),
                React.createElement('option', { value: 'modified' }, 'Modified'),
                React.createElement('option', { value: 'readRoles' }, 'Read Roles'),
                React.createElement('option', { value: 'writeRoles' }, 'Write Roles')
            ),
            React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'baseline' } },
                React.createElement(Dropdown, {
                    open: dropdownOpen,
                    onRequestOpen: function() { setDropdownOpen(true); },
                    onRequestClose: function() { setDropdownOpen(false); },
                    closeReasons: ['clickAway', 'escapeKey', 'toggleClick'],
                    toggle: React.createElement(Button, { label: 'Show/Hide Columns', appearance: 'subtle' })
                },
                    React.createElement('div', {
                        className: 'column-picker',
                        style: { padding: '0.5rem 0' }
                    },
                        COLUMNS.filter(function(c) { return !c.fixed; }).map(function(col) {
                            return React.createElement('div', {
                                key: col.key,
                                style: { padding: '4px 8px' }
                            },
                                React.createElement(Checkbox, {
                                    checked: visibleColumns.indexOf(col.key) !== -1,
                                    onChange: function() { toggleColumnVisibility(col.key); }
                                }, col.label)
                            );
                        })
                    )
                ),
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

        // Credentials table
        React.createElement(Table, {
            outerStyle: { width: '100%', marginBottom: '1rem' },
            tableStyle: { width: '100%' },
            rowSelection: rowSelectionState,
            onRequestToggleAllRows: handlePageSelectAll,
            stripeRows: true,
        },
            React.createElement(TableHead, null, ...headerCells),
            React.createElement(TableBody, null, ...dataRows)
        ),

        // Row count + Pagination
        React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' } },
            React.createElement('span', { style: { fontSize: '12px', color: '#666' } },
                'Showing ' + ((currentPage - 1) * rowsPerPage + 1) + '-' + Math.min(currentPage * rowsPerPage, sortedCredentials.length) + ' of ' + sortedCredentials.length + ' credential' + (sortedCredentials.length !== 1 ? 's' : '')
            ),
            totalPages > 1 ? React.createElement(Paginator, {
                current: currentPage,
                totalPages: totalPages,
                numPageLinks: totalPages,
                onChange: function(event, data) { setCurrentPage(data.page); },
            }) : null
        )
    );
}

module.exports = CredentialTable;
