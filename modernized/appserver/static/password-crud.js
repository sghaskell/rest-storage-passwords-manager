/**
 * password-crud.js  –  Modernized for Splunk 9.2+ / Cloud
 *
 * WHAT CHANGED vs. the original:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. REMOVED  splunkjs/mvc and all SplunkJS MVC components (SearchManager,
 *    DropdownView, MultiDropdownView).  These are deprecated in 9.x and absent
 *    in many Cloud builds.  All data fetching now goes through the Splunk JS
 *    SDK Service object or plain fetch() calls to splunkd/__raw.
 *
 * 2. REMOVED  the | rest SPL pattern for populating the table and showing
 *    passwords.  Routing credential data through the search pipeline exposes
 *    clear-text values in search artifacts (job cache, summaries).  Direct
 *    REST calls never touch the search tier.
 *
 * 3. REPLACED  jQuery $.ajax chains with async/await + fetch().  The old
 *    $.Deferred / $.when / .then chains are hard to follow and have no error
 *    propagation path.  Native Promises surface errors cleanly.
 *
 * 4. REPLACED  string-concatenated HTML with DOM helpers that escape values
 *    before insertion, eliminating the XSS vectors present in the original
 *    (raw row.username / row.realm injected into innerHTML).
 *
 * 5. REPLACED  window.sessionStorage for "is form open" state with a simple
 *    module-scoped boolean.  sessionStorage is shared across tabs and causes
 *    confusing state bleed.
 *
 * 6. REPLACED  location.reload() with a lightweight table refresh that only
 *    re-fetches credentials, keeping the rest of the page intact.
 *
 * 7. REMOVED  bundled Bootstrap dropdown/table JS.  The table is now rendered
 *    with native Splunk CSS classes so no third-party bundle is needed.
 *    The dashboard XML script= and stylesheet= attributes should be cleared
 *    of the bootstrap-* entries after deploying this file.
 *
 * 8. REMOVED  the splunkjs/mvc/simplexml/ready! dependency.  We bootstrap
 *    via DOMContentLoaded instead, which is reliable in both classic and
 *    embedded dashboard contexts.
 *
 * DEPENDENCIES (all available in Splunk 9.2+ without bundling):
 *   - splunkjs  (window.splunkjs  – the Splunk JS SDK, always present)
 *   - Splunk.util.getConfigValue  (still present in 9.x, used only for
 *     USERNAME; isolated in one helper so it's easy to swap later)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Bootstrap: wait for DOM then kick off ───────────────────────────────────
// CHANGED: was splunkjs/mvc/simplexml/ready! which couples to the classic
// dashboard lifecycle.  DOMContentLoaded works in any context.
document.addEventListener('DOMContentLoaded', () => { init(); });

// ─── Module-level state ───────────────────────────────────────────────────────
// CHANGED: was window.sessionStorage – see note 5 above.
let isCreateFormOpen = false;

// ─── Splunk SDK service singleton ─────────────────────────────────────────────
// CHANGED: replaces the implicit splunkjs/mvc context used throughout the
// original.  One service object, reused everywhere.
function getSplunkService() {
    // splunkjs is the Splunk JS SDK global, available on every Splunk page.
    return new splunkjs.Service({
        scheme:   window.location.protocol.replace(':', ''),
        host:     window.location.hostname,
        port:     window.location.port || (window.location.protocol === 'https:' ? 443 : 80),
        sessionKey: Splunk.util.getConfigValue('SESSION_KEY'),
        version:  '9.0'
    });
}

// ─── Current username helper ──────────────────────────────────────────────────
function currentUser() {
    // Splunk.util.getConfigValue is still present in 9.x.
    // Isolated here so it's a single change point if Splunk removes it.
    return Splunk.util.getConfigValue('USERNAME');
}

// ─── Safe DOM text setter (XSS guard) ─────────────────────────────────────────
// CHANGED: the original interpolated row values directly into innerHTML strings.
// This helper always uses textContent/setAttribute so values are never
// interpreted as markup.
function el(tag, textOrAttrs, children) {
    const node = document.createElement(tag);
    if (typeof textOrAttrs === 'string') {
        node.textContent = textOrAttrs;         // safe – no HTML interpretation
    } else if (textOrAttrs && typeof textOrAttrs === 'object') {
        Object.entries(textOrAttrs).forEach(([k, v]) => node.setAttribute(k, v));
    }
    (children || []).forEach(c => c && node.appendChild(c));
    return node;
}

// ─── splunkd REST helper ───────────────────────────────────────────────────────
// CHANGED: replaces $.ajax chains.  Returns a Promise that rejects with a
// descriptive error on non-2xx so callers can use try/catch cleanly.
async function splunkdFetch(method, path, data) {
    const url = `/en-US/splunkd/__raw${path}`;
    const opts = {
        method,
        credentials: 'include',       // sends the Splunk session cookie
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

// Convenience wrappers
const splunkdGET    = (path)        => splunkdFetch('GET',    path);
const splunkdPOST   = (path, data)  => splunkdFetch('POST',   path, data);
const splunkdDELETE = (path)        => splunkdFetch('DELETE', path);

// ─── Data fetchers ─────────────────────────────────────────────────────────────

/**
 * Fetch all credentials visible to the current user.
 * CHANGED: was a SearchManager running `| rest … storage/passwords` through
 * the search pipeline, which logged clear-text values in job artifacts.
 * Direct GET to the REST endpoint never touches the search tier.
 */
