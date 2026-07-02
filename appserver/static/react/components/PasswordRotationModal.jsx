/**
 * PasswordRotationModal.jsx - Bulk password rotation modal
 *
 * Three-phase flow:
 *   A. Settings — password generator options, mode selector
 *   B. Preview — show generated passwords before applying
 *   C. Results — success/failure per credential with undo
 */

const React = require('react');
const SplunkModalMod = require('@splunk/react-ui/Modal');
var SplunkModal = SplunkModalMod.default;
SplunkModalMod.Header && (SplunkModal.Header = SplunkModalMod.Header);
SplunkModalMod.Body && (SplunkModal.Body = SplunkModalMod.Body);
SplunkModalMod.Footer && (SplunkModal.Footer = SplunkModalMod.Footer);
const ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;

var TableMod = require('@splunk/react-ui/Table');
var TableHead = TableMod.Head;
var TableBody = TableMod.Body;
var TableCell = TableMod.Cell;
var TableRow = TableMod.Row;
var TableHeadCell = TableMod.HeadCell;
var Table = TableMod.default;

var API = require('../api');

// ─── Phase A: Settings ───

function RotationSettings({ onPreview, onExecute }) {
    const [length, setLength] = React.useState(16);
    const [upper, setUpper] = React.useState(true);
    const [lower, setLower] = React.useState(true);
    const [nums, setNums] = React.useState(true);
    const [syms, setSyms] = React.useState(true);
    const [mode, setMode] = React.useState('individual'); // 'individual' | 'shared'
    const [expiryStrategy, setExpiryStrategy] = React.useState('extend-original');
    const [customExpiryDate, setCustomExpiryDate] = React.useState('');

    var genOpts = {
        length: length,
        uppercase: upper,
        lowercase: lower,
        numbers: nums,
        symbols: syms,
    };

    function handlePreview() {
        onPreview(genOpts, mode, expiryStrategy, customExpiryDate);
    }

    function handleExecute() {
        onExecute(genOpts, mode, expiryStrategy, customExpiryDate);
    }

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '1rem' } },

        // Password length
        React.createElement('div', null,
            React.createElement('label', { style: { fontSize: '13px', fontWeight: '500', marginBottom: '0.25rem', display: 'block' } },
                'Password Length: ' + length
            ),
            React.createElement('input', {
                type: 'range',
                min: 8,
                max: 64,
                value: length,
                onChange: function(e) { setLength(parseInt(e.target.value)); },
                style: { width: '100%' }
            })
        ),

        // Character set
        React.createElement('div', null,
            React.createElement('label', { style: { fontSize: '13px', fontWeight: '500', marginBottom: '0.25rem', display: 'block' } },
                'Character Set'
            ),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
                React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: upper,
                        onChange: function() { setUpper(function(p) { return !p; }); },
                    }),
                    ' Uppercase (A-Z)'
                ),
                React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: lower,
                        onChange: function() { setLower(function(p) { return !p; }); },
                    }),
                    ' Lowercase (a-z)'
                ),
                React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: nums,
                        onChange: function() { setNums(function(p) { return !p; }); },
                    }),
                    ' Numbers (0-9)'
                ),
                React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: syms,
                        onChange: function() { setSyms(function(p) { return !p; }); },
                    }),
                    ' Symbols (!@#$%^&*...)'
                )
            )
        ),

        // Mode selector
        React.createElement('div', null,
            React.createElement('label', { style: { fontSize: '13px', fontWeight: '500', marginBottom: '0.25rem', display: 'block' } },
                'Password Mode'
            ),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.4rem' } },
                React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'radio',
                        name: 'rotation-mode',
                        checked: mode === 'individual',
                        onChange: function() { setMode('individual'); },
                    }),
                    ' Individual — unique password per credential'
                ),
                React.createElement('label', { style: { fontSize: '13px', cursor: 'pointer' } },
                    React.createElement('input', {
                        type: 'radio',
                        name: 'rotation-mode',
                        checked: mode === 'shared',
                        onChange: function() { setMode('shared'); },
                    }),
                    ' Shared — same password for all credentials'
                )
            )
        ),

        // Expiry strategy — inline preset row + date picker
        React.createElement('div', { style: { display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement('label', { style: { fontSize: '13px', fontWeight: '500', marginRight: '0.25rem', whiteSpace: 'nowrap' } },
                'Expiry:'
            ),
            React.createElement('input', {
                type: 'date',
                value: expiryStrategy === 'custom' ? customExpiryDate : '',
                onChange: function(e) {
                    setExpiryStrategy('custom');
                    setCustomExpiryDate(e.target.value);
                },
                style: {
                    padding: '4px 8px',
                    fontSize: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    height: '28px',
                    boxSizing: 'border-box',
                }
            }),
            ['extend-original', '7', '30', '60', '90', '180', 'keep-current'].map(function(strat) {
                var labels = {
                    'extend-original': 'Auto',
                    '7': '7d',
                    '30': '30d',
                    '60': '60d',
                    '90': '90d',
                    '180': '180d',
                    'keep-current': '—',
                };
                var titles = {
                    'extend-original': 'Extend by original period',
                    '7': '7 days from now',
                    '30': '30 days from now',
                    '60': '60 days from now',
                    '90': '90 days from now',
                    '180': '180 days from now',
                    'keep-current': 'Keep current (no change)',
                };
                return React.createElement(Button, {
                    key: strat,
                    type: 'button',
                    onClick: function() { setExpiryStrategy(strat); setCustomExpiryDate(''); },
                    appearance: expiryStrategy === strat ? 'primary' : 'subtle',
                    title: titles[strat],
                    style: { padding: '4px 10px', fontSize: '12px', height: '28px', lineHeight: '1' },
                    children: labels[strat],
                });
            }),
        ),

        // Action buttons
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' } },
            React.createElement(Button, {
                onClick: handlePreview,
                appearance: 'subtle',
                children: 'Preview'
            }),
            React.createElement(Button, {
                onClick: handleExecute,
                appearance: 'primary',
                children: 'Execute Rotation'
            })
        )
    );
}

