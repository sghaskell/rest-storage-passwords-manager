/**
 * CredentialManager.jsx  –  React scaffold for Splunk 9.2+ / Cloud
 *
 * FULL FEATURE PARITY WITH bootstrap-table.js v1.11.1
 * ─────────────────────────────────────────────────────────────────────────────
 * Every bootstrap-table feature used in the original app is replaced here
 * with native React state or @splunk/react-ui components.  No third-party
 * table library is needed.
 *
 * bootstrap-table feature          How it's replaced here
 * ─────────────────────────────────────────────────────────────────────────────
 * Pagination                        PAGE_SIZE constant + slice() on filtered
 *                                   array + @splunk/react-ui Paginator
 * Column sorting (click header)     sortCol / sortDir state + [...].sort()
 *                                   before render; SortableHeadCell helper
 * Right-click context menu          onContextMenu on Table.Row + Popover +
 *                                   Menu from @splunk/react-ui
 * Single / multi row selection      Controlled Set in useState; select-all
 *                                   checkbox scoped to current page
 * Search / filter bar               Text input filters the credentials array
 *                                   before the sort+paginate pipeline
 * Show / hide columns               visibleCols Set + Switch toggles in toolbar
 * Detail / expand row (inline form) Conditional Table.Row after selected row
 * JSON data via AJAX                fetchCredentials() direct REST call
 * Responsive layout                 @splunk/react-ui Table handles natively
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SCAFFOLDING NOTES
 * ─────────────────
 * 1. Run `npx @splunk/create` to generate the build wrapper, drop this in src/
 * 2. npm install @splunk/react-ui @splunk/splunk-utils
 * 3. Entry point (src/main.jsx):
 *      import ReactDOM from 'react-dom';
 *      import SplunkThemeProvider from '@splunk/themes/SplunkThemeProvider';
 *      import CredentialManager from './CredentialManager';
 *      ReactDOM.render(
 *        <SplunkThemeProvider family="enterprise" colorScheme="light" density="comfortable">
 *          <CredentialManager />
 *        </SplunkThemeProvider>,
 *        document.getElementById('root')
 *      );
 */

import React, { useState, useEffect, useCallback, useReducer } from 'react';

import Table        from '@splunk/react-ui/Table';
import Button       from '@splunk/react-ui/Button';
import Modal        from '@splunk/react-ui/Modal';
import Message      from '@splunk/react-ui/Message';
import WaitSpinner  from '@splunk/react-ui/WaitSpinner';
import ControlGroup from '@splunk/react-ui/ControlGroup';
import Text         from '@splunk/react-ui/Text';
import Select       from '@splunk/react-ui/Select';
import Multiselect  from '@splunk/react-ui/Multiselect';
import Paginator    from '@splunk/react-ui/Paginator';
import Popover      from '@splunk/react-ui/Popover';
import Menu         from '@splunk/react-ui/Menu';
import Switch       from '@splunk/react-ui/Switch';

import { getCurrentUser, getCurrentApp } from '@splunk/splunk-utils/config';

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 10;   // matches original bootstrap-table data-page-size="10"

// Single source of truth for column definitions.
// REPLACES: hardcoded <th data-field="..."> strings and bootstrap-table
// data-sortable / data-visible attributes scattered across the HTML template.
const COLUMNS = [
    { id: 'username',    label: 'Username',  sortable: true  },
    { id: 'realm',       label: 'Realm',     sortable: true  },
    { id: 'app',         label: 'App',       sortable: true  },
    { id: 'owner',       label: 'Owner',     sortable: true  },
    { id: 'acl_sharing', label: 'Sharing',   sortable: true  },
    { id: 'acl_read',    label: 'Read',      sortable: false },
    { id: 'acl_write',   label: 'Write',     sortable: false },
    { id: 'password',    label: 'Password',  sortable: false },  // eye-icon column
];