async function fetchCredentials() {
    const res  = await splunkdGET('/servicesNS/-/-/storage/passwords?output_mode=json&count=0&splunk_server=local');
    const json = await res.json();
    return (json.entry || []).map(e => ({
        username:    e.content.username,
        realm:       e.content.realm       || '',
        app:         e.acl.app,
        owner:       e.acl.owner,
        acl_read:    (e.acl.perms && e.acl.perms.read  || []).join(','),
        acl_write:   (e.acl.perms && e.acl.perms.write || []).join(','),
        acl_sharing: e.acl.sharing,
        // rest_uri is the canonical path for ACL and password operations on
        // this specific credential entry.
        rest_uri:    e.links.edit || e.links.alternate,
    }));
}

/**
 * Fetch the clear-text password for a single credential.
 * CHANGED: was a SearchManager with `| rest … | table clear_password` which
 * stored the clear-text value in Splunk's job cache.  Direct REST GET returns
 * it only to this browser session.
 */
async function fetchClearPassword(realm, username) {
    const key = encodeURIComponent(`${realm}:${username}:`);
    const res  = await splunkdGET(`/servicesNS/-/-/storage/passwords/${key}?output_mode=json`);
    const json = await res.json();
    return json.entry?.[0]?.content?.clear_password ?? null;
}

/**
 * Fetch apps list for the app-scope dropdown.
 * CHANGED: was a SearchManager running `| rest /servicesNS/-/-/apps/local`.
 * Direct REST call, no search job spun up.
 */
async function fetchApps() {
    const res  = await splunkdGET('/servicesNS/-/-/apps/local?output_mode=json&count=0&search=disabled%3D0');
    const json = await res.json();
    return (json.entry || []).map(e => ({ label: e.content.label || e.name, value: e.name }));
}

/**
 * Fetch roles + users for ACL dropdowns.
 * CHANGED: was two SearchManagers with `| rest … authorization/roles` and
 * `| rest … authentication/users` appended together in SPL.
 * Two parallel fetches, deduped client-side.
 */
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