// ─── Phase B: Preview ───

function RotationPreview({ selectedRows, generatorOptions, mode, onBack, onExecute }) {
    const [passwords, setPasswords] = React.useState({});
    const [revealed, setRevealed] = React.useState({});
    const [copied, setCopied] = React.useState(false);

    // Generate passwords on mount
    React.useEffect(function() {
        var pwMap = {};
        var sharedPw = null;
        selectedRows.forEach(function(cred) {
            var key = cred.stanzaKey + ':' + cred.app + ':' + cred.owner + ':' + cred.sharing;
            if (mode === 'shared') {
                if (!sharedPw) sharedPw = API.generatePassword(generatorOptions);
                pwMap[key] = sharedPw;
            } else {
                pwMap[key] = API.generatePassword(generatorOptions);
            }
        });
        setPasswords(pwMap);
    }, [selectedRows, generatorOptions, mode]);

    function toggleReveal(key) {
        setRevealed(function(prev) {
            var next = Object.assign({}, prev);
            next[key] = !prev[key];
            return next;
        });
    }

    function toggleAll() {
        var allRevealed = selectedRows.every(function(cred) {
            var key = cred.stanzaKey + ':' + cred.app + ':' + cred.owner + ':' + cred.sharing;
            return revealed[key];
        });
        var next = {};
        selectedRows.forEach(function(cred) {
            var key = cred.stanzaKey + ':' + cred.app + ':' + cred.owner + ':' + cred.sharing;
            next[key] = !allRevealed;
        });
        setRevealed(next);
    }

    function copyAllPasswords() {
        var lines = selectedRows.map(function(cred) {
            var key = cred.stanzaKey + ':' + cred.app + ':' + cred.owner + ':' + cred.sharing;
            return cred.name + '\t' + (passwords[key] || '');
        });
        var text = 'Username\tNew Password\n' + lines.join('\n');
        navigator.clipboard.writeText(text).catch(function() {});
        setCopied(true);
        setTimeout(function() { setCopied(false); }, 2000);
    }

    // Header cells
    var headerCells = [
        React.createElement(TableHeadCell, { key: 'name' }, 'Credential'),
        React.createElement(TableHeadCell, { key: 'app' }, 'App'),
        React.createElement(TableHeadCell, { key: 'realm' }, 'Realm'),
        React.createElement(TableHeadCell, { key: 'newPassword' }, 'New Password'),
    ];

    // Data rows
    var dataRows = selectedRows.map(function(cred) {
        var key = cred.stanzaKey + ':' + cred.app + ':' + cred.owner + ':' + cred.sharing;
        var pw = passwords[key] || '';
        var isRevealed = !!revealed[key];
        var realmLabel = !cred.realm || cred.realm === 'nobody' ? 'global' : (cred.realm || '');
        return React.createElement(TableRow, { key: key },
            React.createElement(TableCell, null, cred.name),
            React.createElement(TableCell, null, cred.app || ''),
            React.createElement(TableCell, null, realmLabel),
            React.createElement(TableCell, {
                style: { fontFamily: 'monospace', fontSize: '12px', cursor: 'pointer' },
                onClick: function() { toggleReveal(key); }
            }, isRevealed ? pw : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')
        );
    });

    return React.createElement('div', null,
        React.createElement('p', { style: { fontSize: '13px', color: '#666', marginBottom: '0.75rem' } },
            mode === 'shared'
                ? 'All ' + selectedRows.length + ' credentials will share the same password. Click a password to reveal/hide.'
                : 'Each credential gets a unique password. Click a password to reveal/hide.'
        ),
        React.createElement('div', { style: { maxHeight: '40vh', overflowY: 'auto', marginBottom: '1rem' } },
            React.createElement(Table, {
                outerStyle: { width: '100%' },
                tableStyle: { width: '100%' },
                stripeRows: true,
            },
                React.createElement(TableHead, null, ...headerCells),
                React.createElement(TableBody, null, ...dataRows)
            )
        ),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' } },
            React.createElement(Button, {
                onClick: toggleAll,
                appearance: 'subtle',
                children: 'Toggle All'
            }),
            React.createElement(Button, {
                onClick: copyAllPasswords,
                appearance: copied ? 'primary' : 'subtle',
                children: copied ? 'Copied!' : 'Copy All'
            }),
            React.createElement(Button, {
                onClick: onBack,
                appearance: 'subtle',
                children: 'Back'
            }),
            React.createElement(Button, {
                onClick: onExecute,
                appearance: 'primary',
                children: 'Execute Rotation'
            })
        )
    );
}

