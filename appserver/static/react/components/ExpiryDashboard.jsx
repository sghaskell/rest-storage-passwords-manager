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
}) {
    const [autoRefresh, setAutoRefreshState] = React.useState(getAutoRefreshEnabled());
    const [thresholdDays, setThresholdDaysState] = React.useState(API.getDueSoonThreshold());
    const [lastRefresh, setLastRefresh] = React.useState(Date.now());

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

    // Auto-refresh timer
    React.useEffect(function() {
        if (!autoRefresh) return;
        var interval = getAutoRefreshInterval();
        var timer = setInterval(function() {
            if (onRefresh) onRefresh();
        }, interval);
        return function() { clearInterval(timer); };
    }, [autoRefresh]);

    // Toggle auto-refresh
    function handleToggleAutoRefresh() {
        var next = !autoRefresh;
        setAutoRefreshState(next);
        setAutoRefreshEnabled(next);
    }

    // Threshold slider change
    function handleThresholdChange(e) {
        var val = parseInt(e.target.value, 10);
        setThresholdDaysState(val);
        API.setDueSoonThreshold(val);
    }

    // Manual refresh
    function handleRefresh() {
        if (onRefresh) onRefresh();
        setLastRefresh(Date.now());
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

        // Refresh
        React.createElement(Button, {
            onClick: handleRefresh,
            appearance: 'subtle',
            children: '\u21bb Refresh'
        }),

        // Auto-refresh toggle
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '0.35rem' }
        },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--ed-text-muted)' } }, 'Auto-refresh'),
            React.createElement(Switch, {
                selected: autoRefresh,
                onClick: handleToggleAutoRefresh,
            })
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
            gridTemplateColumns: '1fr 1.2fr 1fr 1fr 0.8fr',
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
        'Username', 'Realm', 'Expiry Date', 'Days Remaining', 'Status'
    );

    var tableRows = sortedCreds.map(function(cred, i) {
        var status = cred.rotationStatus;
        var rowColor = getStatusColor(status);
        var daysRem = cred.daysRemaining;
        var realmInfo = API.parseExpiryFromRealm(cred.realm || '');
        var displayRealm = realmInfo.baseRealm || (cred.expiryDate ? 'Exp: ' + formatDateShort(cred.expiryDate) : '—');

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

        return React.createElement('div', {
            key: cred.stanzaKey || (cred.name + ':' + (cred.realm || '') + ':' + i),
            style: {
                display: 'grid',
                gridTemplateColumns: '1fr 1.2fr 1fr 1fr 0.8fr',
                padding: '0.5rem 0.75rem',
                fontSize: '13px',
                borderBottom: '1px solid var(--ed-border)',
                backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--ed-card-bg)',
                color: 'var(--ed-text)',
                borderLeft: '3px solid ' + rowColor,
            }
        },
            // Username
            React.createElement('span', { style: { fontWeight: '600' } }, cred.name || '—'),
            // Realm
            React.createElement('span', { style: { color: 'var(--ed-text-muted)' } }, displayRealm),
            // Expiry Date
            React.createElement('span', {
                style: { color: cred.expiryDate ? rowColor : 'var(--ed-text-muted)' }
            }, cred.expiryDate ? formatDateShort(cred.expiryDate) : '—'),
            // Days Remaining
            React.createElement('span', {
                style: {
                    fontWeight: daysRem !== null && daysRem <= thresholdDays ? '700' : 'normal',
                    color: daysRem !== null && daysRem < 0 ? '#d32f2f' :
                           daysRem !== null && daysRem <= thresholdDays ? '#f59e0b' :
                           'var(--ed-text)',
                }
            }, daysDisplay),
            // Status badge
            React.createElement('span', {
                style: {
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
            }, status.charAt(0).toUpperCase() + status.slice(1))
        );
    });

    // ─── Render ───────────────────────────────────────────────────────────
    return React.createElement('div', { className: 'expiry-dashboard' },
        themeCSS,
        React.createElement('h2', {
            style: {
                margin: '0 0 1rem 0',
                fontSize: '18px',
                fontWeight: '600',
                color: 'var(--ed-text)',
            }
        }, 'Expiry Dashboard'),
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
        React.createElement('div', {
            style: {
                marginTop: '0.5rem',
                fontSize: '11px',
                color: 'var(--ed-text-muted)',
                textAlign: 'right',
            }
        }, 'Last refresh: ' + new Date(lastRefresh).toLocaleTimeString())
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