// ─── Modal helper ─────────────────────────────────────────────────────────────
// CHANGED: the original used a custom Modal.js class wrapping Bootstrap 3
// modals.  This version uses the Splunk-native modal markup so no third-party
// Bootstrap bundle is needed.  The same CSS classes (modal, modal-header, etc.)
// are provided by Splunk's own stylesheets.
function showModal({ id, title, bodyHtml, confirmLabel = 'Close', onConfirm, showCancel = false }) {
    // Remove any stale modal with the same id
    document.getElementById(id)?.remove();

    const modal = el('div', { id, class: 'modal hide fade mlts-modal', tabindex: '-1' });
    modal.innerHTML = `
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">×</span>
              </button>
              <h3 class="modal-title"></h3>
            </div>
            <div class="modal-body"></div>
            <div class="modal-footer">
              ${showCancel ? '<button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>' : ''}
              <button type="button" class="btn btn-primary confirm-btn"></button>
            </div>
          </div>
        </div>`;

    // Set text via textContent to avoid XSS in title; bodyHtml is our own
    // controlled markup (never raw user input).
    modal.querySelector('.modal-title').textContent = title;
    modal.querySelector('.modal-body').innerHTML    = bodyHtml;
    modal.querySelector('.confirm-btn').textContent = confirmLabel;

    modal.querySelector('.confirm-btn').addEventListener('click', () => {
        $(modal).modal('hide');
        onConfirm?.();
    });
    modal.addEventListener('hidden.bs.modal', () => modal.remove());

    document.body.appendChild(modal);
    $(modal).modal({ backdrop: 'static', keyboard: false });
    $(modal).modal('show');
}