// ─── Phase C: Results ───

function RotationResults({ results, onUndo, onExpire, onClose }) {
    const [secondsLeft, setSecondsLeft] = React.useState(10);
    const [canUndo, setCanUndo] = React.useState(true);
    const [undone, setUndone] = React.useState(false);

    // Countdown timer
    React.useEffect(function() {
        if (!canUndo || undone) return;
        if (secondsLeft <= 0) {
            setCanUndo(false);
            if (onExpire) onExpire();
            return;
        }
        var timer = setTimeout(function() {
            setSecondsLeft(function(prev) { return prev - 1; });
        }, 1000);
        return function() { clearTimeout(timer); };
    }, [secondsLeft, canUndo, undone]);

    var successCount = results.filter(function(r) { return r.status === 'success'; }).length;
    var failCount = results.filter(function(r) { return r.status === 'failed'; }).length;
    var hasSuccess = successCount > 0;
    var allFailed = failCount === results.length && results.length > 0;

    // Header cells
    var headerCells = [
        React.createElement(TableHeadCell, { key: 'name' }, 'Credential'),
        React.createElement(TableHeadCell, { key: 'app' }, 'App'),
        React.createElement(TableHeadCell, { key: 'status' }, 'Status'),
        React.createElement(TableHeadCell, { key: 'error' }, 'Details'),
    ];

    // Data rows
    var dataRows = results.map(function(r, i) {
        var isOk = r.status === 'success';
        var realmLabel = !r.realm || r.realm === 'nobody' ? 'global' : (r.realm || '');
        return React.createElement(TableRow, { key: i },
            React.createElement(TableCell, null, r.name || ''),
            React.createElement(TableCell, null, r.app || realmLabel),
            React.createElement(TableCell, {
                style: { fontWeight: '600', color: isOk ? '#2e7d32' : '#d32f2f' }
            }, isOk ? 'Success' : 'Failed'),
            React.createElement(TableCell, {
                style: { fontSize: '12px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isOk ? '#666' : '#d32f2f' },
                title: r.error || ''
            }, isOk ? realmLabel : (r.error || ''))
        );
    });

    var statusSummary = successCount + ' succeeded' + (failCount > 0 ? ', ' + failCount + ' failed' : '');

    return React.createElement('div', null,
        React.createElement('p', { style: { fontSize: '13px', color: '#666', marginBottom: '0.75rem' } }, statusSummary),
        React.createElement('div', { style: { maxHeight: '40vh', overflowY: 'auto', marginBottom: '1rem' } },
            React.createElement(Table, {
                outerStyle: { width: '100%' },
                tableStyle: { width: '100%' },
                stripeRows: true,
            },
                React.createElement(TableHead, null, ...headerCells),
                React.createElement(TableBody, null, ...dataRows)
            )
        ),
        React.createElement('div', { style: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' } },
            canUndo && hasSuccess && !undone && React.createElement(Button, {
                onClick: function() { setUndone(true); onUndo(); },
                appearance: 'primary',
                children: 'Undo (' + secondsLeft + 's)'
            }),
            React.createElement(Button, {
                onClick: onClose,
                appearance: 'subtle',
                children: 'Close'
            })
        )
    );
}

// ─── Main modal component ───

function PasswordRotationModal({ selectedRows, isOpen, onClose, onApply }) {
    const [phase, setPhase] = React.useState('settings'); // 'settings' | 'preview' | 'results' | 'executing'
    const [generatorOptions, setGeneratorOptions] = React.useState({});
    const [expiryStrategy, setExpiryStrategy] = React.useState('extend-original');
    const [customExpiryDate, setCustomExpiryDate] = React.useState('');
    const [rotationMode, setRotationMode] = React.useState('individual');
    const [results, setResults] = React.useState([]);
    const [progress, setProgress] = React.useState({ current: 0, total: 0 });
    const [undoEntries, setUndoEntries] = React.useState([]);

    var prevRef = React.useRef(null);
    React.useEffect(function() {
        prevRef.current = document.activeElement;
    }, [isOpen]);

    function handleReturnFocus() {
        if (prevRef.current && typeof prevRef.current.focus === 'function') {
            prevRef.current.focus();
        }
    }

    // Reset when modal opens
    React.useEffect(function() {
        if (isOpen) {
            setPhase('settings');
            setResults([]);
            setUndoEntries([]);
            setProgress({ current: 0, total: selectedRows.length });
        }
    }, [isOpen]);

    function handlePreview(genOpts, mode, strategy, customDate) {
        setGeneratorOptions(genOpts);
        setRotationMode(mode);
        setExpiryStrategy(strategy);
        setCustomExpiryDate(customDate);
        setPhase('preview');
    }

    function handleBack() {
        setPhase('settings');
    }

    async function handleExecuteFromPreview() {
        setPhase('executing');
        setProgress({ current: 0, total: selectedRows.length });
        await runRotation(rotationMode, generatorOptions, expiryStrategy, customExpiryDate);
    }

    async function handleExecuteFromSettings(genOpts, mode, strategy, customDate) {
        setGeneratorOptions(genOpts);
        setRotationMode(mode);
        setExpiryStrategy(strategy);
        setCustomExpiryDate(customDate);
        setPhase('executing');
        setProgress({ current: 0, total: selectedRows.length });
        await runRotation(mode, genOpts, strategy, customDate);
    }

    async function runRotation(mode, genOpts, strategy, customDate) {
        try {
            var rotResults = await API.rotatePasswords(selectedRows, {
                mode: mode,
                generatorOptions: genOpts,
                expiryStrategy: strategy,
                customExpiryDate: customDate,
            });

            // Build undo entries from successful rotations
            var undoCreds = rotResults.filter(function(r) { return r.status === 'success'; }).map(function(r) {
                var idx = rotResults.indexOf(r);
                var orig = selectedRows[idx];
                return {
                    name: r.name,
                    realm: r.realm || '',
                    app: r.app || '',
                    namespaceOwner: (orig && orig.namespaceOwner) || 'nobody',
                    owner: (orig && orig.owner) || 'nobody',
                    sharing: (orig && orig.sharing) || 'app',
                    aclRead: (orig && orig.aclRead) || '',
                    aclWrite: (orig && orig.aclWrite) || '',
                    _password: r.oldPassword,
                };
            });

            setResults(rotResults);
            setUndoEntries(undoCreds);
            setPhase('results');

            // Refresh credentials in background
            if (onApply) onApply(rotResults);
        } catch (err) {
            console.error('Rotation failed:', err);
            setResults([{
                name: '(batch)',
                realm: '',
                app: '',
                oldPassword: null,
                newPassword: null,
                status: 'failed',
                error: 'Rotation failed: ' + (err.message || 'unknown error')
            }]);
            setPhase('results');
        }
    }

    async function handleUndo() {
        if (!undoEntries.length) return;
        var entries = undoEntries;
        setUndoEntries([]);

        try {
            // Sort: nobody first, then other owners (same pattern as handleUndoDelete)
            var sorted = entries.slice().sort(function(a, b) {
                var aO = a.namespaceOwner || a.owner || 'nobody';
                var bO = b.namespaceOwner || b.owner || 'nobody';
                if (aO === 'nobody') return -1;
                if (bO === 'nobody') return 1;
                return 0;
            });

            var undoResults = [];
            for (var i = 0; i < sorted.length; i++) {
                var cred = sorted[i];
                if (!cred._password) continue;
                try {
                    await API.updateCredential(
                        cred.name, cred.realm, cred._password,
                        cred.aclRead ? cred.aclRead.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
                        cred.aclWrite ? cred.aclWrite.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [],
                        cred.namespaceOwner || cred.owner, cred.app, cred.sharing, cred.app
                    );
                    undoResults.push({ name: cred.name, status: 'fulfilled' });
                } catch (e) {
                    undoResults.push({ name: cred.name, status: 'rejected', reason: e });
                }
            }

            // Call onApply to refresh credentials
            if (onApply) onApply(results, undoResults);

            // Update results to show undo status
            setResults(function(prev) {
                var updated = prev.slice();
                undoResults.forEach(function(ur, j) {
                    var cred = sorted[j];
                    var idx = updated.findIndex(function(r) { return r.name === cred.name; });
                    if (idx >= 0) {
                        updated[idx] = Object.assign({}, updated[idx], {
                            status: ur.status === 'fulfilled' ? 'success' : 'failed',
                            error: ur.status === 'fulfilled'
                                ? '(undone — old password restored)'
                                : 'Undo failed: ' + (ur.reason && ur.reason.message || 'unknown error'),
                        });
                    }
                });
                return updated;
            });

            // Close modal after undo completes
            handleClose();
        } catch (err) {
            console.error('Undo failed:', err);
        }
    }

    function handleClose() {
        setPhase('settings');
        setResults([]);
        setUndoEntries([]);
        onClose();
    }

    function handleExpire() {
        // Undo window expired — clear undo entries
        setUndoEntries([]);
    }

    if (!isOpen) return null;

    var modalTitle = phase === 'results' ? 'Rotation Results' :
                     phase === 'executing' ? 'Rotating Passwords...' :
                     'Rotate Passwords (' + (selectedRows ? selectedRows.length : 0) + ')';

    return React.createElement(SplunkModal, {
        open: true,
        onRequestClose: handleClose,
        returnFocus: handleReturnFocus,
        divider: 'both',
        style: { width: '700px', maxWidth: '95%' }
    },
        React.createElement('div', null,
            React.createElement(SplunkModal.Header, null,
                React.createElement('h3', { style: { margin: 0, fontSize: '16px', fontWeight: '500' } }, modalTitle)
            ),
            React.createElement(SplunkModal.Body, { style: { maxHeight: '70vh', overflowY: 'auto' } },
                phase === 'settings' && React.createElement(RotationSettings, {
                    onPreview: handlePreview,
                    onExecute: handleExecuteFromSettings,
                }),
                phase === 'preview' && React.createElement(RotationPreview, {
                    selectedRows: selectedRows,
                    generatorOptions: generatorOptions,
                    mode: rotationMode,
                    onBack: handleBack,
                    onExecute: handleExecuteFromPreview,
                }),
                phase === 'executing' && React.createElement('div', {
                    style: { textAlign: 'center', padding: '2rem' }
                },
                    React.createElement('p', null, 'Rotating passwords for ' + (selectedRows ? selectedRows.length : 0) + ' credentials...'),
                    React.createElement('p', { style: { fontSize: '13px', color: '#666' } }, 'Please do not close this window.')
                ),
                phase === 'results' && React.createElement(RotationResults, {
                    results: results,
                    onUndo: handleUndo,
                    onExpire: handleExpire,
                    onClose: handleClose,
                })
            ),
            React.createElement(SplunkModal.Footer, { itemAlign: 'end' },
                phase !== 'results' && React.createElement(Button, {
                    onClick: handleClose,
                    appearance: 'subtle',
                    children: phase === 'executing' ? 'Cancel' : 'Cancel'
                })
            )
        )
    );
}

module.exports = PasswordRotationModal;