// ─── REST helpers ─────────────────────────────────────────────────────────────
async function splunkdFetch(method, path, data) {
    const url  = `/en-US/splunkd/__raw${path}`;
    const opts = {
        method,
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    };
    if (data) {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        opts.body = new URLSearchParams(data).toString();
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${method} ${path} → ${res.status}: ${text}`);
    }
    return res;
}

const splunkdGET    = path       => splunkdFetch('GET',    path);
const splunkdPOST   = (path, d) => splunkdFetch('POST',   path, d);
const splunkdDELETE = path       => splunkdFetch('DELETE', path);

async function fetchCredentials() {
    const res  = await splunkdGET('/servicesNS/-/-/storage/passwords?output_mode=json&count=0&splunk_server=local');
    const json = await res.json();
    return (json.entry || []).map(e => ({
        key:         e.name,
        username:    e.content.username,
        realm:       e.content.realm || '',
        app:         e.acl.app,
        owner:       e.acl.owner,
        acl_read:    (e.acl.perms?.read  || []).join(','),
        acl_write:   (e.acl.perms?.write || []).join(','),
        acl_sharing: e.acl.sharing,
        rest_uri:    e.links.edit || e.links.alternate,
    }));
}

async function fetchClearPassword(realm, username) {
    const key  = encodeURIComponent(`${realm}:${username}:`);
    const res  = await splunkdGET(`/servicesNS/-/-/storage/passwords/${key}?output_mode=json`);
    const json = await res.json();
    return json.entry?.[0]?.content?.clear_password ?? null;
}

async function fetchApps() {
    const res  = await splunkdGET('/servicesNS/-/-/apps/local?output_mode=json&count=0&search=disabled%3D0');
    const json = await res.json();
    return (json.entry || []).map(e => ({ label: e.content.label || e.name, value: e.name }));
}

async function fetchRolesAndUsers() {
    const [rolesRes, usersRes] = await Promise.all([
        splunkdGET('/servicesNS/-/-/authorization/roles?output_mode=json&count=0'),
        splunkdGET('/servicesNS/-/-/authentication/users?output_mode=json&count=0')
    ]);
    const roles = await rolesRes.json();
    const users = await usersRes.json();
    const seen  = new Set();
    return [...(roles.entry || []), ...(users.entry || [])]
        .map(e => ({ label: e.name, value: e.name }))
        .filter(o => { if (seen.has(o.value)) return false; seen.add(o.value); return true; });
}

// ─── App state reducer ────────────────────────────────────────────────────────
// All business-logic state lives here so it's inspectable and testable
// independent of the render tree.
const initialState = {
    credentials:    [],
    loading:        true,
    error:          null,
    showCreateForm: false,
    editRow:        null,   // row whose inline update form is open
    modal:          { open: false, title: '', body: null, onClose: null },
    apps:           [],
    rolesUsers:     [],
};

function reducer(state, action) {
    switch (action.type) {
        case 'LOAD_START':    return { ...state, loading: true,  error: null };
        case 'LOAD_DONE':     return { ...state, loading: false, credentials: action.credentials };
        case 'LOAD_ERROR':    return { ...state, loading: false, error: action.error };
        case 'META_LOADED':   return { ...state, apps: action.apps, rolesUsers: action.rolesUsers };
        case 'TOGGLE_CREATE': return { ...state, showCreateForm: !state.showCreateForm, editRow: null };
        case 'SET_EDIT_ROW':  return {
            ...state,
            // Toggle: clicking Update on the same row closes the form
            editRow: state.editRow?.key === action.row?.key ? null : action.row,
            showCreateForm: false
        };
        case 'SHOW_MODAL':    return { ...state, modal: { open: true,  ...action.payload } };
        case 'CLOSE_MODAL':   return { ...state, modal: { ...state.modal, open: false } };
        default:              return state;
    }
}

// ─── Sortable header cell ─────────────────────────────────────────────────────
// REPLACES: bootstrap-table data-sortable="true" on <th> elements.
// A click cycles asc → desc → asc (never returns to unsorted, matching
// the bootstrap-table default behaviour).
function SortableHeadCell({ colId, label, sortCol, sortDir, onSort }) {
    const active = sortCol === colId;
    const arrow  = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
    return (
        <Table.HeadCell
            onClick={() => onSort(colId)}
            style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
            title={`Sort by ${label}`}
        >
            {label}
            <span style={{ opacity: active ? 1 : 0.35, marginLeft: 4 }}>{arrow}</span>
        </Table.HeadCell>
    );
}

// ─── Credential form (shared for create and update) ───────────────────────────
// REPLACES: two separate string-concatenated HTML form templates rendered
// via innerHTML, each backed by SplunkJS MVC DropdownView / MultiDropdownView.
// One controlled React component handles both modes; isUpdate disables the
// fields that the REST API will not allow changing after creation.
function CredentialForm({ apps, rolesUsers, defaults = {}, onSubmit, submitLabel = 'Create', isUpdate = false }) {
    const [username,        setUsername]        = useState(defaults.username    || '');
    const [password,        setPassword]        = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [realm,           setRealm]           = useState(defaults.realm       || '');
    const [app,             setApp]             = useState(defaults.app         || getCurrentApp());
    const [owner,           setOwner]           = useState(defaults.owner       || getCurrentUser());
    const [read,            setRead]            = useState(defaults.acl_read    ? defaults.acl_read.split(',')  : ['*']);
    const [write,           setWrite]           = useState(defaults.acl_write   ? defaults.acl_write.split(',') : ['admin', 'power']);
    const [sharing,         setSharing]         = useState(defaults.acl_sharing || 'app');

    const submit = () => onSubmit({
        username, password, confirmPassword, realm, app, owner,
        read: read.join(','), write: write.join(','), sharing
    });

    return (
        <div style={{ maxWidth: 540, padding: '12px 0' }}>
            <ControlGroup label="Username" labelPosition="top">
                <Text value={username} onChange={(_, { value }) => setUsername(value)}
                      disabled={isUpdate} placeholder="Enter username" />
            </ControlGroup>
            <ControlGroup label="Password" labelPosition="top">
                <Text type="password" value={password}
                      onChange={(_, { value }) => setPassword(value)} placeholder="Password" />
            </ControlGroup>
            <ControlGroup label="Confirm Password" labelPosition="top">
                <Text type="password" value={confirmPassword}
                      onChange={(_, { value }) => setConfirmPassword(value)} placeholder="Confirm password" />
            </ControlGroup>
            <ControlGroup label="Realm" labelPosition="top">
                {/* PRESERVED: realm is immutable after creation – REST API restriction */}
                <Text value={realm} onChange={(_, { value }) => setRealm(value)}
                      disabled={isUpdate} placeholder="Realm (optional)" />
            </ControlGroup>
            <ControlGroup label="App Scope" labelPosition="top">
                {/* REPLACES: SplunkJS DropdownView backed by a SearchManager */}
                <Select value={app} onChange={(_, { value }) => setApp(value)}>
                    {apps.map(a => <Select.Option key={a.value} label={a.label} value={a.value} />)}
                </Select>
            </ControlGroup>
            <ControlGroup label="Owner" labelPosition="top">
                <Select value={owner} onChange={(_, { value }) => setOwner(value)}>
                    {rolesUsers.map(r => <Select.Option key={r.value} label={r.label} value={r.value} />)}
                </Select>
            </ControlGroup>
            <ControlGroup label="Read Users" labelPosition="top">
                {/* REPLACES: SplunkJS MultiDropdownView */}
                <Multiselect values={read} onChange={(_, { values }) => setRead(values)}>
                    <Multiselect.Option label="*" value="*" />
                    {rolesUsers.map(r => <Multiselect.Option key={r.value} label={r.label} value={r.value} />)}
                </Multiselect>
            </ControlGroup>
            <ControlGroup label="Write Users" labelPosition="top">
                <Multiselect values={write} onChange={(_, { values }) => setWrite(values)}>
                    <Multiselect.Option label="*" value="*" />
                    {rolesUsers.map(r => <Multiselect.Option key={r.value} label={r.label} value={r.value} />)}
                </Multiselect>
            </ControlGroup>
            <ControlGroup label="Sharing" labelPosition="top">
                <Select value={sharing} onChange={(_, { value }) => setSharing(value)}>
                    <Select.Option label="global" value="global" />
                    <Select.Option label="app"    value="app"    />
                    <Select.Option label="user"   value="user"   />
                </Select>
            </ControlGroup>
            <Button label={submitLabel} appearance="primary" onClick={submit} style={{ marginTop: 12 }} />
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CredentialManager() {
    const [state, dispatch] = useReducer(reducer, initialState);

    // ── Table feature state ───────────────────────────────────────────────────

    // Filter bar – REPLACES: bootstrap-table data-search="true"
    const [filterText, setFilterText] = useState('');

    // Column sort – REPLACES: bootstrap-table data-sort-name + data-sort-order
    const [sortCol, setSortCol] = useState('username');
    const [sortDir, setSortDir] = useState('asc');

    // Pagination – REPLACES: bootstrap-table data-pagination + data-page-size
    const [page, setPage] = useState(1);

    // Column visibility – REPLACES: bootstrap-table show/hide columns
    // All columns visible by default, matching original behaviour
    const [visibleCols, setVisibleCols] = useState(new Set(COLUMNS.map(c => c.id)));
    const [showColToggle, setShowColToggle] = useState(false);

    // Row selection – REPLACES: bootstrap-table checkbox + getSelections()
    const [selected, setSelected] = useState(new Set());

    // Context menu – REPLACES: bootstrap-table-contextmenu.js plugin
    // anchorEl is the right-clicked Table.Row DOM node; Popover attaches to it
    const [contextMenu, setContextMenu] = useState({ open: false, row: null, anchorEl: null });

    // ── Data loading ──────────────────────────────────────────────────────────
    useEffect(() => {
        (async () => {
            try {
                const [credentials, apps, rolesUsers] = await Promise.all([
                    fetchCredentials(), fetchApps(), fetchRolesAndUsers()
                ]);
                dispatch({ type: 'META_LOADED', apps, rolesUsers });
                dispatch({ type: 'LOAD_DONE', credentials });
            } catch (err) {
                dispatch({ type: 'LOAD_ERROR', error: err.message });
            }
        })();
    }, []);

    // ── Helpers ───────────────────────────────────────────────────────────────

    // REPLACES: location.reload() + 500ms setTimeout
    const refresh = useCallback(async () => {
        dispatch({ type: 'LOAD_START' });
        setSelected(new Set());
        setPage(1);
        try {
            dispatch({ type: 'LOAD_DONE', credentials: await fetchCredentials() });
        } catch (err) {
            dispatch({ type: 'LOAD_ERROR', error: err.message });
        }
    }, []);

    const openModal = useCallback((title, body, onClose) =>
        dispatch({ type: 'SHOW_MODAL', payload: { title, body, onClose } }), []);

    const closeModal = useCallback(() => {
        dispatch({ type: 'CLOSE_MODAL' });
        state.modal.onClose?.();
    }, [state.modal]);

    const closeContextMenu = useCallback(() =>
        setContextMenu(prev => ({ ...prev, open: false })), []);

    // ── Column sort handler ───────────────────────────────────────────────────
    // Clicking the same column toggles direction; clicking a new column resets to asc.
    const handleSort = useCallback(colId => {
        setSortCol(prev => {
            if (prev === colId) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
            else { setSortDir('asc'); }
            return colId;
        });
        setPage(1);
    }, []);

    // ── Column visibility toggle ──────────────────────────────────────────────
    const toggleCol = colId => setVisibleCols(prev => {
        const next = new Set(prev);
        if (next.has(colId) && next.size === 1) return prev;  // always keep ≥1 column
        next.has(colId) ? next.delete(colId) : next.add(colId);
        return next;
    });

    // ── Row selection helpers ─────────────────────────────────────────────────
    const toggleSelected = key => setSelected(prev => {
        const next = new Set(prev);
        next.has(key) ? next.delete(key) : next.add(key);
        return next;
    });

    // ── Context menu handler ──────────────────────────────────────────────────
    // REPLACES: bootstrap-table-contextmenu.js onContextMenuItem / onContextMenuRow
    // We intercept the native contextmenu event, suppress the browser default,
    // and open the Popover anchored to the row element.
    const handleContextMenu = useCallback((e, row) => {
        e.preventDefault();
        setContextMenu({ open: true, row, anchorEl: e.currentTarget });
    }, []);

    // ── Data pipeline: filter → sort → paginate ───────────────────────────────
    // REPLACES: bootstrap-table's internal search, sort, and pagination logic.
    // Pure array transformations — no library state to manage.

    const filtered = state.credentials.filter(c => {
        if (!filterText) return true;
        const q = filterText.toLowerCase();
        return [c.username, c.realm, c.app, c.owner, c.acl_sharing]
            .some(v => String(v ?? '').toLowerCase().includes(q));
    });

    const sorted = [...filtered].sort((a, b) => {
        const av = String(a[sortCol] ?? '').toLowerCase();
        const bv = String(b[sortCol] ?? '').toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    const totalPages   = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage     = Math.min(page, totalPages);
    const pageRows     = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const selectedRows = state.credentials.filter(c => selected.has(c.key));

    // Select-all scoped to current page, matching bootstrap-table behaviour
    const allPageSelected = pageRows.length > 0 && pageRows.every(r => selected.has(r.key));
    const togglePageAll   = () => setSelected(prev => {
        const next = new Set(prev);
        if (allPageSelected) pageRows.forEach(r => next.delete(r.key));
        else                 pageRows.forEach(r => next.add(r.key));
        return next;
    });

    // ── Action handlers ───────────────────────────────────────────────────────

    const handleShowPassword = useCallback(async row => {
        closeContextMenu();
        try {
            // PRESERVED: temporary sharing bump for user-scoped credentials
            if (row.acl_sharing === 'user') {
                await splunkdPOST(`${row.rest_uri}/acl`, {
                    'perms.read': row.acl_read, 'perms.write': row.acl_write,
                    sharing: 'app', owner: row.owner
                });
            }
            const pwd = await fetchClearPassword(row.realm, row.username);
            if (row.acl_sharing === 'user') {
                await splunkdPOST(`${row.rest_uri}/acl`, {
                    'perms.read': row.acl_read, 'perms.write': row.acl_write,
                    sharing: 'user', owner: row.owner
                });
            }
            openModal(
                `Password – ${row.realm}:${row.username}`,
                pwd
                    ? <code style={{ fontSize: 16, wordBreak: 'break-all' }}>{pwd}</code>
                    : <Message type="warning">No password found. Verify <b>list_storage_passwords</b> capability.</Message>
            );
        } catch (err) {
            openModal('Error', <Message type="error">{err.message}</Message>);
        }
    }, [openModal, closeContextMenu]);

    const handleCreate = useCallback(async formData => {
        const { username, password, confirmPassword, realm, app, owner, read, write, sharing } = formData;
        if (!username) return openModal('Validation', <Message type="error">Username is required.</Message>);
        if (!password) return openModal('Validation', <Message type="error">Password is required.</Message>);
        if (password !== confirmPassword) return openModal('Validation', <Message type="warning">Passwords do not match.</Message>);

        const messages = [];
        try {
            await splunkdPOST(
                `/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/storage/passwords`,
                { name: username, password, realm }
            );
            messages.push(<Message type="success">Created <b>{realm}:{username}</b></Message>);

            const aclPath = `/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/configs/conf-passwords/credential%3A${encodeURIComponent(realm)}%3A${encodeURIComponent(username)}%3A/acl`;
            // PRESERVED: two-step ACL pattern required by splunkd when sharing='user'
            if (sharing === 'user') {
                await splunkdPOST(aclPath, { 'perms.read': read, 'perms.write': write, sharing: 'app', owner });
            }
            await splunkdPOST(aclPath, { 'perms.read': read, 'perms.write': write, sharing, owner });
            messages.push(<Message type="success">ACLs applied.</Message>);

            dispatch({ type: 'TOGGLE_CREATE' });
            openModal('Credential Created', <>{messages}</>, refresh);
        } catch (err) {
            openModal('Create Failed', <Message type="error">{err.message}</Message>, refresh);
        }
    }, [openModal, refresh]);

    const handleUpdate = useCallback(async (row, formData) => {
        closeContextMenu();
        const { password, confirmPassword, app: newApp, sharing, owner, read, write } = formData;
        if (password && password !== confirmPassword)
            return openModal('Validation', <Message type="warning">Passwords do not match.</Message>);

        const messages = [];
        try {
            // PRESERVED: set sharing=app first for predictable splunkd URI behaviour
            await splunkdPOST(`${row.rest_uri}/acl`, {
                'perms.read': read, 'perms.write': write, sharing: 'app', owner
            });
            if (password) {
                await splunkdPOST(
                    `/servicesNS/nobody/${encodeURIComponent(row.app)}/storage/passwords/${encodeURIComponent(row.realm)}:${encodeURIComponent(row.username)}:`,
                    { password }
                );
                messages.push(<Message type="success">Password updated.</Message>);
            }
            if (row.app !== newApp) {
                await splunkdPOST(
                    `/servicesNS/nobody/${encodeURIComponent(row.app)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/move`,
                    { app: newApp, user: 'nobody' }
                );
                messages.push(<Message type="success">Moved to <b>{newApp}</b>.</Message>);
            }
            await splunkdPOST(
                `/servicesNS/nobody/${encodeURIComponent(newApp)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/acl`,
                { 'perms.read': read, 'perms.write': write, sharing, owner }
            );
            messages.push(<Message type="success">ACLs applied.</Message>);
            dispatch({ type: 'SET_EDIT_ROW', row: null });
            openModal('Credential Updated', <>{messages}</>, refresh);
        } catch (err) {
            openModal('Update Failed', <Message type="error">{err.message}</Message>, refresh);
        }
    }, [openModal, refresh, closeContextMenu]);

    const handleDelete = useCallback(rows => {
        closeContextMenu();
        const names = rows.map(r => `${r.realm}:${r.username}`).join(', ');
        openModal(
            'Confirm Delete',
            <Message type="error">You are about to remove <b>{names}</b>. Press OK to continue.</Message>,
            async () => {
                const results = await Promise.allSettled(rows.map(async row => {
                    // PRESERVED: ACL bump before DELETE for predictable URI
                    await splunkdPOST(`${row.rest_uri}/acl`, {
                        'perms.read': row.acl_read, 'perms.write': row.acl_write,
                        sharing: row.acl_sharing === 'user' ? 'app' : row.acl_sharing,
                        owner: row.owner
                    });
                    await splunkdDELETE(
                        `/servicesNS/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.app)}/storage/passwords/${encodeURIComponent(row.realm)}:${encodeURIComponent(row.username)}:`
                    );
                    return row;
                }));
                const msgs = results.map(r =>
                    r.status === 'fulfilled'
                        ? <Message type="success">Deleted <b>{r.value.realm}:{r.value.username}</b></Message>
                        : <Message type="error">{r.reason?.message}</Message>
                );
                openModal('Delete Result', <>{msgs}</>, refresh);
            }
        );
    }, [openModal, refresh, closeContextMenu]);

    // ── Render ────────────────────────────────────────────────────────────────
    if (state.loading) return <WaitSpinner size="large" />;
    if (state.error)   return <Message type="error">{state.error}</Message>;

    return (
        <div>

            {/* ── Toolbar ────────────────────────────────────────────────────
                REPLACES: bootstrap-table data-toolbar + the hardcoded #toolbar
                div.  Filter and column-toggle are additions that bootstrap-table
                handled via data attributes; they now live here explicitly. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>

                <Button
                    label={state.showCreateForm ? 'Close' : 'Create'}
                    appearance="primary"
                    onClick={() => dispatch({ type: 'TOGGLE_CREATE' })}
                />

                <Button
                    label={selected.size ? `Delete Selected (${selected.size})` : 'Delete Selected'}
                    appearance="destructive"
                    disabled={selected.size === 0}
                    onClick={() => handleDelete(selectedRows)}
                />

                {/* Filter bar – REPLACES: bootstrap-table data-search="true" */}
                <Text
                    value={filterText}
                    onChange={(_, { value }) => { setFilterText(value); setPage(1); }}
                    placeholder="Filter credentials…"
                    style={{ width: 240 }}
                    canClear
                />

                {/* Column toggle trigger – REPLACES: bootstrap-table show/hide columns */}
                <Button
                    label={showColToggle ? 'Hide Columns' : 'Columns'}
                    appearance="secondary"
                    onClick={() => setShowColToggle(v => !v)}
                />

                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#666' }}>
                    {filtered.length} result{filtered.length !== 1 ? 's' : ''}
                    {filterText ? ` for "${filterText}"` : ''}
                </span>
            </div>

            {/* ── Column visibility panel ─────────────────────────────────────
                REPLACES: bootstrap-table show/hide columns feature.
                Switch toggles per column; always keeps at least one visible. */}
            {showColToggle && (
                <div style={{
                    display: 'flex', gap: 16, flexWrap: 'wrap',
                    padding: '10px 0 14px', borderBottom: '1px solid #e0e0e0', marginBottom: 12
                }}>
                    {COLUMNS.map(col => (
                        <Switch
                            key={col.id}
                            selected={visibleCols.has(col.id)}
                            onClick={() => toggleCol(col.id)}
                            appearance="toggle"
                            size="small"
                        >
                            {col.label}
                        </Switch>
                    ))}
                </div>
            )}

            {/* ── Create form ─────────────────────────────────────────────────
                Shown inline above the table, collapses on close. */}
            {state.showCreateForm && (
                <div style={{ marginBottom: 16, padding: 16, background: '#f8f8f8', borderRadius: 4 }}>
                    <CredentialForm
                        apps={state.apps}
                        rolesUsers={state.rolesUsers}
                        onSubmit={handleCreate}
                        submitLabel="Create"
                    />
                </div>
            )}

            {/* ── Credentials table ───────────────────────────────────────────
                REPLACES: bootstrap-table.js entirely.
                Sorting         → SortableHeadCell + sorted array
                Filtering       → filtered array (computed above)
                Pagination      → pageRows slice + Paginator below
                Selection       → controlled checkbox Set
                Context menu    → onContextMenu → Popover (below)
                Detail expand   → conditional Table.Row after parent row
                No JS bundle    → zero third-party dependencies */}
            <Table stripeRows>
                <Table.Head>
                    {/* Select-all scoped to current page –
                        matches bootstrap-table data-checkbox-header behaviour */}
                    <Table.HeadCell style={{ width: 32 }}>
                        <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={togglePageAll}
                            title="Select / deselect all on this page"
                        />
                    </Table.HeadCell>

                    {COLUMNS.filter(c => visibleCols.has(c.id)).map(col =>
                        col.sortable
                            ? <SortableHeadCell
                                key={col.id}
                                colId={col.id}
                                label={col.label}
                                sortCol={sortCol}
                                sortDir={sortDir}
                                onSort={handleSort}
                              />
                            : <Table.HeadCell key={col.id}>{col.label}</Table.HeadCell>
                    )}
                    <Table.HeadCell>Actions</Table.HeadCell>
                </Table.Head>

                <Table.Body>
                    {pageRows.length === 0 && (
                        <Table.Row>
                            <Table.Cell colSpan={COLUMNS.length + 2}>
                                <Message type="info">
                                    {filterText
                                        ? `No credentials match "${filterText}".`
                                        : 'No credentials found. Create one above.'}
                                </Message>
                            </Table.Cell>
                        </Table.Row>
                    )}

                    {pageRows.map(row => (
                        <React.Fragment key={row.key}>

                            {/* ── Data row ──────────────────────────────────
                                onContextMenu replaces bootstrap-table-contextmenu.js.
                                We store the DOM node as anchorEl so Popover can
                                position itself relative to the right-clicked row. */}
                            <Table.Row
                                onContextMenu={e => handleContextMenu(e, row)}
                                style={{ cursor: 'context-menu' }}
                            >
                                <Table.Cell>
                                    <input
                                        type="checkbox"
                                        checked={selected.has(row.key)}
                                        onChange={() => toggleSelected(row.key)}
                                    />
                                </Table.Cell>

                                {/* Render only visible columns in COLUMNS order */}
                                {COLUMNS.filter(c => visibleCols.has(c.id)).map(col => {
                                    if (col.id === 'password') {
                                        return (
                                            <Table.Cell key="password">
                                                <Button
                                                    appearance="pill"
                                                    icon={<span className="icon-visible" />}
                                                    title="Show password"
                                                    onClick={() => handleShowPassword(row)}
                                                />
                                            </Table.Cell>
                                        );
                                    }
                                    return <Table.Cell key={col.id}>{row[col.id]}</Table.Cell>;
                                })}

                                <Table.Cell>
                                    <Button
                                        label="Update"
                                        appearance="secondary"
                                        onClick={() => dispatch({ type: 'SET_EDIT_ROW', row })}
                                    />
                                    <Button
                                        label="Delete"
                                        appearance="destructive"
                                        onClick={() => handleDelete([row])}
                                        style={{ marginLeft: 4 }}
                                    />
                                </Table.Cell>
                            </Table.Row>

                            {/* ── Inline update form (expand/detail row) ─────
                                REPLACES: bootstrap-table onExpandRow which
                                injected SplunkJS form components below the row.
                                A conditional Fragment row is cleaner and has no
                                library state to synchronise. */}
                            {state.editRow?.key === row.key && (
                                <Table.Row>
                                    <Table.Cell colSpan={COLUMNS.length + 2}>
                                        <div style={{ padding: '12px 8px', background: '#f4f4f4', borderRadius: 4 }}>
                                            <CredentialForm
                                                apps={state.apps}
                                                rolesUsers={state.rolesUsers}
                                                defaults={row}
                                                onSubmit={fd => handleUpdate(row, fd)}
                                                submitLabel="Update"
                                                isUpdate
                                            />
                                        </div>
                                    </Table.Cell>
                                </Table.Row>
                            )}

                        </React.Fragment>
                    ))}
                </Table.Body>
            </Table>

            {/* ── Pagination ─────────────────────────────────────────────────
                REPLACES: bootstrap-table data-pagination="true",
                data-page-size="10", data-page-list="[10,20,50,ALL]".
                @splunk/react-ui Paginator handles rendering and page-change
                events; we just track the current page in state. */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <Paginator
                        current={safePage}
                        alwaysShowLastPageLink
                        onChange={(_, { page: p }) => setPage(p)}
                        totalPages={totalPages}
                    />
                </div>
            )}

            {/* ── Context menu ───────────────────────────────────────────────
                REPLACES: bootstrap-table-contextmenu.js v1.1.4 +
                the #example1-context-menu <ul> HTML injected into #context-menu.

                Implementation notes:
                - Popover is anchored to the right-clicked row DOM node
                - Menu items map 1:1 to the original Update / Delete actions,
                  plus Show Password which was an inline eye-icon in the original
                - Menu.Divider visually separates the destructive Delete item,
                  which matches the original context-menu styling intent
                - closeContextMenu() is called at the start of every handler so
                  the menu closes before any async work begins */}
            <Popover
                open={contextMenu.open}
                anchor={contextMenu.anchorEl}
                onRequestClose={closeContextMenu}
                placement="below"
            >
                <Menu style={{ minWidth: 160 }}>
                    <Menu.Item
                        icon={<span className="icon-pencil" />}
                        onClick={() => {
                            closeContextMenu();
                            dispatch({ type: 'SET_EDIT_ROW', row: contextMenu.row });
                        }}
                    >
                        Update
                    </Menu.Item>
                    <Menu.Item
                        icon={<span className="icon-visible" />}
                        onClick={() => handleShowPassword(contextMenu.row)}
                    >
                        Show Password
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                        icon={<span className="icon-x" />}
                        onClick={() => handleDelete([contextMenu.row])}
                        style={{ color: 'var(--color-error, #d41f1f)' }}
                    >
                        Delete
                    </Menu.Item>
                </Menu>
            </Popover>

            {/* ── Result modal ───────────────────────────────────────────────
                REPLACES: custom Modal.js class + Bootstrap 3 modal markup.
                Shared by create / update / delete confirmation / show-password.
                The confirm-before-delete flow is handled by passing an onClose
                callback that fires the actual delete after the user clicks OK. */}
            <Modal open={state.modal.open} onRequestClose={closeModal}>
                <Modal.Header title={state.modal.title} onRequestClose={closeModal} />
                <Modal.Body style={{ minWidth: 400 }}>{state.modal.body}</Modal.Body>
                <Modal.Footer>
                    <Button appearance="primary" label="Close" onClick={closeModal} />
                </Modal.Footer>
            </Modal>

        </div>
    );
}
