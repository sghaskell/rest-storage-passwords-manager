/**
 * CredentialHistoryModal.jsx - Per-credential audit history modal
 *
 * Shows the complete audit trail for a single credential — every create,
 * edit, delete, and ACL change — in chronological order with human-readable
 * descriptions.
 */

const React = require('react');
const SplunkModalMod = require('@splunk/react-ui/Modal');
var SplunkModal = SplunkModalMod.default;
SplunkModalMod.Header && (SplunkModal.Header = SplunkModalMod.Header);
SplunkModalMod.Body && (SplunkModal.Body = SplunkModalMod.Body);
SplunkModalMod.Footer && (SplunkModal.Footer = SplunkModalMod.Footer);
const ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

const SelectMod = require('@splunk/react-ui/Select');
var Selector = SelectMod.default;
var SelectOption = SelectMod.Option;

var TableMod = require('@splunk/react-ui/Table');
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;
var Table = TableMod.default;

var API = require('../api');

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
    EDIT_PASSWORD: 'Password Changed',
    REMOVE_PASSWORD: 'Deleted',
    ACL_EDIT: 'Permissions Changed',
};

function getActionLabel(action) {
    return ACTION_LABELS[action] || (action || 'Unknown');
}

// Strip leading/trailing colons from credential IDs (e.g., ":scotty:" → "scotty")
function formatCredential(cred) {
    if (!cred) return '';
    return cred.replace(/^:+|:+$/g, '');
}

// Format ISO timestamp to readable date
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

// Parse app from info field: info="app=\"search\"" → "search"
function parseAppFromInfo(info) {
    if (!info) return '';
    var match = info.match(/app="([^"]*)"/);
    return match ? match[1] : '';
}

// Column definitions
var HISTORY_COLUMNS = [
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'user', label: 'User' },
    { key: 'action', label: 'Action' },
    { key: 'info', label: 'Details' },
];

function CredentialHistoryModal({ credential, isOpen, onClose }) {
    const [historyData, setHistoryData] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [timeRange, setTimeRange] = React.useState(604800000); // default 7 days

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
    }, [isOpen]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    function fetchHistory() {
        if (!credential || !isOpen) return;
        setLoading(true);
        setError(null);
        API.fetchCredentialHistory(credential.name, credential.realm || '', timeRange)
            .then(function(results) {
                setHistoryData(results);
                setError(null);
            })
            .catch(function(err) {
                console.error('Credential history fetch error:', err);
                setError(err.message || 'Failed to fetch history');
                setHistoryData([]);
            })
            .finally(function() {
                setLoading(false);
            });
    }

    // Load on open
    React.useEffect(function() {
        if (isOpen && credential) {
            fetchHistory();
        }
    }, [isOpen, credential, timeRange]);

    function handleTimeRangeChange(e, data) {
        var val = data && data.value != null ? data.value : timeRange;
        setTimeRange(val);
    }

    if (!credential) return null;

    var realmLabel = !credential.realm || credential.realm === 'nobody' ? 'global' : (credential.realm || '');
    var modalTitle = 'History for ' + (credential.name || '') + ' (' + realmLabel + ')';

    // Header cells
    var headerCells = HISTORY_COLUMNS.map(function(col) {
        return React.createElement(TableHeadCell, { key: col.key }, col.label);
    });

    // Data rows
    var dataRows;
    if (historyData.length === 0) {
        var emptyLabel = loading
            ? 'Loading history...'
            : 'No history found for this credential in the selected time range';
        dataRows = [React.createElement(TableRow, { key: 'empty' },
            React.createElement(TableCell, {
                colSpan: HISTORY_COLUMNS.length,
                style: { textAlign: 'center', padding: '2rem', color: '#666' }
            }, emptyLabel)
        )];
    } else {
        dataRows = historyData.map(function(entry, i) {
            return React.createElement(TableRow, { key: i },
                React.createElement(TableCell, {
                    style: { fontSize: '12px', color: '#666', whiteSpace: 'nowrap' }
                }, formatTimestamp(entry.timestamp)),
                React.createElement(TableCell, null, entry.user || ''),
                React.createElement(TableCell, null, getActionLabel(entry.action)),
                React.createElement(TableCell, {
                    style: { fontSize: '12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    title: entry.info || ''
                }, entry.info || '')
            );
        });
    }

    return React.createElement(SplunkModal, {
        open: true,
        onRequestClose: function() { onClose && onClose(); },
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '700px', maxWidth: '95%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0 } }, modalTitle),
                React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' } },
                    React.createElement('strong', { style: { fontSize: '13px' } }, 'Time Range:'),
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
                    }))
                )
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '60vh', overflowY: 'auto' } },
                error ? React.createElement('div', {
                    style: {
                        padding: '1rem',
                        border: '1px solid #d32f2f',
                        borderRadius: '4px',
                        backgroundColor: '#ffebee',
                        color: '#d32f2f',
                        marginBottom: '1rem',
                    }
                }, error) : null,
                React.createElement(Table, {
                    outerStyle: { width: '100%' },
                    tableStyle: { width: '100%' },
                    stripeRows: true,
                },
                    React.createElement(TableHead, null, ...headerCells),
                    React.createElement(TableBody, null, ...dataRows)
                )
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                React.createElement(Button, {
                    onClick: fetchHistory,
                    appearance: 'subtle',
                    disabled: loading,
                    children: loading ? 'Loading...' : 'Refresh'
                }),
                React.createElement(Button, {
                    onClick: onClose,
                    children: 'Close'
                })
            )
        )
    );
}

module.exports = CredentialHistoryModal;
