/**
 * ExpiryDashboard.jsx — Dashboard view showing credentials grouped by rotation status
 *
 * Stats bar with 4 cards (total/overdue/due-soon/ok), sortable table with days
 * remaining indicator, color-coded rows, auto-refresh, and threshold slider.
 */

const React = require('react');
const ButtonMod = require('@splunk/react-ui/Button');
var Button = ButtonMod.default;
const SwitchMod = require('@splunk/react-ui/Switch');
var Switch = SwitchMod.default;
const API = require('../api');

// ─── localStorage keys ────────────────────────────────────────────────────────
const AUTO_REFRESH_KEY = 'expiry-auto-refresh-enabled';
const AUTO_REFRESH_INTERVAL_KEY = 'expiry-auto-refresh-interval';
const DEFAULT_AUTO_REFRESH = true;
const DEFAULT_AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

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

// ─── Component ────────────────────────────────────────────────────────────────

function ExpiryDashboard({
    credentials = [],
    onNavigateToTable,
    onOpenAlertConfig,
    onRefresh,
    onRotate,
    onRotateBulk,
}) {
    const [autoRefresh, setAutoRefreshState] = React.useState(getAutoRefreshEnabled());
    const [autoRefreshInterval, setAutoRefreshIntervalState] = React.useState(getAutoRefreshInterval());
    const [thresholdDays, setThresholdDaysState] = React.useState(API.getDueSoonThreshold());
    const [lastRefresh, setLastRefresh] = React.useState(Date.now());
    const [refreshing, setRefreshing] = React.useState(false);

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

    // Sort: soonest first, none at bottom
    const sortedCreds = React.useMemo(function() {
        var withExpiry = classifiedCreds.filter(function(c) { return c.expiryDate; });
        var none = classifiedCreds.filter(function(c) { return !c.expiryDate; });
        withExpiry.sort(function(a, b) {
            return (a.expiryDate || '').localeCompare(b.expiryDate || '');
        });
        return withExpiry.concat(none);
    }, [classifiedCreds]);

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

    // Dark theme detection
    var isDark = document.documentElement.classList.contains('dark-theme') ||
        document.documentElement.classList.contains('theme-dark') ||
        document.documentElement.getAttribute('data-theme') === 'dark' ||
        (document.body && document.body.classList.contains('dark-theme'));

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
            children: '\u2190 Credentials Table'
        }) : null,

        // Refresh + timestamp
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' }
        },
            React.createElement(Button, {
                onClick: handleRefresh,
                appearance: 'subtle',
                children: React.createElement('span', {
                    style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                    }
                },
                    '\u21bb',
                    'Refresh',
                    refreshing && React.createElement('span', {
                        style: {
                            display: 'inline-block',
                            width: '10px',
                            height: '10px',
                            border: '2px solid var(--ed-text-muted)',
                            borderTopColor: 'transparent',
                            borderRadius: '50%',
                            animation: 'spin 0.6s linear infinite',
                        }
                    })
                )
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

        // Alert config button — only render if onOpenAlertConfig is provided
        onOpenAlertConfig ? React.createElement(Button, {
            onClick: onOpenAlertConfig,
            appearance: 'subtle',
            children: '\u2699 Alert Settings'
        }) : null,

        // Rotate Overdue button — only render if onRotateBulk is provided
        onRotateBulk && stats.overdue + stats.dueSoon > 0 ? React.createElement(Button, {
            onClick: onRotateBulk,
            appearance: 'subtle',
            children: '\u21bb Rotate Overdue/Due-Soon (' + (stats.overdue + stats.dueSoon) + ')'
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
    var tableHeader = React.createElement('div', {
        style: {
            display: 'grid',
            gridTemplateColumns: '1fr 1.2fr 1fr 1fr 100px 120px',
            padding: '0.5rem 0.75rem',
            fontWeight: '600',
            fontSize: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--ed-header-color)',
            backgroundColor: 'var(--ed-header-bg)',
            borderBottom: '1px solid var(--ed-header-border)',
        }
    },
        React.createElement('span', null, 'Username'),
        React.createElement('span', null, 'Realm'),
        React.createElement('span', null, 'Expiry Date'),
        React.createElement('span', null, 'Days Remaining'),
        React.createElement('span', null, 'Status'),
        React.createElement('span', null, 'Actions')
    );

    var tableRows = sortedCreds.map(function(cred, i) {
        var status = cred.rotationStatus;
        var rowColor = getStatusColor(status);
        var daysRem = cred.daysRemaining;
        var displayRealm = cred.realm || '—';

        // Days remaining display
        var daysDisplay;
        if (daysRem === null) {
            daysDisplay = '—';
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

        return React.createElement('div', {
            key: cred.stanzaKey || (cred.name + ':' + (cred.realm || '') + ':' + i),
            style: {
                display: 'grid',
                gridTemplateColumns: '1fr 1.2fr 1fr 1fr 100px 120px',
                alignItems: 'center',
                padding: '0.5rem 0.75rem',
                fontSize: '13px',
                borderBottom: '1px solid var(--ed-border)',
                backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--ed-card-bg)',
                color: 'var(--ed-text)',
                borderLeft: '3px solid ' + rowColor,
            }
        },
            // Username — pill
            React.createElement('span', {
                style: {
                    justifySelf: 'start',
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
            }, cred.name || '—'),
            // Realm — pill
            React.createElement('span', {
                style: {
                    justifySelf: 'start',
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
            }, displayRealm),
            // Expiry Date — pill
            React.createElement('span', {
                style: {
                    justifySelf: 'start',
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
            }, cred.expiryDate ? formatDateShort(cred.expiryDate) : '—'),
            // Days Remaining — pill
            React.createElement('span', {
                style: {
                    justifySelf: 'start',
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
            }, daysDisplay),
            // Status badge
            React.createElement('span', {
                style: {
                    justifySelf: 'start',
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
            }, status.charAt(0).toUpperCase() + status.slice(1)),
            // Actions — Rotate button for overdue and due-soon credentials
            onRotate && (status === 'overdue' || status === 'due-soon')
                ? React.createElement(Button, {
                    onClick: function() { onRotate(cred); },
                    appearance: status === 'overdue' ? 'destructive' : 'subtle',
                    children: '\u21bb Rotate'
                })
                : React.createElement('span', { style: { visibility: 'hidden' } }, '-')
        );
    });

    // ─── Render ───────────────────────────────────────────────────────────
    return React.createElement('div', { className: 'expiry-dashboard' },
        themeCSS,
        toolbar,
        statsCards,
        React.createElement('div', {
            style: {
                border: '1px solid var(--ed-border)',
                borderRadius: '6px',
                overflow: 'hidden',
                backgroundColor: 'var(--ed-bg)',
            }
        },
            tableHeader,
            tableRows.length > 0
                ? React.createElement(React.Fragment, null, ...tableRows)
                : React.createElement('div', {
                    style: {
                        textAlign: 'center',
                        padding: '2rem',
                        color: 'var(--ed-text-muted)',
                    }
                }, 'No credentials found')
        ),
        // No timestamp here — it's in the toolbar now
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