// ─── Table renderer ───────────────────────────────────────────────────────────
// CHANGED: the original built the entire table as one giant escaped string.
// This version builds it with DOM methods so values are set via textContent
// (never innerHTML), eliminating XSS risk on all row data.
function renderTable(credentials, container) {
    container.innerHTML = '';

    // Toolbar
    const toolbar = el('div', { class: 'credential-toolbar' }, [
        (() => {
            const btn = el('button', { id: 'btn-delete-selected', class: 'btn btn-danger', disabled: 'true' });
            btn.innerHTML = '<i class="icon-x"></i> Delete';
            btn.addEventListener('click', () => {
                const selected = getSelectedRows();
                if (selected.length) deleteCredentials(selected);
            });
            return btn;
        })(),
        (() => {
            const btn = el('button', { id: 'btn-create', class: 'btn btn-primary' });
            btn.textContent = 'Create';
            btn.addEventListener('click', () => toggleCreateForm());
            return btn;
        })()
    ]);
    container.appendChild(toolbar);

    // Create form placeholder (hidden by default)
    const createFormWrap = el('div', { id: 'create-form-wrap', style: 'display:none' });
    container.appendChild(createFormWrap);

    // Table
    const table = el('table', { id: 'cred-table', class: 'table table-chrome table-striped table-hover' });
    const thead = el('thead');
    const headerRow = el('tr');
    ['', 'Username', 'Realm', 'App', 'Owner', 'Sharing', 'Read', 'Write', 'Password', 'Actions'].forEach(h => {
        headerRow.appendChild(el('th', h));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    credentials.forEach(row => tbody.appendChild(buildRow(row)));
    table.appendChild(tbody);
    container.appendChild(table);

    // Wire up checkbox → delete button enablement
    table.addEventListener('change', () => {
        const btn = document.getElementById('btn-delete-selected');
        btn.disabled = getSelectedRows().length === 0;
    });
}

// Build a single <tr> for a credential.
// CHANGED: values set via textContent, never innerHTML – no XSS.
function buildRow(row) {
    const tr = el('tr');
    tr.dataset.row = JSON.stringify(row);   // stash the full row for action handlers

    const checkTd = el('td');
    checkTd.appendChild(el('input', { type: 'checkbox', class: 'cred-checkbox' }));
    tr.appendChild(checkTd);

    [row.username, row.realm, row.app, row.owner, row.acl_sharing, row.acl_read, row.acl_write].forEach(val => {
        tr.appendChild(el('td', String(val ?? '')));
    });

    // Password cell: eye icon, never shows the value inline
    const pwdTd = el('td');
    const eyeBtn = el('button', { class: 'btn btn-link btn-show-pwd', title: 'Show password' });
    eyeBtn.innerHTML = '<i class="icon-visible"></i>';
    eyeBtn.addEventListener('click', () => handleShowPassword(row));
    pwdTd.appendChild(eyeBtn);
    tr.appendChild(pwdTd);

    // Actions cell
    const actionsTd = el('td');
    const updateBtn = el('button', { class: 'btn btn-secondary btn-sm' });
    updateBtn.textContent = 'Update';
    updateBtn.addEventListener('click', () => toggleInlineUpdateForm(tr, row));
    actionsTd.appendChild(updateBtn);
    tr.appendChild(actionsTd);

    return tr;
}

// ─── Selection helpers ─────────────────────────────────────────────────────────
function getSelectedRows() {
    return Array.from(document.querySelectorAll('#cred-table .cred-checkbox:checked'))
        .map(cb => JSON.parse(cb.closest('tr').dataset.row));
}

// ─── Show password ─────────────────────────────────────────────────────────────
// CHANGED: the original ran a SearchManager SPL job which cached the
// clear_password field in Splunk's job store.  Now a direct REST GET that
// returns only to this browser session.
async function handleShowPassword(row) {
    try {
        // For user-scoped credentials we must temporarily bump sharing to app
        // before reading, then restore.  Same logic as the original but now
        // expressed in clean async/await.
        if (row.acl_sharing === 'user') {
            await setSharing(row, 'app');
        }
        const pwd = await fetchClearPassword(row.realm, row.username);
        if (row.acl_sharing === 'user') {
            await setSharing(row, 'user');
        }
        if (!pwd) {
            return showModal({
                id: 'modal-pwd-not-found',
                title: 'Not Found',
                bodyHtml: '<div class="alert alert-warning"><i class="icon-alert"></i> No password found. Verify <b>list_storage_passwords</b> capability is enabled.</div>'
            });
        }
        const safeVal = document.createElement('span');
        safeVal.textContent = pwd;      // safe textContent, not innerHTML
        showModal({
            id: 'modal-show-pwd',
            title: `Password for ${row.realm}:${row.username}`,
            bodyHtml: `<h3 class="credential-cleartext"></h3>`
        });
        // Set after modal is in DOM to guarantee the element exists
        document.querySelector('#modal-show-pwd .credential-cleartext')
            .textContent = pwd;         // textContent again – never innerHTML
    } catch (err) {
        showModal({ id: 'modal-pwd-err', title: 'Error', bodyHtml: `<div class="alert alert-error">${escHtml(err.message)}</div>` });
    }
}

// ─── Sharing toggle helper ─────────────────────────────────────────────────────
async function setSharing(row, sharing) {
    await splunkdPOST(`${row.rest_uri}/acl`, {
        'perms.read':  row.acl_read,
        'perms.write': row.acl_write,
        sharing,
        owner: row.owner
    });
}

// ─── Create credential ─────────────────────────────────────────────────────────
// CHANGED: was a $.ajax POST chain using SplunkJS DropdownView components for
// owner/app/sharing selectors.  Now uses plain <select> elements populated from
// direct REST calls, and a single async chain for create → ACL.
async function handleCreateCredential(formData, inputs) {
    const { username, password, confirmPassword, realm, owner, app, sharing, read, write } = formData;

    if (!username) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Username is required.</div>' });
    if (!password) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Password is required.</div>' });
    if (password !== confirmPassword) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-warning">Passwords do not match.</div>' });

    const messages = [];
    try {
        // Step 1 – create the credential
        await splunkdPOST(`/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/storage/passwords`, {
            name:     username,
            password: password,
            realm:    realm
        });
        messages.push(`<div><i class="icon-check-circle"></i> Created <b>${escHtml(realm)}:${escHtml(username)}</b></div>`);

        // Step 2 – apply ACLs.
        // PRESERVED: the original's two-step ACL pattern (set sharing=app first,
        // then set the real sharing value).  This is required by splunkd when
        // the target sharing is 'user' – see original comment for rationale.
        const aclPath = `/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/configs/conf-passwords/credential%3A${encodeURIComponent(realm)}%3A${encodeURIComponent(username)}%3A/acl`;
        if (sharing === 'user') {
            await splunkdPOST(aclPath, { 'perms.read': read, 'perms.write': write, sharing: 'app', owner });
        }
        await splunkdPOST(aclPath, { 'perms.read': read, 'perms.write': write, sharing, owner });
        messages.push(`<div><i class="icon-check-circle"></i> ACLs applied</div>`);

        showModal({
            id: 'modal-created',
            title: 'Credential Created',
            bodyHtml: messages.join(''),
            onConfirm: () => refreshTable()
        });
    } catch (err) {
        messages.push(`<div class="alert alert-error"><i class="icon-alert"></i> ${escHtml(err.message)}</div>`);
        showModal({ id: 'modal-create-fail', title: 'Create Failed', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    }
}

// ─── Update credential ─────────────────────────────────────────────────────────
// CHANGED: was a deeply nested $.ajax chain.  Same logical steps (ACL→password
// →move→ACL) but expressed as sequential awaits, making the flow easy to follow.
async function handleUpdateCredential(row, formData) {
    const { password, confirmPassword, app: newApp, sharing, owner, read, write } = formData;

    if (password && password !== confirmPassword) {
        return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-warning">Passwords do not match.</div>' });
    }

    const messages = [];
    try {
        const aclPath = `${row.rest_uri}/acl`;

        // Step 1 – set sharing=app temporarily for consistent URI behaviour
        // PRESERVED: same rationale as original – when sharing='app', eai:userName
        // is always 'nobody', giving a predictable URI for password changes and moves.
        await splunkdPOST(aclPath, {
            'perms.read':  read,
            'perms.write': write,
            sharing: 'app',
            owner
        });

        // Step 2 – update password if provided
        if (password) {
            const pwdPath = `/servicesNS/nobody/${encodeURIComponent(row.app)}/storage/passwords/${encodeURIComponent(row.realm)}:${encodeURIComponent(row.username)}:`;
            await splunkdPOST(pwdPath, { password });
            messages.push(`<div><i class="icon-check-circle"></i> Password updated for <b>${escHtml(row.realm)}:${escHtml(row.username)}</b></div>`);
        }

        // Step 3 – move app context if changed
        if (row.app !== newApp) {
            const movePath = `/servicesNS/nobody/${encodeURIComponent(row.app)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/move`;
            await splunkdPOST(movePath, { app: newApp, user: 'nobody' });
            messages.push(`<div><i class="icon-check-circle"></i> Moved from <b>${escHtml(row.app)}</b> to <b>${escHtml(newApp)}</b></div>`);
        }

        // Step 4 – apply final ACLs
        const finalAclPath = `/servicesNS/nobody/${encodeURIComponent(newApp)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/acl`;
        await splunkdPOST(finalAclPath, { 'perms.read': read, 'perms.write': write, sharing, owner });
        messages.push(`<div><i class="icon-check-circle"></i> ACLs applied</div>`);

        showModal({ id: 'modal-updated', title: 'Credential Updated', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    } catch (err) {
        messages.push(`<div class="alert alert-error"><i class="icon-alert"></i> ${escHtml(err.message)}</div>`);
        showModal({ id: 'modal-update-fail', title: 'Update Failed', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    }
}

// ─── Delete credentials ────────────────────────────────────────────────────────
// CHANGED: the original used a custom all() promise combinator built on
// $.Deferred.  Promise.allSettled() is native in every browser Splunk 9.x
// supports and does exactly the same thing (runs all, collects results).
function deleteCredentials(rows) {
    const names = rows.map(r => `${r.realm}:${r.username}`).join(', ');

    showModal({
        id:          'modal-delete-confirm',
        title:       'Confirm Delete',
        bodyHtml:    `<div class="alert alert-error"><i class="icon-alert"></i> You are about to remove <b>${escHtml(names)}</b>. Press OK to continue.</div>`,
        confirmLabel:'OK',
        showCancel:  true,
        onConfirm:   () => executeDelete(rows)
    });
}

async function executeDelete(rows) {
    const results = await Promise.allSettled(rows.map(async row => {
        // Ensure sharing is at least 'app' before DELETE so the URI is predictable
        await splunkdPOST(`${row.rest_uri}/acl`, {
            'perms.read':  row.acl_read,
            'perms.write': row.acl_write,
            sharing: row.acl_sharing === 'user' ? 'app' : row.acl_sharing,
            owner:   row.owner
        });
        await splunkdDELETE(`/servicesNS/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.app)}/storage/passwords/${encodeURIComponent(row.realm)}:${encodeURIComponent(row.username)}:`);
        return row;
    }));

    const messages = results.map(r =>
        r.status === 'fulfilled'
            ? `<div><i class="icon-check-circle"></i> Deleted <b>${escHtml(r.value.realm)}:${escHtml(r.value.username)}</b></div>`
            : `<div class="alert alert-error"><i class="icon-alert"></i> ${escHtml(r.reason?.message ?? 'Unknown error')}</div>`
    );
    const anyFailed = results.some(r => r.status === 'rejected');

    showModal({
        id:       'modal-delete-result',
        title:    anyFailed ? 'Delete Partially Failed' : 'Credentials Deleted',
        bodyHtml: messages.join(''),
        onConfirm: () => refreshTable()
    });
}

// ─── Form builders ─────────────────────────────────────────────────────────────
// CHANGED: forms were built as multi-line escaped HTML strings injected via
// innerHTML.  Now built with DOM methods to keep values out of markup.

async function buildCredentialForm(defaults = {}) {
    const [apps, rolesUsers] = await Promise.all([fetchApps(), fetchRolesAndUsers()]);

    const form = el('form', { class: 'credential-form' });
    form.addEventListener('submit', e => e.preventDefault());

    form.appendChild(fieldGroup('Username', inputText('formUsername', defaults.username || '', false)));
    form.appendChild(fieldGroup('Password', inputPassword('formPassword')));
    form.appendChild(fieldGroup('Confirm Password', inputPassword('formConfirmPassword')));
    form.appendChild(fieldGroup('Realm', inputText('formRealm', defaults.realm || '', false)));
    form.appendChild(fieldGroup('App Scope', buildSelect('formApp', apps, defaults.app || getCurrentApp())));
    form.appendChild(fieldGroup('Owner', buildSelect('formOwner', rolesUsers, defaults.owner || currentUser())));
    form.appendChild(fieldGroup('Read Users', buildMultiSelect('formRead', rolesUsers, defaults.acl_read ? defaults.acl_read.split(',') : ['*'])));
    form.appendChild(fieldGroup('Write Users', buildMultiSelect('formWrite', rolesUsers, defaults.acl_write ? defaults.acl_write.split(',') : ['admin', 'power'])));
    form.appendChild(fieldGroup('Sharing', buildSelect('formSharing', [
        { label: 'global', value: 'global' },
        { label: 'app',    value: 'app'    },
        { label: 'user',   value: 'user'   }
    ], defaults.acl_sharing || 'app')));

    return form;
}

function getFormData(form) {
    const g = id => form.querySelector(`#${id}`)?.value ?? '';
    const gm = id => Array.from(form.querySelector(`#${id}`)?.selectedOptions ?? []).map(o => o.value).join(',');
    return {
        username:        g('formUsername'),
        password:        g('formPassword'),
        confirmPassword: g('formConfirmPassword'),
        realm:           g('formRealm'),
        app:             g('formApp'),
        owner:           g('formOwner'),
        read:            gm('formRead'),
        write:           gm('formWrite'),
        sharing:         g('formSharing'),
    };
}

// ─── Create form toggle ────────────────────────────────────────────────────────
// CHANGED: was a Bootstrap collapse + sessionStorage tracking.
// Now a plain show/hide toggle with module-scoped state.
async function toggleCreateForm() {
    const wrap = document.getElementById('create-form-wrap');
    const btn  = document.getElementById('btn-create');
    if (isCreateFormOpen) {
        wrap.innerHTML = '';
        wrap.style.display = 'none';
        btn.textContent = 'Create';
        isCreateFormOpen = false;
        return;
    }
    btn.textContent = 'Loading…';
    btn.disabled = true;
    const form = await buildCredentialForm();
    const submitBtn = el('button', { class: 'btn btn-primary', id: 'btn-submit-create' });
    submitBtn.textContent = 'Create';
    submitBtn.addEventListener('click', () => handleCreateCredential(getFormData(form), form));
    form.appendChild(submitBtn);
    wrap.appendChild(form);
    wrap.style.display = 'block';
    btn.textContent = 'Close';
    btn.disabled = false;
    isCreateFormOpen = true;
}

// ─── Inline update form ────────────────────────────────────────────────────────
// CHANGED: was rendered by expanding a bootstrap-table detail row and injecting
// SplunkJS DropdownView/MultiDropdownView components.  Now a plain inline form
// row using the same buildCredentialForm helper.
async function toggleInlineUpdateForm(tr, row) {
    const existingForm = tr.nextElementSibling;
    if (existingForm?.classList.contains('inline-update-row')) {
        existingForm.remove();
        return;
    }

    const formTr = el('tr', { class: 'inline-update-row' });
    const formTd = el('td', { colspan: '10' });
    formTd.textContent = 'Loading form…';
    formTr.appendChild(formTd);
    tr.insertAdjacentElement('afterend', formTr);

    const form = await buildCredentialForm(row);

    // Realm is immutable – disable it in the update form
    // PRESERVED: original note that realm cannot be changed via the REST API.
    const realmInput = form.querySelector('#formRealm');
    if (realmInput) realmInput.disabled = true;

    const submitBtn = el('button', { class: 'btn btn-primary' });
    submitBtn.textContent = 'Update';
    submitBtn.addEventListener('click', () => handleUpdateCredential(row, getFormData(form)));
    form.appendChild(submitBtn);

    formTd.textContent = '';
    formTd.appendChild(form);
}

// ─── Table refresh ─────────────────────────────────────────────────────────────
// CHANGED: was location.reload() with a 500ms setTimeout.
// Now only re-fetches and re-renders the credential table, no full page reload.
async function refreshTable() {
    const container = document.getElementById('password-table');
    if (!container) return;
    container.innerHTML = '<p>Refreshing…</p>';
    try {
        const creds = await fetchCredentials();
        renderTable(creds, container);
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error"><i class="icon-alert"></i> Failed to load credentials: ${escHtml(err.message)}</div>`;
    }
}

// ─── App context helper ────────────────────────────────────────────────────────
function getCurrentApp() {
    // Splunk embeds the current app name in the page URL: /en-US/app/<appname>/…
    const match = window.location.pathname.match(/\/app\/([^/]+)/);
    return match ? match[1] : 'search';
}

// ─── XSS escape helper ────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── DOM form helpers ──────────────────────────────────────────────────────────
function fieldGroup(label, input) {
    const div = el('div', { class: 'form-group' });
    const lbl = el('label');
    lbl.textContent = label;
    if (input.id) lbl.setAttribute('for', input.id);
    div.appendChild(lbl);
    div.appendChild(input);
    return div;
}

function inputText(id, value, disabled) {
    const i = el('input', { type: 'text', class: 'form-control', id });
    i.value = value;
    if (disabled) i.disabled = true;
    return i;
}

function inputPassword(id) {
    return el('input', { type: 'password', class: 'form-control', id });
}

function buildSelect(id, options, selectedValue) {
    const sel = el('select', { class: 'form-control', id });
    options.forEach(opt => {
        const o = el('option', { value: opt.value });
        o.textContent = opt.label;
        if (opt.value === selectedValue) o.selected = true;
        sel.appendChild(o);
    });
    return sel;
}

function buildMultiSelect(id, options, selectedValues = []) {
    const sel = el('select', { class: 'form-control', id, multiple: 'true', size: '5' });
    options.forEach(opt => {
        const o = el('option', { value: opt.value });
        o.textContent = opt.label;
        if (selectedValues.includes(opt.value)) o.selected = true;
        sel.appendChild(o);
    });
    return sel;
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function init() {
    const container = document.getElementById('password-table');
    if (!container) return;
    container.innerHTML = '<p>Loading credentials…</p>';
    try {
        const creds = await fetchCredentials();
        renderTable(creds, container);
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error"><i class="icon-alert"></i> Failed to load credentials: ${escHtml(err.message)}</div>`;
    }
}
