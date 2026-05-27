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
var ExclamationTriangle = require('@splunk/react-icons/ExclamationTriangle').default;
var Clock = require('@splunk/react-icons/Clock').default;

// Splunk Dropdown, Checkbox for column picker
var DropdownMod = require('@splunk/react-ui/Dropdown');
var Dropdown = DropdownMod.default;
var CheckboxMod = require('@splunk/react-ui/Checkbox');
var Checkbox = CheckboxMod.default;

// Column definitions — drives headers, data cells, sorting, and picker
var COLUMNS = [
    { key: 'name',     label: 'Username',   sortable: true,  fixed: true  },
    { key: 'realm',    label: 'Realm',      sortable: true,  fixed: false },
    { key: 'expiry',   label: 'Expiry',     sortable: true,  fixed: false },
    { key: 'app',      label: 'App',        sortable: true,  fixed: false },
    { key: 'owner',    label: 'Owner',      sortable: true,  fixed: false },
    { key: 'rotation', label: 'Rotation',   sortable: true,  fixed: false },
    { key: 'mtime',    label: 'Modified',   sortable: true,  fixed: false },
    { key: 'aclRead',  label: 'Read Roles', sortable: true,  fixed: false },
    { key: 'aclWrite', label: 'Write Roles',sortable: true,  fixed: false },
    { key: 'actions',  label: 'Actions',    sortable: false, fixed: true  }
];

var VISIBLE_COLUMNS_KEY = 'credential-table-visible-columns';
var DEFAULT_VISIBLE = ['name', 'realm', 'expiry', 'app', 'owner', 'rotation', 'aclRead', 'aclWrite', 'actions'];
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
                var result = parsed.filter(function(k) { return validKeys.indexOf(k) !== -1; });
                // Migrate: insert 'expiry' after 'realm' if missing
                if (result.indexOf('expiry') === -1 && result.indexOf('realm') !== -1) {
                    result.splice(result.indexOf('realm') + 1, 0, 'expiry');
                    localStorage.setItem(VISIBLE_COLUMNS_KEY, JSON.stringify(result));
                }
                return result;
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
     * @param {Function} props.onDeselectPage - Callback when select-all unchecked for current page
 * @param {Function} props.onEdit - Callback when edit button clicked
 * @param {Function} props.onCopy - Callback when copy button clicked
 * @param {Function} props.onHistory - Callback when history button clicked
 * @param {string} props.filterText - Search text (controlled from parent)
 * @param {Function} props.onFilterChange - Callback when filter text changes
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
    onDeselectPage,
    onEdit,
    onCopy,
    onHistory,
    filterText: filterTextProp,
    onFilterChange,
    activeFilters: activeFiltersProp,
    onActiveFiltersChange,
    sortConfig: sortConfigProp,
    onSortChange,
    duplicateInfo,
    onOpenPresetModal,
    columnsRefreshKey,
}) {
    // Filter/sort: accept from parent or fall back to local state for backwards compat
    const useParentState = filterTextProp !== undefined;
    const [localFilterText, setLocalFilterText] = React.useState('');
    const [localActiveFilters, setLocalActiveFilters] = React.useState([]);
    const [localSortConfig, setLocalSortConfig] = React.useState({ key: null, direction: 'asc' });

    const filterText = useParentState ? filterTextProp : localFilterText;
    const activeFilters = useParentState ? activeFiltersProp : localActiveFilters;
    const sortConfig = useParentState ? sortConfigProp : localSortConfig;

    const setFilterText = useParentState ? onFilterChange : setLocalFilterText;
    const setActiveFilters = useParentState ? onActiveFiltersChange : setLocalActiveFilters;
    const setSortConfig = useParentState ? onSortChange : setLocalSortConfig;

    const [currentPage, setCurrentPage] = React.useState(1);
    const [rowsPerPage, setRowsPerPage] = React.useState(loadRowsPerPage);
    const [visibleColumns, setVisibleColumns] = React.useState(loadVisibleColumns);
    const [dropdownOpen, setDropdownOpen] = React.useState(false);

    React.useEffect(function() {
        saveVisibleColumns(visibleColumns);
    }, [visibleColumns]);

    // Re-read columns from localStorage when a preset is applied (parent signals via columnsRefreshKey)
    React.useEffect(function() {
        setVisibleColumns(loadVisibleColumns());
    }, [columnsRefreshKey || 0]);

    React.useEffect(function() {
        saveRowsPerPage(rowsPerPage);
    }, [rowsPerPage]);

    // Check if any credentials are expired or expiring soon (for conditional button rendering)
    const hasExpiredCredentials = React.useMemo(function() {
        return credentials.some(function(c) {
            return c.rotationStatus === 'overdue' || c.rotationStatus === 'due-soon';
        });
    }, [credentials]);

    // Filter credentials — only when using local state; parent already provides filtered data
    const filteredCredentials = useParentState ? credentials : React.useMemo(function() {
        return credentials.filter(function(credential) {
            var name = (credential.name || '').toLowerCase();
            var realm = (credential.realm || '').toLowerCase();
            var app = (credential.app || '').toLowerCase();
            var owner = (credential.namespaceOwner || credential.owner || '').toLowerCase();
            var aclRead = (credential.aclRead || '').toLowerCase();
            var aclWrite = (credential.aclWrite || '').toLowerCase();
            var mtime = (credential.mtime || '').toString();

            // Text search across all fields
            if (filterText) {
                var search = filterText.toLowerCase();
                if (!(name.includes(search) || realm.includes(search) || app.includes(search) || owner.includes(search) || aclRead.includes(search) || aclWrite.includes(search) || mtime.includes(search))) {
                    return false;
                }
            }

            // Active filters — AND logic, exact match per field
            for (var i = 0; i < activeFilters.length; i++) {
                var f = activeFilters[i];
                var val = f.value.toLowerCase();
                if (f.field === 'username' && name !== val) return false;
                if (f.field === 'realm') {
                    var _fRealmInfo = _parseRealmForDisplay(credential.realm);
                    var _fDisplayRealm = _fRealmInfo.baseRealm && _fRealmInfo.baseRealm !== 'nobody'
                        ? _fRealmInfo.baseRealm.toLowerCase()
                        : (val === 'Exp: ...' ? '' : '');
                    var _fIsGlobal = !_fRealmInfo.baseRealm || _fRealmInfo.baseRealm === 'nobody';
                    // Handle expiry-only display labels ("Exp: 26 May 2026")
                    var _fRealmLabel;
                    if (!_fIsGlobal && _fRealmInfo.baseRealm) {
                        _fRealmLabel = _fRealmInfo.baseRealm.toLowerCase();
                    } else if (_fRealmInfo.hasExpiry) {
                        // For expiry-only realms, the label is "Exp: ..." — match any expiry credential
                        // In practice this shouldn't happen since we parse and display base realm first
                        _fRealmLabel = 'exp';
                    } else {
                        _fRealmLabel = 'global';
                    }
                    if (val === 'global' && !_fIsGlobal) return false;
                    if (val !== 'global' && _fRealmLabel !== val) return false;
                }
                if (f.field === 'app' && (credential.app || '').toLowerCase() !== val) return false;
                if (f.field === 'owner' && (credential.namespaceOwner || credential.owner || '').toLowerCase() !== val) return false;
                if (f.field === 'expiry') {
                    var _expInfo = _parseRealmForDisplay(credential.realm);
                    var _expDate = _expInfo.expiryDate || '';
                    if (_expDate !== val) return false;
                }
                if (f.field === 'rotation' && (credential.rotationStatus || 'none').toLowerCase() !== val) return false;
                if (f.field === 'readRoles' && aclRead.split(',').map(function(r){return r.trim();}).indexOf(val) === -1) return false;
                if (f.field === 'writeRoles' && aclWrite.split(',').map(function(r){return r.trim();}).indexOf(val) === -1) return false;
                if (f.field === 'modified' && mtime !== val) return false;
                // Duplicates only filter
                if (f.field === 'isDuplicate') {
                    var dupKey = (credential.name || '') + ':' + (credential.realm || '') + ':' + (credential.app || 'search') + ':' + (credential.namespaceOwner || credential.owner || 'nobody') + ':' + (credential.sharing || 'app');
                    var isDup = duplicateInfo && duplicateInfo.duplicateCredentialMap && duplicateInfo.duplicateCredentialMap[dupKey] !== undefined;
                    if (val === 'true' && !isDup) return false;
                }
                if (f.field === 'isExpired') {
                    var isExpired = (credential.rotationStatus === 'overdue' || credential.rotationStatus === 'due-soon');
                    if (val === 'true' && !isExpired) return false;
                }
            }

            return true;
        });
    }, [credentials, filterText, activeFilters]);

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
        setCurrentPage(1);
    }

    // Handle adding a filter from clicking a cell pill
    // Uses functional updater to avoid stale closure
    function handleAddFilter(field, value) {
        setActiveFilters(function(prev) {
            var exists = prev.some(function(f) { return f.field === field && f.value === value; });
            if (exists) return prev;
            return prev.concat([{ field: field, value: value }]);
        });
        setCurrentPage(1);
    }

    // Handle removing a filter
    function handleRemoveFilter(index) {
        setActiveFilters(function(prev) {
            var next = prev.slice();
            next.splice(index, 1);
            return next;
        });
        setCurrentPage(1);
    }

    // Clear all filters
    function handleClearFilters() {
        setActiveFilters([]);
        setCurrentPage(1);
    }

    // Field definitions — maps column key to filter field key & label
    var FILTER_FIELDS = [
        { key: 'username', label: 'Username' },
        { key: 'realm', label: 'Realm' },
        { key: 'expiry', label: 'Expiry' },
        { key: 'app', label: 'App' },
        { key: 'owner', label: 'Owner' },
        { key: 'rotation', label: 'Rotation' },
        { key: 'readRoles', label: 'Read Roles' },
        { key: 'writeRoles', label: 'Write Roles' },
        { key: 'isDuplicate', label: 'Duplicate' },
        { key: 'isExpired', label: 'Expired' },
    ];

    // Column key → filter field key mapping
    var COLUMN_TO_FILTER = {
        name: 'username',
        realm: 'realm',
        expiry: 'expiry',
        app: 'app',
        owner: 'owner',
        aclRead: 'readRoles',
        aclWrite: 'writeRoles',
    };

    // Check if a filter is active for a given field/value
    function isFilterActive(field, value) {
        return activeFilters.some(function(f) { return f.field === field && f.value === value; });
    }

    // Unique key for a credential — stanzaKey can repeat across apps/owners/sharing
    function credKey(cred) {
        return cred.stanzaKey + ':' + cred.app + ':' + (cred.namespaceOwner || cred.owner || '') + ':' + cred.sharing;
    }

    // Check if a row is selected
    function isSelected(cred) {
        return selectedRows.some(function(r) { return credKey(r) === credKey(cred); });
    }

    // Toggle row selection
    function handleToggleSelect(cred) {
        onSelectRow && onSelectRow(cred);
    }

    // Toggle select-all for visible page
    function handlePageSelectAll() {
        if (paginatedCredentials.every(function(c) { return isSelected(c); })) {
            onDeselectPage && onDeselectPage(paginatedCredentials);
        } else {
            onSelectAll && onSelectAll(paginatedCredentials);
        }
    }

    // colSpan = visible columns + 1 (checkbox column from Splunk rowSelection)
    function getColSpan() {
        return visibleColumns.length + 1;
    }

    // Handle column reorder — Splunk Table fires this with fromIndex, toIndex
    function handleRequestMoveColumn({ fromIndex, toIndex }) {
        setVisibleColumns(function(prev) {
            var next = prev.slice();
            var headerToMove = next[fromIndex];
            var insertionIndex = toIndex < fromIndex ? toIndex : toIndex + 1;
            next.splice(insertionIndex, 0, headerToMove);
            var removalIndex = toIndex < fromIndex ? fromIndex + 1 : fromIndex;
            next.splice(removalIndex, 1);
            return next;
        });
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
                return prev.concat(colKey);
            }
        });
    }

    // Get sort indicator
    function getSortIndicator(key) {
        if (sortConfig.key !== key) return '\u2195';
        return sortConfig.direction === 'asc' ? '\u2191' : '\u2193';
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

    // Parse expiry from realm — extract base realm for display
    // Supports: "prod;expiry_2026-05-26", "expiry_2026-05-26", "prod", ""
    function _parseRealmForDisplay(realm) {
        if (!realm) return { baseRealm: '', hasExpiry: false, expiryDate: null };
        // Combined: "baseRealm;expiry_YYYY-MM-DD"
        var m = realm.match(/^(.+);(expiry_(\d{4}-\d{2}-\d{2}))$/);
        if (m) return { baseRealm: m[1], hasExpiry: true, expiryDate: m[3] };
        // Legacy: "expiry_YYYY-MM-DD"
        if (realm.startsWith('expiry_')) {
            var d = realm.substring(7);
            if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return { baseRealm: '', hasExpiry: true, expiryDate: d };
        }
        return { baseRealm: realm, hasExpiry: false, expiryDate: null };
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
                    React.createElement(Button, { onClick: function() { onHistory && onHistory(cred); }, appearance: 'subtle', title: 'View history', icon: React.createElement(Clock, { variant: 'filled' }) }),
                    React.createElement(Button, { onClick: function() { onDelete && onDelete(cred); }, appearance: 'subtle', title: 'Delete credential', icon: React.createElement(TrashCanCross, { variant: 'filled' }) })
                )
            );
        }
        if (col.key === 'mtime') {
            return React.createElement(TableCell, {
                style: { fontSize: '12px', color: 'var(--ct-text-muted)', whiteSpace: 'nowrap' }
            }, formatMtime(cred.mtime));
        }
        if (col.key === 'realm') {
            var _parsed = _parseRealmForDisplay(cred.realm);
            var baseRealm = _parsed.baseRealm;
            var hasExpiry = _parsed.hasExpiry;
            var isGlobal = !baseRealm || baseRealm === 'nobody';

            var realmLabel;
            if (!isGlobal) {
                // Has a base realm — display it
                realmLabel = baseRealm;
            } else if (hasExpiry) {
                // No base realm but has expiry — show friendly expiry label
                var _ed = new Date(_parsed.expiryDate + 'T00:00:00');
                var _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                realmLabel = 'Exp: ' + _ed.getDate() + ' ' + _months[_ed.getMonth()] + ' ' + _ed.getFullYear();
            } else {
                realmLabel = 'global';
            }
            var realmActive = isFilterActive('realm', realmLabel);
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    onClick: function() { handleAddFilter('realm', realmLabel); },
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: realmActive ? 'var(--ct-pill-realm-active-bg)' : (isGlobal ? 'var(--ct-pill-realm-global-bg)' : 'var(--ct-pill-realm-bg)'),
                        color: realmActive ? 'var(--ct-pill-realm-active-color)' : (isGlobal ? 'var(--ct-pill-realm-global-color)' : 'var(--ct-pill-realm-color)'),
                        border: '1px solid ' + (realmActive ? 'var(--ct-pill-realm-active-border)' : (isGlobal ? 'var(--ct-pill-realm-global-border)' : 'var(--ct-pill-realm-border)')),
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                    }
                }, realmLabel)
            );
        }
        if (col.key === 'app') {
            var appLabel = cred.app || 'search';
            var appActive = isFilterActive('app', appLabel);
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    onClick: function() { handleAddFilter('app', appLabel); },
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: appActive ? 'var(--ct-pill-app-active-bg)' : 'var(--ct-pill-app-bg)',
                        color: appActive ? 'var(--ct-pill-app-active-color)' : 'var(--ct-pill-app-color)',
                        border: '1px solid ' + (appActive ? 'var(--ct-pill-app-active-border)' : 'var(--ct-pill-app-border)'),
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                    }
                }, appLabel)
            );
        }
        if (col.key === 'owner') {
            var ownerLabel = cred.namespaceOwner || cred.owner || '';
            var ownerActive = isFilterActive('owner', ownerLabel);
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    onClick: function() { handleAddFilter('owner', ownerLabel); },
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: ownerActive ? 'var(--ct-pill-owner-active-bg)' : 'var(--ct-pill-owner-bg)',
                        color: ownerActive ? 'var(--ct-pill-owner-active-color)' : 'var(--ct-pill-owner-color)',
                        border: '1px solid ' + (ownerActive ? 'var(--ct-pill-owner-active-border)' : 'var(--ct-pill-owner-border)'),
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                    }
                }, ownerLabel)
            );
        }
        if (col.key === 'aclRead' || col.key === 'aclWrite') {
            var roles = (cred[col.key] || '').split(',').map(function(r) { return r.trim(); }).filter(function(r) { return r; });
            var filterField = col.key === 'aclRead' ? 'readRoles' : 'writeRoles';
            var prefix = col.key === 'aclRead' ? 'read' : 'write';
            var c = {
                bg: 'var(--ct-pill-' + prefix + '-bg)',
                color: 'var(--ct-pill-' + prefix + '-color)',
                border: 'var(--ct-pill-' + prefix + '-border)',
                activeBg: 'var(--ct-pill-' + prefix + '-active-bg)',
                activeBorder: 'var(--ct-pill-' + prefix + '-active-border)',
            };
            return React.createElement(TableCell, null,
                React.createElement(
                    'div',
                    { style: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' } },
                    roles.map(function(role, i) {
                        var roleActive = isFilterActive(filterField, role);
                        return React.createElement('span', {
                            key: i,
                            onClick: function() { handleAddFilter(filterField, role); },
                            style: {
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: '600',
                                backgroundColor: roleActive ? c.activeBg : c.bg,
                                color: c.color,
                                border: '1px solid ' + (roleActive ? c.activeBorder : c.border),
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                            }
                        }, role);
                    })
                )
            );
        }
        if (col.key === 'name') {
            var nameLabel = cred[col.key] || '';
            var nameActive = isFilterActive('username', nameLabel);

            // Check if this credential has a duplicate password
            var dupInfo = null;
            if (duplicateInfo && duplicateInfo.duplicateCredentialMap) {
                var dupKey = (cred.name || '') + ':' + (cred.realm || '') + ':' + (cred.app || 'search') + ':' + (cred.namespaceOwner || cred.owner || 'nobody') + ':' + (cred.sharing || 'app');
                dupInfo = duplicateInfo.duplicateCredentialMap[dupKey] || null;
            }

            var nameCellChildren = [React.createElement('span', {
                key: 'label',
                onClick: function() { handleAddFilter('username', nameLabel); },
                style: {
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: '600',
                    backgroundColor: nameActive ? 'var(--ct-pill-name-active-bg)' : 'var(--ct-pill-name-bg)',
                    color: nameActive ? 'var(--ct-pill-name-active-color)' : 'var(--ct-pill-name-color)',
                    border: '1px solid ' + (nameActive ? 'var(--ct-pill-name-active-border)' : 'var(--ct-pill-name-border)'),
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                }
            }, nameLabel)];

            if (dupInfo) {
                nameCellChildren.push(React.createElement('span', {
                    key: 'dup',
                    title: 'Password shared with ' + dupInfo.count + ' other credential(s)',
                    style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        marginLeft: '4px',
                        color: '#f59e0b',
                        fontSize: '12px',
                        verticalAlign: 'middle',
                    }
                }, React.createElement(ExclamationTriangle, { size: 14 })));
            }

            // Expiry status indicator — clock icon color-coded by rotation status
            var _expiryStatus = cred.rotationStatus || 'none';
            if (_expiryStatus !== 'none') {
                var _expiryColors = {
                    ok:      '#2e7d32',
                    'due-soon': '#f59e0b',
                    overdue: '#d32f2f'
                };
                var _expiryColor = _expiryColors[_expiryStatus] || '#2e7d32';
                nameCellChildren.push(React.createElement('span', {
                    key: 'expiry',
                    title: cred.rotationLabel || (_expiryStatus + ' — click to filter'),
                    style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        marginLeft: '4px',
                        color: _expiryColor,
                        fontSize: '12px',
                        verticalAlign: 'middle',
                    }
                }, React.createElement(Clock, { size: 14 })));
            }

            return React.createElement(TableCell, null,
                React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '4px' }
                }, nameCellChildren)
            );
        }
        if (col.key === 'expiry') {
            var expiryInfo = _parseRealmForDisplay(cred.realm);
            var expiryDate = expiryInfo.expiryDate;
            if (!expiryDate) {
                var noneColor = '#9e9e9e';
                return React.createElement(TableCell, null,
                    React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: isDark ? noneColor + '22' : noneColor + '22',
                            color: noneColor,
                            border: '1px solid ' + (isDark ? noneColor + '88' : noneColor + '55'),
                            whiteSpace: 'nowrap',
                        }
                    }, 'None')
                );
            }
            var d = new Date(expiryDate + 'T00:00:00');
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            var dateStr = months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
            var status = cred.rotationStatus || 'none';
            var expiryColor = status === 'overdue' ? '#d32f2f' : status === 'due-soon' ? '#f59e0b' : '#0d8469';
            var expiryLabel = dateStr + (status === 'overdue' ? ' ⚠' : '');
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    onClick: function() { handleAddFilter('expiry', expiryDate); },
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: isDark ? expiryColor + '22' : expiryColor + '15',
                        color: expiryColor,
                        border: '1px solid ' + expiryColor + '40',
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                    }
                }, expiryLabel)
            );
        }
        if (col.key === 'rotation') {
            var status = cred.rotationStatus || 'none';
            var rotationMap = {
                ok:      { color: '#2e7d32', label: 'OK' },
                'due-soon': { color: '#f59e0b', label: 'Due Soon' },
                overdue: { color: '#d32f2f', label: 'Overdue' },
                none:    { color: '#9e9e9e', label: 'None' }
            };
            var rotation = rotationMap[status] || rotationMap.none;
            var labelText = cred.rotationLabel || rotation.label;
            return React.createElement(TableCell, null,
                React.createElement('span', {
                    onClick: function() { handleAddFilter('rotation', status); },
                    title: rotation.label,
                    style: {
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: isDark ? rotation.color + '33' : rotation.color + '22',
                        color: rotation.color,
                        border: '1px solid ' + (isDark ? rotation.color + '88' : rotation.color + '55'),
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                    }
                }, labelText)
            );
        }
        return React.createElement(TableCell, null, cred[col.key] || '');
    }

    // Determine rowSelection state for header checkbox
    var someSelected = paginatedCredentials.some(function(c) { return isSelected(c); });
    var allSelected = paginatedCredentials.length > 0 && paginatedCredentials.every(function(c) { return isSelected(c); });
    var rowSelectionState = allSelected ? 'all' : (someSelected ? 'some' : 'none');

    // Build header cells from visible columns
    var headerCells = visibleColumns.map(function(k, index) {
        var col = COLUMNS.find(function(c) { return c.key === k; });
        return buildHeaderCell(col, index);
    });

    // Build data rows
    var dataRows = paginatedCredentials.length > 0
        ? paginatedCredentials.map(function(cred) {
            return React.createElement(TableRow, {
                key: credKey(cred),
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
            React.createElement(TableCell, { colSpan: getColSpan(), style: { textAlign: 'center', padding: '2rem', color: 'var(--ct-empty-text)' } }, 'No credentials found')
        )];

    var labelStyle = { display: 'flex', alignItems: 'center', height: '28px', fontSize: '13px' };

    // Active filter pills row
    var activeFilterPills = activeFilters.length > 0 ? React.createElement(
        'div',
        { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.5rem' } },
        React.createElement(
            'span',
            { style: { fontSize: '12px', color: 'var(--ct-text-label)', marginRight: '4px' } },
            'Active filters:'
        ),
        activeFilters.map(function(f, i) {
            var fieldLabel = FILTER_FIELDS.find(function(ff) { return ff.key === f.field; });
            return React.createElement(
                'span',
                {
                    key: i,
                    style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: 'var(--ct-filter-pill-bg)',
                        color: 'var(--ct-filter-pill-color)',
                        border: '1px solid var(--ct-filter-pill-border)',
                        whiteSpace: 'nowrap',
                    }
                },
                React.createElement('span', null, (fieldLabel ? fieldLabel.label : f.field) + ': ' + f.value),
                React.createElement(
                    'span',
                    {
                        onClick: function() { handleRemoveFilter(i); },
                        style: { cursor: 'pointer', fontWeight: 'bold', marginLeft: '2px', fontSize: '13px' }
                    },
                    '\u00d7'
                )
            );
        }),
        React.createElement(
            'span',
            {
                onClick: handleClearFilters,
                style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '2px 8px',
                    fontSize: '11px',
                    fontWeight: '500',
                    color: 'var(--ct-clear-text)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    marginLeft: '8px',
                }
            },
            'Clear all'
        )
    ) : null;

    // Detect dark theme at render time — ThemeAwareApp syncs .dark-theme to document.documentElement
    var isDark = document.documentElement.classList.contains('dark-theme') ||
        document.documentElement.classList.contains('theme-dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        (document.body && document.body.classList.contains('dark-theme'));

    // Inject theme-aware CSS custom properties — inline variables so they resolve at render time
    var themeStyles = React.createElement('style', null,
        '.credential-table-container {',
        '  --ct-text: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --ct-text-muted: ' + (isDark ? '#aaa' : '#666') + ';',
        '  --ct-text-label: ' + (isDark ? '#bbb' : '#555') + ';',
        '  --ct-border: ' + (isDark ? '#555' : '#ccc') + ';',
        '  --ct-header-bg: ' + (isDark ? '#15191e' : '#f5f5f5') + ';',
        '  --ct-header-color: ' + (isDark ? '#e0e0e0' : '#333') + ';',
        '  --ct-pill-realm-bg: ' + (isDark ? '#0d47a1' : '#e3f2fd') + '; --ct-pill-realm-color: ' + (isDark ? '#bbdefb' : '#1565c0') + '; --ct-pill-realm-border: ' + (isDark ? '#42a5f5' : '#90caf9') + ';',
        '  --ct-pill-realm-global-bg: ' + (isDark ? '#37474f' : '#f5f5f5') + '; --ct-pill-realm-global-color: ' + (isDark ? '#b0bec5' : '#757575') + '; --ct-pill-realm-global-border: ' + (isDark ? '#546e7a' : '#e0e0e0') + ';',
        '  --ct-pill-realm-active-bg: ' + (isDark ? '#1565c0' : '#bbdefb') + '; --ct-pill-realm-active-color: ' + (isDark ? '#e3f2fd' : '#0d47a1') + '; --ct-pill-realm-active-border: ' + (isDark ? '#64b5f6' : '#1565c0') + ';',
        '  --ct-pill-app-bg: ' + (isDark ? '#1b5e20' : '#e8f5e9') + '; --ct-pill-app-color: ' + (isDark ? '#a5d6a7' : '#2e7d32') + '; --ct-pill-app-border: ' + (isDark ? '#66bb6a' : '#a5d6a7') + ';',
        '  --ct-pill-app-active-bg: ' + (isDark ? '#2e7d32' : '#a5d6a7') + '; --ct-pill-app-active-color: ' + (isDark ? '#e8f5e9' : '#1b5e20') + '; --ct-pill-app-active-border: ' + (isDark ? '#81c784' : '#2e7d32') + ';',
        '  --ct-pill-owner-bg: ' + (isDark ? '#4e342e' : '#fff3e0') + '; --ct-pill-owner-color: ' + (isDark ? '#ffcc80' : '#e65100') + '; --ct-pill-owner-border: ' + (isDark ? '#ffa726' : '#ffcc80') + ';',
        '  --ct-pill-owner-active-bg: ' + (isDark ? '#6d4c41' : '#ffe0b2') + '; --ct-pill-owner-active-color: ' + (isDark ? '#ffe0b2' : '#e65100') + '; --ct-pill-owner-active-border: ' + (isDark ? '#ffb74d' : '#e65100') + ';',
        '  --ct-pill-name-bg: ' + (isDark ? '#1a237e' : '#e8eaf6') + '; --ct-pill-name-color: ' + (isDark ? '#c5cae9' : '#283593') + '; --ct-pill-name-border: ' + (isDark ? '#5c6bc0' : '#9fa8da') + ';',
        '  --ct-pill-name-active-bg: ' + (isDark ? '#283593' : '#c5cae9') + '; --ct-pill-name-active-color: ' + (isDark ? '#e8eaf6' : '#1a237e') + '; --ct-pill-name-active-border: ' + (isDark ? '#7986cb' : '#283593') + ';',
        '  --ct-pill-read-bg: ' + (isDark ? '#4a148c' : '#f3e5f5') + '; --ct-pill-read-color: ' + (isDark ? '#e1bee7' : '#7b1fa2') + '; --ct-pill-read-border: ' + (isDark ? '#ab47bc' : '#ce93d8') + ';',
        '  --ct-pill-read-active-bg: ' + (isDark ? '#6a1b9a' : '#e1bee7') + '; --ct-pill-read-active-color: ' + (isDark ? '#f3e5f5' : '#7b1fa2') + '; --ct-pill-read-active-border: ' + (isDark ? '#ba68c8' : '#7b1fa2') + ';',
        '  --ct-pill-write-bg: ' + (isDark ? '#b71c1c' : '#fce4ec') + '; --ct-pill-write-color: ' + (isDark ? '#f8bbd0' : '#c62828') + '; --ct-pill-write-border: ' + (isDark ? '#e57373' : '#f48fb1') + ';',
        '  --ct-pill-write-active-bg: ' + (isDark ? '#c62828' : '#f8bbd0') + '; --ct-pill-write-active-color: ' + (isDark ? '#fce4ec' : '#c62828') + '; --ct-pill-write-active-border: ' + (isDark ? '#ef9a9a' : '#c62828') + ';',
        '  --ct-filter-pill-bg: ' + (isDark ? '#0a2a66' : '#e3f2fd') + '; --ct-filter-pill-color: ' + (isDark ? '#90caf9' : '#1565c0') + '; --ct-filter-pill-border: ' + (isDark ? '#1e88e5' : '#90caf9') + ';',
        '  --ct-clear-text: ' + (isDark ? '#999' : '#888') + ';',
        '  --ct-empty-text: ' + (isDark ? '#aaa' : '#666') + ';',
        '  --ct-body-bg: ' + (isDark ? '#15191e' : '#fff') + ';',
        '}',
        // Force header row dark styling — targets Splunk's generated HeadCell class names
        '.credential-table-container table thead th, .credential-table-container table thead th [class*="HeadCell"] {',
        '  background-color: var(--ct-header-bg) !important;',
        '  color: var(--ct-header-color) !important;',
        '}',
        // Also set bg on nested sc- classes, but NOT inside the toggle-all cell
        // (its checkbox uses the same sc- class pattern and needs its checked-state accent color)
        '.credential-table-container table thead th:not([data-test="toggle-all"]) [class*="sc-"] {',
        '  background-color: var(--ct-header-bg) !important;',
        '  color: var(--ct-header-color) !important;',
        '}'
    );

    return React.createElement(
        'div',
        { className: 'credential-table-container' },
        themeStyles,
        // Active filter pills row
        activeFilterPills,

        // Search + pagination controls
        React.createElement(
            'div',
            { style: { marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' } },
            React.createElement('strong', { style: labelStyle }, 'Search:'),
            React.createElement('input', {
                type: 'text',
                value: filterText,
                onChange: function(e) { handleFilterChange(e.target.value); },
                placeholder: 'Search across all fields...',
                style: {
                    padding: '0.25rem 0.5rem',
                    border: '1px solid var(--ct-border)',
                    borderRadius: '4px',
                    minWidth: '200px',
                    fontSize: '13px',
                    height: '28px',
                    boxSizing: 'border-box',
                },
            }),
            // Expiry filter toggles — inline near search input
            React.createElement(
                'div',
                { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
                // Duplicates only toggle
                duplicateInfo && duplicateInfo.totalDuplicates > 0 && React.createElement(
                    'button',
                    {
                        onClick: function() {
                            var dupFilterExists = activeFilters.some(function(f) { return f.field === 'isDuplicate'; });
                            if (dupFilterExists) {
                                handleRemoveFilter(activeFilters.findIndex(function(f) { return f.field === 'isDuplicate'; }));
                            } else {
                                handleAddFilter('isDuplicate', 'true');
                            }
                        },
                        style: {
                            margin: 0,
                            padding: '0.25rem 0.75rem',
                            border: activeFilters.some(function(f) { return f.field === 'isDuplicate'; })
                                ? '2px solid #f59e0b'
                                : '1px solid var(--ct-border)',
                            borderRadius: '4px',
                            fontSize: '13px',
                            height: '28px',
                            boxSizing: 'border-box',
                            backgroundColor: activeFilters.some(function(f) { return f.field === 'isDuplicate'; })
                                ? '#fef3c7'
                                : 'transparent',
                            color: activeFilters.some(function(f) { return f.field === 'isDuplicate'; })
                                ? '#92400e'
                                : 'var(--ct-text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: activeFilters.some(function(f) { return f.field === 'isDuplicate'; }) ? '600' : 'normal',
                            lineHeight: 'normal',
                            verticalAlign: 'middle',
                        },
                        title: 'Filter to show only credentials with duplicate passwords'
                    },
                    React.createElement(ExclamationTriangle, { variant: 'filled', size: 12, style: { color: '#f59e0b' } }),
                    'Duplicates only'
                ),
                // Expired only toggle
                hasExpiredCredentials && React.createElement(
                    'button',
                    {
                        onClick: function() {
                            var expiredFilterExists = activeFilters.some(function(f) { return f.field === 'isExpired'; });
                            if (expiredFilterExists) {
                                handleRemoveFilter(activeFilters.findIndex(function(f) { return f.field === 'isExpired'; }));
                            } else {
                                handleAddFilter('isExpired', 'true');
                            }
                        },
                        style: {
                            margin: 0,
                            padding: '0.25rem 0.75rem',
                            border: activeFilters.some(function(f) { return f.field === 'isExpired'; })
                                ? '2px solid #d32f2f'
                                : '1px solid var(--ct-border)',
                            borderRadius: '4px',
                            fontSize: '13px',
                            height: '28px',
                            boxSizing: 'border-box',
                            backgroundColor: activeFilters.some(function(f) { return f.field === 'isExpired'; })
                                ? '#fde7e9'
                                : 'transparent',
                            color: activeFilters.some(function(f) { return f.field === 'isExpired'; })
                                ? '#741c1c'
                                : 'var(--ct-text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: activeFilters.some(function(f) { return f.field === 'isExpired'; }) ? '600' : 'normal',
                            lineHeight: 'normal',
                            verticalAlign: 'middle',
                        },
                        title: 'Filter to show only expired or expiring soon credentials'
                    },
                    React.createElement(Clock, { variant: 'filled', size: 12, style: { color: '#d32f2f' } }),
                    'Expired only'
                )
            ),

            React.createElement('div', { style: { marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'baseline' } },
                // Column Presets button — opens preset management modal
                onOpenPresetModal && React.createElement(Button, {
                    onClick: function() { onOpenPresetModal(); },
                    appearance: 'subtle',
                    children: 'Column Presets'
                }),
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
                    style: { padding: '0.25rem 0.5rem', border: '1px solid var(--ct-border)', borderRadius: '4px', fontSize: '13px', height: '28px', boxSizing: 'border-box' },
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
            onRequestMoveColumn: handleRequestMoveColumn,
        },
            React.createElement(TableHead, null, ...headerCells),
            React.createElement(TableBody, { key: currentPage }, ...dataRows)
        ),

        // Row count + Pagination
        React.createElement(
            'div',
            { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--ct-text-muted)' } },
                sortedCredentials.length === 0
                    ? 'No credentials'
                    : 'Showing ' + ((currentPage - 1) * rowsPerPage + 1) + '-' + Math.min(currentPage * rowsPerPage, sortedCredentials.length) + ' of ' + sortedCredentials.length + ' credential' + (sortedCredentials.length !== 1 ? 's' : '')
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
