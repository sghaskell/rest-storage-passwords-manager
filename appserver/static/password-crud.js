/**
 * password-crud.js  –  Modernized for Splunk 9.2+ / Cloud
 *
 * WHAT CHANGED vs. the original:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. REMOVED  splunkjs/mvc and all SplunkJS MVC components (SearchManager,
 *    DropdownView, MultiDropdownView).  These are deprecated in 9.x and absent
 *    in many Cloud builds.  All data fetching now goes directly to splunkd
 *    via fetch() calls to splunkd/__raw.
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
 *
 * 8. KEPT     require(['splunkjs/mvc/simplexml/ready!']) as the sole bootstrap
 *    hook.  This is used purely as a lifecycle trigger — it fires reliably
 *    after all classic dashboard panels have finished rendering.  No other
 *    splunkjs/mvc components are used anywhere in this file.
 *
 * FIXES applied post-initial-release:
 *   - Removed splunk_server=local from fetchCredentials() — not a valid
 *     parameter for the storage/passwords REST handler (was SPL-only)
 *   - CSRF token (X-Splunk-Form-Key) added to all mutating requests; cookie
 *     name includes the port on some installs, so matched with startsWith
 *   - ACL operations now use the configs/conf-passwords path instead of
 *     storage/passwords/.../acl which returns 404; buildAclPath() centralises
 *     this and replaces all ${row.rest_uri}/acl references
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Module-level state ───────────────────────────────────────────────────────
// CHANGED: was window.sessionStorage – see note 5 above.
let isCreateFormOpen = false;
let allCredentials   = [];   // cached after each fetch; reused by paginator
let filterText       = '';   // persists across renderTable calls; cleared on full refresh
let currentPage      = 1;    // resets to 1 on every full table refresh
const PAGE_SIZE      = 10;   // rows per page; paginator hidden when total ≤ this

// ─── Current username helper ──────────────────────────────────────────────────
function currentUser() {
    return Splunk.util.getConfigValue('USERNAME');
}

// ─── Safe DOM element helper (XSS guard) ──────────────────────────────────────
// Values set via textContent/setAttribute — never interpreted as markup.
function el(tag, textOrAttrs, children) {
    const node = document.createElement(tag);
    if (typeof textOrAttrs === 'string') {
        node.textContent = textOrAttrs;
    } else if (textOrAttrs && typeof textOrAttrs === 'object') {
        Object.entries(textOrAttrs).forEach(([k, v]) => node.setAttribute(k, v));
    }
    (children || []).forEach(c => c && node.appendChild(c));
    return node;
}

// ─── splunkd REST helper ───────────────────────────────────────────────────────
// CHANGED: replaces $.ajax chains with fetch() + async/await.
async function splunkdFetch(method, path, data) {
    const url = `/en-US/splunkd/__raw${path}`;

    // Read Splunk CSRF token — cookie name includes port on some installs
    // e.g. splunkweb_csrf_token_8000 vs splunkweb_csrf_token
    const csrfToken = document.cookie.split('; ')
        .find(row => row.startsWith('splunkweb_csrf_token'))
        ?.split('=')[1];

    const opts = {
        method,
        credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
    };

    if (csrfToken) {
        opts.headers['X-Splunk-Form-Key'] = csrfToken;
    }

    if (data) {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        opts.body = new URLSearchParams(data).toString();
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Splunk returns XML error responses — extract the <msg> text if present,
        // otherwise fall back to the raw status text.
        const xmlMsg = text.match(/<msg[^>]*>([^<]+)<\/msg>/)?.[1]?.trim();
        const err = new Error(xmlMsg || `${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
    }
    return res;
}
const splunkdGET    = (path)       => splunkdFetch('GET',    path);
const splunkdPOST   = (path, data) => splunkdFetch('POST',   path, data);
const splunkdDELETE = (path)       => splunkdFetch('DELETE', path);

// ─── Data fetchers ─────────────────────────────────────────────────────────────

/**
 * Fetch all credentials visible to the current user.
 * NOTE: splunk_server=local is intentionally omitted — it is only a valid
 * parameter for the SPL | rest command, not the REST API handler directly.
 */
async function fetchCredentials() {
    const res  = await splunkdGET('/servicesNS/-/-/storage/passwords?output_mode=json&count=0');
    const json = await res.json();
    return (json.entry || []).map(e => ({
        username:    e.content.username,
        realm:       e.content.realm       || '',
        app:         e.acl.app,
        owner:       e.acl.owner,
        acl_read:    (e.acl.perms && e.acl.perms.read  || []).join(','),
        acl_write:   (e.acl.perms && e.acl.perms.write || []).join(','),
        acl_sharing: e.acl.sharing,
        rest_uri:    e.links.edit || e.links.alternate,
    }));
}

/**
 * Fetch the clear-text password for a single credential.
 * Direct REST GET — never touches the search tier or job cache.
 */
async function fetchClearPassword(realm, username) {
    const key  = encodeURIComponent(`${realm}:${username}:`);
    const res  = await splunkdGET(`/servicesNS/-/-/storage/passwords/${key}?output_mode=json`);
    const json = await res.json();
    return json.entry?.[0]?.content?.clear_password ?? null;
}

/** Fetch apps list for the app-scope dropdown. */
async function fetchApps() {
    const res  = await splunkdGET('/servicesNS/-/-/apps/local?output_mode=json&count=0&search=disabled%3D0');
    const json = await res.json();
    return (json.entry || []).map(e => ({ label: e.content.label || e.name, value: e.name }));
}

/** Fetch roles for Read/Write ACL pickers. Prepends * (all roles) as first option. */
async function fetchRoles() {
    const res  = await splunkdGET('/servicesNS/-/-/authorization/roles?output_mode=json&count=0');
    const json = await res.json();
    return [
        { label: '* (all)', value: '*' },
        ...(json.entry || []).map(e => ({ label: e.name, value: e.name }))
    ];
}

/** Fetch users for the Owner picker. */
async function fetchUsers() {
    const res  = await splunkdGET('/servicesNS/-/-/authentication/users?output_mode=json&count=0');
    const json = await res.json();
    return (json.entry || []).map(e => ({ label: e.name, value: e.name }));
}

// ─── Modal helper ─────────────────────────────────────────────────────────────
// Uses Splunk-native modal CSS classes — no Bootstrap bundle needed.
function showModal({ id, title, bodyHtml, confirmLabel = 'Close', onConfirm, showCancel = false }) {
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
function renderTable(credentials, container) {
    // Cache the full list so the paginator can re-render without a re-fetch.
    // When called from refreshTable/init, credentials is the full array.
    // When called from goToPage, credentials is already allCredentials.
    if (credentials !== allCredentials) allCredentials = credentials;

    // Apply client-side filter (username, realm, app — case-insensitive substring).
    const lc = filterText.toLowerCase();
    const visible = lc
        ? allCredentials.filter(r =>
            [r.username, r.realm, r.app].some(f => (f || '').toLowerCase().includes(lc)))
        : allCredentials;

    const totalPages = Math.ceil(visible.length / PAGE_SIZE);
    // Clamp currentPage in case a delete or filter shrank the last page away.
    if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
    if (totalPages === 0) currentPage = 1;

    const pageSlice = visible.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
    );

    container.innerHTML = '';

    // Filter input — value is preserved via the module-level filterText variable.
    const filterInput = el('input', { type: 'search', class: 'form-control cred-filter',
        placeholder: 'Filter by username, realm, or app…' });
    filterInput.value = filterText;
    filterInput.addEventListener('input', e => {
        filterText = e.target.value;
        currentPage = 1;
        renderTable(allCredentials, container);
        const restored = container.querySelector('.cred-filter');
        if (restored) { restored.focus(); const len = restored.value.length; restored.setSelectionRange(len, len); }
    });

    // Hidden file input for CSV import
    const fileInput = el('input', { type: 'file', accept: '.csv', style: 'display:none' });
    fileInput.addEventListener('change', e => { handleImportFile(e.target.files[0]); e.target.value = ''; });

    // Import dropdown — toggle on click, close on outside click
    const importDropdown = (() => {
        const wrap = el('div', { class: 'cred-import-wrap' });

        const toggleBtn = el('button', { class: 'btn btn-default cred-import-toggle' });
        toggleBtn.innerHTML = 'Import <i class="icon-chevron-down" style="font-size:10px;vertical-align:middle"></i>';

        const menu = el('div', { class: 'cred-import-menu' });

        const uploadItem = el('button', { class: 'cred-import-item', type: 'button' });
        uploadItem.innerHTML = '<i class="icon-upload"></i> Upload CSV';
        uploadItem.addEventListener('click', () => { menu.classList.remove('open'); fileInput.click(); });

        const templateItem = el('button', { class: 'cred-import-item', type: 'button' });
        templateItem.innerHTML = '<i class="icon-download-alt"></i> Download Template';
        templateItem.addEventListener('click', () => { menu.classList.remove('open'); downloadCSVTemplate(); });

        menu.appendChild(uploadItem);
        menu.appendChild(templateItem);

        toggleBtn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('open'); });
        document.addEventListener('click', () => menu.classList.remove('open'));

        wrap.appendChild(toggleBtn);
        wrap.appendChild(menu);
        wrap.appendChild(fileInput);
        return wrap;
    })();

    const toolbar = el('div', { class: 'credential-toolbar' }, [
        filterInput,
        (() => {
            const btn = el('button', { id: 'btn-delete-selected', class: 'btn btn-danger', disabled: 'true' });
            btn.innerHTML = '<i class="icon-x"></i> Delete';
            btn.addEventListener('click', () => {
                const selected = getSelectedRows();
                if (selected.length) deleteCredentials(selected);
            });
            return btn;
        })(),
        importDropdown,
        (() => {
            const btn = el('button', { id: 'btn-create', class: 'btn btn-primary' });
            btn.textContent = '+ New Credential';
            btn.addEventListener('click', () => toggleCreateForm());
            return btn;
        })(),
    ]);
    container.appendChild(toolbar);

    const createFormWrap = el('div', { id: 'create-form-wrap', style: 'display:none' });
    container.appendChild(createFormWrap);

    const table = el('table', { id: 'cred-table', class: 'table table-chrome table-striped table-hover' });
    const thead = el('thead');
    const headerRow = el('tr');
    const selectAllTh = el('th');
    const selectAllCb = el('input', { type: 'checkbox', title: 'Select all' });
    selectAllCb.addEventListener('change', () => {
        document.querySelectorAll('#cred-table .cred-checkbox').forEach(cb => { cb.checked = selectAllCb.checked; });
        const btn = document.getElementById('btn-delete-selected');
        if (btn) btn.disabled = !selectAllCb.checked;
    });
    selectAllTh.appendChild(selectAllCb);
    headerRow.appendChild(selectAllTh);
    ['Username', 'Realm', 'App', 'Owner', 'Sharing', 'Read', 'Write', 'Password', ''].forEach(h => {
        headerRow.appendChild(el('th', h));
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    if (visible.length === 0) {
        const emptyTd = el('td', { colspan: '10', class: 'cred-empty-state' });
        emptyTd.innerHTML = lc
            ? 'No credentials match your filter.'
            : 'No credentials found. Click <strong>+ New Credential</strong> to get started.';
        const emptyRow = el('tr');
        emptyRow.appendChild(emptyTd);
        tbody.appendChild(emptyRow);
    } else {
        pageSlice.forEach(row => tbody.appendChild(buildRow(row)));
    }
    table.appendChild(tbody);
    container.appendChild(table);

    table.addEventListener('change', e => {
        if (e.target === selectAllCb) return;  // handled by its own listener
        const allCbs = Array.from(document.querySelectorAll('#cred-table .cred-checkbox'));
        selectAllCb.checked = allCbs.length > 0 && allCbs.every(cb => cb.checked);
        selectAllCb.indeterminate = !selectAllCb.checked && allCbs.some(cb => cb.checked);
        const btn = document.getElementById('btn-delete-selected');
        btn.disabled = getSelectedRows().length === 0;
    });

    if (totalPages > 1) {
        container.appendChild(renderPaginator(totalPages, container));
    }
}

// ─── Paginator ────────────────────────────────────────────────────────────────
function renderPaginator(totalPages, container) {
    const wrap = el('div', { class: 'cred-paginator' });

    const prevBtn = el('button', { class: 'btn btn-default btn-sm' });
    prevBtn.textContent = '‹ Prev';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => { currentPage--; renderTable(allCredentials, container); });

    const label = el('span', { class: 'cred-page-label' });
    label.textContent = `Page ${currentPage} of ${totalPages}`;

    const nextBtn = el('button', { class: 'btn btn-default btn-sm' });
    nextBtn.textContent = 'Next ›';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => { currentPage++; renderTable(allCredentials, container); });

    wrap.appendChild(prevBtn);
    wrap.appendChild(label);
    wrap.appendChild(nextBtn);
    return wrap;
}

// Build a single <tr> — values via textContent, never innerHTML.
// Clicking anywhere on the row (except checkbox / eye button) expands the
// inline update form; clicking again collapses it.
function buildRow(row) {
    const tr = el('tr', { class: 'cred-row' });
    tr.dataset.row = JSON.stringify(row);

    // Row click → toggle inline update form (ignore clicks on input/button)
    tr.addEventListener('click', e => {
        if (e.target.closest('input, button')) return;
        toggleInlineUpdateForm(tr, row);
    });

    const checkTd = el('td');
    checkTd.appendChild(el('input', { type: 'checkbox', class: 'cred-checkbox' }));
    tr.appendChild(checkTd);

    [row.username, row.realm, row.app, row.owner, row.acl_sharing, row.acl_read, row.acl_write].forEach(val => {
        tr.appendChild(el('td', String(val ?? '')));
    });

    const pwdTd = el('td');
    const eyeBtn = el('button', { class: 'btn btn-link btn-show-pwd', title: 'Show password' });
    eyeBtn.innerHTML = '<i class="icon-visible"></i>';
    eyeBtn.addEventListener('click', () => handleShowPassword(row));
    pwdTd.appendChild(eyeBtn);
    tr.appendChild(pwdTd);

    // Chevron indicates row is expandable; rotates 90° when open
    const chevronTd = el('td', { style: 'text-align:center; vertical-align:middle; width:32px;' });
    const chevron = el('i', { class: 'icon-chevron-right cred-chevron' });
    chevronTd.appendChild(chevron);
    tr.appendChild(chevronTd);

    return tr;
}

// ─── Selection helpers ─────────────────────────────────────────────────────────
function getSelectedRows() {
    return Array.from(document.querySelectorAll('#cred-table .cred-checkbox:checked'))
        .map(cb => JSON.parse(cb.closest('tr').dataset.row));
}

// ─── Show password ─────────────────────────────────────────────────────────────
async function handleShowPassword(row) {
    try {
        // PRESERVED: temporary sharing bump required for user-scoped credentials
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
        showModal({
            id: 'modal-show-pwd',
            title: `Password for ${row.realm}:${row.username}`,
            bodyHtml: `<h3 class="credential-cleartext"></h3>`
        });
        document.querySelector('#modal-show-pwd .credential-cleartext').textContent = pwd;
    } catch (err) {
        showModal({ id: 'modal-pwd-err', title: 'Error', bodyHtml: `<div class="alert alert-error">${escHtml(err.message)}</div>` });
    }
}

// ─── ACL path helper ──────────────────────────────────────────────────────────
// FIX: storage/passwords/{stanza}/acl returns 404.  ACL updates for storage
// passwords must go through configs/conf-passwords using the credential stanza
// name.  All ${row.rest_uri}/acl references replaced with buildAclPath(row).
function buildAclPath(row) {
    return `/servicesNS/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.app)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/acl`;
}

// ─── Sharing toggle helper ─────────────────────────────────────────────────────
async function setSharing(row, sharing) {
    await splunkdPOST(buildAclPath(row), {
        'perms.read':  row.acl_read,
        'perms.write': row.acl_write,
        sharing,
        owner: row.owner
    });
}

// ─── Create credential (core — no modal, suitable for single and bulk use) ──────
async function createSingleCredential({ username, password, realm = '', app, owner, sharing = 'app', read = 'admin,power', write = 'admin,power' }) {
    await splunkdPOST(`/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/storage/passwords`, {
        name: username, password, realm
    });
    const aclPath = `/servicesNS/${encodeURIComponent(owner)}/${encodeURIComponent(app)}/configs/conf-passwords/credential%3A${encodeURIComponent(realm)}%3A${encodeURIComponent(username)}%3A/acl`;
    // PRESERVED: two-step ACL pattern required by splunkd when sharing='user'
    if (sharing === 'user') {
        await splunkdPOST(aclPath, { 'perms.read': read, 'perms.write': write, sharing: 'app', owner });
    }
    await splunkdPOST(aclPath, { 'perms.read': read, 'perms.write': write, sharing, owner });
}

// ─── Create credential (single form — validates then delegates to core) ─────────
async function handleCreateCredential(formData) {
    const { username, password, confirmPassword, realm, owner, app, sharing, read, write } = formData;

    if (!username) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Username is required.</div>' });
    if (!password) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Password is required.</div>' });
    if (password !== confirmPassword) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-warning">Passwords do not match.</div>' });
    if (!read)  return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Select at least one Read Users role (or * for all).</div>' });
    if (!write) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Select at least one Write Users role (or * for all).</div>' });

    const messages = [];
    try {
        await createSingleCredential({ username, password, realm, app, owner, sharing, read, write });
        messages.push(`<div><i class="icon-check-circle"></i> Created <b>${escHtml(realm)}:${escHtml(username)}</b></div>`);
        messages.push(`<div><i class="icon-check-circle"></i> ACLs applied</div>`);
        showModal({ id: 'modal-created', title: 'Credential Created', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    } catch (err) {
        if (err.status === 409) {
            messages.push(`<div class="alert alert-warning"><i class="icon-alert"></i> A credential already exists for <b>${escHtml(realm)}:${escHtml(username)}</b>. Click the row in the table to expand the update form and change the password.</div>`);
        } else {
            messages.push(`<div class="alert alert-error"><i class="icon-alert"></i> ${escHtml(err.message)}</div>`);
        }
        showModal({ id: 'modal-create-fail', title: 'Create Failed', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    }
}

// ─── Update credential ─────────────────────────────────────────────────────────
async function handleUpdateCredential(row, formData) {
    const { password, confirmPassword, app: newApp, sharing, owner, read, write } = formData;

    if (password && password !== confirmPassword) {
        return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-warning">Passwords do not match.</div>' });
    }
    if (!read)  return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Select at least one Read Users role (or * for all).</div>' });
    if (!write) return showModal({ id: 'modal-val', title: 'Validation', bodyHtml: '<div class="alert alert-error">Select at least one Write Users role (or * for all).</div>' });

    const messages = [];
    try {
        // PRESERVED: set sharing=app first for predictable splunkd URI behaviour
        await splunkdPOST(buildAclPath(row), { 'perms.read': read, 'perms.write': write, sharing: 'app', owner });

        if (password) {
            await splunkdPOST(
                `/servicesNS/nobody/${encodeURIComponent(row.app)}/storage/passwords/${encodeURIComponent(row.realm)}:${encodeURIComponent(row.username)}:`,
                { password }
            );
            messages.push(`<div><i class="icon-check-circle"></i> Password updated for <b>${escHtml(row.realm)}:${escHtml(row.username)}</b></div>`);
        }

        if (row.app !== newApp) {
            await splunkdPOST(
                `/servicesNS/nobody/${encodeURIComponent(row.app)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/move`,
                { app: newApp, user: 'nobody' }
            );
            messages.push(`<div><i class="icon-check-circle"></i> Moved from <b>${escHtml(row.app)}</b> to <b>${escHtml(newApp)}</b></div>`);
        }

        await splunkdPOST(
            `/servicesNS/nobody/${encodeURIComponent(newApp)}/configs/conf-passwords/credential%3A${encodeURIComponent(row.realm)}%3A${encodeURIComponent(row.username)}%3A/acl`,
            { 'perms.read': read, 'perms.write': write, sharing, owner }
        );
        messages.push(`<div><i class="icon-check-circle"></i> ACLs applied</div>`);

        showModal({ id: 'modal-updated', title: 'Credential Updated', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    } catch (err) {
        messages.push(`<div class="alert alert-error"><i class="icon-alert"></i> ${escHtml(err.message)}</div>`);
        showModal({ id: 'modal-update-fail', title: 'Update Failed', bodyHtml: messages.join(''), onConfirm: () => refreshTable() });
    }
}

// ─── Delete credentials ────────────────────────────────────────────────────────
function deleteCredentials(rows) {
    const names = rows.map(r => `${r.realm}:${r.username}`).join(', ');
    showModal({
        id: 'modal-delete-confirm',
        title: 'Confirm Delete',
        bodyHtml: `<div class="alert alert-error"><i class="icon-alert"></i> You are about to remove <b>${escHtml(names)}</b>. Press OK to continue.</div>`,
        confirmLabel: 'OK',
        showCancel: true,
        onConfirm: () => executeDelete(rows)
    });
}

async function executeDelete(rows) {
    const results = await Promise.allSettled(rows.map(async row => {
        // PRESERVED: ACL bump before DELETE for predictable URI
        await splunkdPOST(buildAclPath(row), {
            'perms.read':  row.acl_read,
            'perms.write': row.acl_write,
            sharing: row.acl_sharing === 'user' ? 'app' : row.acl_sharing,
            owner:   row.owner
        });
        await splunkdDELETE(
            `/servicesNS/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.app)}/storage/passwords/${encodeURIComponent(row.realm)}:${encodeURIComponent(row.username)}:`
        );
        return row;
    }));

    const messages = results.map(r =>
        r.status === 'fulfilled'
            ? `<div><i class="icon-check-circle"></i> Deleted <b>${escHtml(r.value.realm)}:${escHtml(r.value.username)}</b></div>`
            : `<div class="alert alert-error"><i class="icon-alert"></i> ${escHtml(r.reason?.message ?? 'Unknown error')}</div>`
    );

    showModal({
        id: 'modal-delete-result',
        title: results.some(r => r.status === 'rejected') ? 'Delete Partially Failed' : 'Credentials Deleted',
        bodyHtml: messages.join(''),
        onConfirm: () => refreshTable()
    });
}

// ─── Form builders ─────────────────────────────────────────────────────────────
async function buildCredentialForm(defaults = {}) {
    const [apps, roles, users] = await Promise.all([fetchApps(), fetchRoles(), fetchUsers()]);

    const form = el('form', { class: 'credential-form' });
    form.addEventListener('submit', e => e.preventDefault());

    form.appendChild(fieldGroup('Username',        inputText('formUsername',     defaults.username    || '', false)));
    form.appendChild(fieldGroup('Password',        inputPassword('formPassword')));
    form.appendChild(fieldGroup('Confirm Password',inputPassword('formConfirmPassword')));
    form.appendChild(fieldGroup('Realm',           inputText('formRealm',        defaults.realm       || '', false)));
    form.appendChild(fieldGroup('App Scope',       buildSelect('formApp',        apps,  defaults.app            || getCurrentApp()),
        'Credentials are stored in this app\'s local directory and will be lost if it is uninstalled. Choose a long-lived app (e.g. search) if they need to survive reinstalls.',
        'hint-warning'));
    form.appendChild(fieldGroup('Owner',           buildSelect('formOwner',      users, defaults.owner          || currentUser())));
    form.appendChild(fieldGroup('Read Users',      buildMultiSelect('formRead',  roles, defaults.acl_read       ? defaults.acl_read.split(',')  : ['admin', 'power'], ['admin', 'power'])));
    form.appendChild(fieldGroup('Write Users',     buildMultiSelect('formWrite', roles, defaults.acl_write      ? defaults.acl_write.split(',') : ['admin', 'power'], ['admin', 'power'])));
    form.appendChild(fieldGroup('Sharing',         buildSelect('formSharing', [
        { label: 'global', value: 'global' },
        { label: 'app',    value: 'app'    },
        { label: 'user',   value: 'user'   }
    ], defaults.acl_sharing || 'app')));

    // Show the App Scope warning only when the selected app is this app.
    const appSelect  = form.querySelector('#formApp');
    const appHint    = appSelect?.closest('.form-group')?.querySelector('.hint-warning');
    if (appSelect && appHint) {
        const refresh = () => {
            appHint.style.display = appSelect.value === getCurrentApp() ? '' : 'none';
        };
        appSelect.addEventListener('change', refresh);
        refresh();
    }

    return form;
}

function getFormData(form) {
    const g  = id => form.querySelector(`#${id}`)?.value ?? '';
    const gm = id => Array.from(form.querySelector(`#${id}`)?.selectedOptions ?? [])
        .map(o => o.value).join(',');
    return {
        username:        g('formUsername').trim(),
        password:        g('formPassword'),
        confirmPassword: g('formConfirmPassword'),
        realm:           g('formRealm').trim(),
        app:             g('formApp'),
        owner:           g('formOwner'),
        read:            gm('formRead'),
        write:           gm('formWrite'),
        sharing:         g('formSharing'),
    };
}

// ─── Create form toggle ────────────────────────────────────────────────────────
async function toggleCreateForm() {
    const wrap = document.getElementById('create-form-wrap');
    const btn  = document.getElementById('btn-create');
    if (isCreateFormOpen) {
        wrap.innerHTML = '';
        wrap.style.display = 'none';
        btn.textContent = '+ New Credential';
        isCreateFormOpen = false;
        return;
    }
    btn.innerHTML = '<span class="cred-spinner"></span> Loading…';
    btn.disabled = true;
    const form = await buildCredentialForm();
    const submitBtn = el('button', { class: 'btn btn-primary', id: 'btn-submit-create' });
    submitBtn.textContent = 'Create';
    submitBtn.addEventListener('click', () => handleCreateCredential(getFormData(form)));
    form.appendChild(submitBtn);
    wrap.appendChild(form);
    wrap.style.display = 'block';
    btn.textContent = 'Close';
    btn.disabled = false;
    isCreateFormOpen = true;
}

// ─── Inline update form ────────────────────────────────────────────────────────
async function toggleInlineUpdateForm(tr, row) {
    const existingForm = tr.nextElementSibling;
    if (existingForm?.classList.contains('inline-update-row')) {
        existingForm.remove();
        tr.classList.remove('row-expanded');
        return;
    }
    tr.classList.add('row-expanded');

    const formTr = el('tr', { class: 'inline-update-row' });
    const formTd = el('td', { colspan: '10' });
    showLoading(formTd, 'Loading form…');
    formTr.appendChild(formTd);
    tr.insertAdjacentElement('afterend', formTr);

    const form = await buildCredentialForm(row);

    // PRESERVED: realm cannot be changed via REST API after creation
    const realmInput = form.querySelector('#formRealm');
    if (realmInput) realmInput.disabled = true;

    const submitBtn = el('button', { class: 'btn btn-primary' });
    submitBtn.textContent = 'Update';
    submitBtn.addEventListener('click', () => handleUpdateCredential(row, getFormData(form)));
    form.appendChild(submitBtn);

    formTd.textContent = '';
    formTd.appendChild(form);
}

// ─── Loading indicator helper ──────────────────────────────────────────────────
function showLoading(container, text) {
    const p      = el('p', { class: 'cred-loading' });
    const spinner = el('span', { class: 'cred-spinner' });
    p.appendChild(spinner);
    p.appendChild(document.createTextNode(text));
    container.innerHTML = '';
    container.appendChild(p);
}

// ─── Table refresh ─────────────────────────────────────────────────────────────
// CHANGED: was location.reload() — now re-fetches credentials only.
async function refreshTable() {
    const container = document.getElementById('password-table');
    if (!container) return;
    showLoading(container, 'Refreshing…');
    currentPage = 1;
    try {
        const creds = await fetchCredentials();
        renderTable(creds, container);
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error"><i class="icon-alert"></i> Failed to load credentials: ${escHtml(err.message)}</div>`;
    }
}

// ─── App context helper ────────────────────────────────────────────────────────
function getCurrentApp() {
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
function fieldGroup(label, input, hint, hintClass) {
    const div = el('div', { class: 'form-group' });
    const lbl = el('label');
    lbl.textContent = label;
    if (input.id) lbl.setAttribute('for', input.id);
    div.appendChild(lbl);
    div.appendChild(input);
    if (hint) {
        const hintEl = el('span', { class: 'help-block' + (hintClass ? ' ' + hintClass : '') });
        hintEl.textContent = hint;
        div.appendChild(hintEl);
    }
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

function buildMultiSelect(id, options, selectedValues = [], resetValues = selectedValues) {
    const wrap = el('div', { class: 'multi-select-wrap' });

    const counter = el('span', { class: 'multi-select-counter' });

    const sel = el('select', { class: 'form-control', id, multiple: 'true', size: '5' });
    options.forEach(opt => {
        const o = el('option', { value: opt.value });
        o.textContent = opt.label;
        if (selectedValues.includes(opt.value)) o.selected = true;
        sel.appendChild(o);
    });

    const actions = el('div', { class: 'multi-select-actions' });
    const selectAll = el('button', { type: 'button', class: 'btn btn-link btn-xs multi-select-btn' });
    selectAll.textContent = 'Select All';
    const clearBtn = el('button', { type: 'button', class: 'btn btn-link btn-xs multi-select-btn' });
    clearBtn.textContent = 'Reset';
    actions.appendChild(selectAll);
    actions.appendChild(clearBtn);

    const hint = el('span', { class: 'multi-select-hint' });
    hint.textContent = 'Hold Ctrl / ⌘ Cmd to select multiple';

    const updateCounter = () => {
        const n = Array.from(sel.selectedOptions).length;
        counter.textContent = `${n} selected`;
    };
    updateCounter();

    // * (all) is mutually exclusive with individual role selections.
    // Selecting * deselects all others; selecting any other role deselects *.
    sel.addEventListener('change', e => {
        const changed = e.target;  // the <option> that triggered the event
        if (changed.value === '*' && changed.selected) {
            Array.from(sel.options).forEach(o => { if (o.value !== '*') o.selected = false; });
        } else if (changed.value !== '*' && changed.selected) {
            const wildcard = Array.from(sel.options).find(o => o.value === '*');
            if (wildcard) wildcard.selected = false;
        }
        updateCounter();
    });

    // "Select All" selects every named role but NOT *, keeping the meaning distinct.
    selectAll.addEventListener('click', () => {
        Array.from(sel.options).forEach(o => { o.selected = o.value !== '*'; });
        updateCounter();
    });
    clearBtn.addEventListener('click', () => {
        Array.from(sel.options).forEach(o => { o.selected = resetValues.includes(o.value); });
        updateCounter();
    });

    wrap.appendChild(counter);
    wrap.appendChild(sel);
    wrap.appendChild(actions);
    wrap.appendChild(hint);
    return wrap;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() && !l.trimStart().startsWith('#'));
    if (lines.length < 2) return { rows: [], errors: ['File is empty or has no data rows.'] };

    // RFC 4180-compliant field splitter
    function splitLine(line) {
        const fields = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuote) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') inQuote = false;
                else cur += ch;
            } else {
                if (ch === '"') inQuote = true;
                else if (ch === ',') { fields.push(cur); cur = ''; }
                else cur += ch;
            }
        }
        fields.push(cur);
        return fields;
    }

    const headers = splitLine(lines[0]).map(h => h.trim().toLowerCase());
    const defaultApp     = getCurrentApp();
    const defaultOwner   = currentUser();
    const rows = [], errors = [];

    lines.slice(1).forEach((line, i) => {
        if (!line.trim()) return;
        const vals = splitLine(line);
        const row  = {};
        headers.forEach((h, j) => { row[h] = (vals[j] ?? '').trim(); });

        const username = row.username || '';
        const password = row.password || '';
        if (!username || !password) {
            errors.push(`Row ${i + 2}: ${!username ? 'username' : 'password'} is required — skipped.`);
            return;
        }
        rows.push({
            username,
            password,
            realm:   row.realm   || '',
            app:     row.app     || defaultApp,
            owner:   (row.owner && row.owner !== '*') ? row.owner : defaultOwner,
            sharing: ['global', 'app', 'user'].includes(row.sharing) ? row.sharing : 'app',
            read:    row.read    || 'admin,power',
            write:   row.write   || 'admin,power',
        });
    });
    return { rows, errors };
}

// ─── Bulk import — file handler (preview modal) ───────────────────────────────
function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const { rows, errors } = parseCSV(e.target.result);

        const headerCells = ['Username', 'Realm', 'App', 'Owner', 'Sharing', 'Read', 'Write', 'Password'].map(h => {
            const th = el('th'); th.textContent = h; return th;
        });
        const headerRow = el('tr');
        headerCells.forEach(th => headerRow.appendChild(th));
        const thead = el('thead');
        thead.appendChild(headerRow);

        const tbody = el('tbody');
        rows.forEach(r => {
            const tr = el('tr');
            [r.username, r.realm, r.app, r.owner, r.sharing, r.read, r.write, '••••••'].forEach(v => {
                const td = el('td'); td.textContent = v; tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });

        const table = el('table', { class: 'table table-chrome table-striped import-preview-table' });
        table.appendChild(thead);
        table.appendChild(tbody);

        const tableWrap = el('div', { class: 'import-preview-scroll' });
        tableWrap.appendChild(table);

        let html = '';
        if (rows.length)   html += `<p><b>${rows.length}</b> credential${rows.length !== 1 ? 's' : ''} ready to import.</p>`;
        if (errors.length) html += `<div class="alert alert-warning" style="margin-bottom:8px">` +
            errors.map(e => `<div><i class="icon-alert"></i> ${escHtml(e)}</div>`).join('') + `</div>`;
        if (!rows.length) {
            html += `<div class="alert alert-error"><i class="icon-alert"></i> No valid rows to import.</div>`;
            showModal({ id: 'modal-import-preview', title: 'Import Preview', bodyHtml: html });
            return;
        }

        const bodyDiv = document.createElement('div');
        bodyDiv.innerHTML = html;
        bodyDiv.appendChild(tableWrap);

        showModal({
            id: 'modal-import-preview',
            title: `Import Preview — ${rows.length} credential${rows.length !== 1 ? 's' : ''}`,
            bodyHtml: bodyDiv.innerHTML,
            confirmLabel: 'Import',
            showCancel: true,
            onConfirm: () => handleBulkImport(rows),
        });
    };
    reader.readAsText(file);
}

// ─── Bulk import — batch create with results modal ────────────────────────────
async function handleBulkImport(rows) {
    showModal({
        id: 'modal-import',
        title: 'Importing…',
        bodyHtml: `<div class="cred-loading"><span class="cred-spinner"></span> Importing ${rows.length} credential${rows.length !== 1 ? 's' : ''}…</div>`,
    });

    const results = await Promise.allSettled(rows.map(r => createSingleCredential(r)));

    let successHtml = '', failHtml = '';
    results.forEach((r, i) => {
        const label = `${escHtml(rows[i].realm)}:${escHtml(rows[i].username)}`;
        if (r.status === 'fulfilled') {
            successHtml += `<div class="import-result-ok"><i class="icon-check-circle"></i> ${label}</div>`;
        } else {
            const msg = r.reason?.status === 409 ? 'already exists' : escHtml(r.reason?.message || 'unknown error');
            failHtml += `<div class="import-result-fail"><i class="icon-alert"></i> ${label} — ${msg}</div>`;
        }
    });

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed    = results.length - succeeded;
    const summary   = `<p><b>${succeeded}</b> imported successfully${failed ? `, <b>${failed}</b> failed` : ''}.</p>`;

    // Update the modal in-place — replacing it would leave Bootstrap's backdrop stranded.
    const modal = document.getElementById('modal-import');
    if (modal) {
        modal.querySelector('.modal-title').textContent = 'Import Complete';
        modal.querySelector('.modal-body').innerHTML = summary + failHtml + successHtml;
        const confirmBtn = modal.querySelector('.confirm-btn');
        confirmBtn.textContent = 'Close';
        // Clone to drop the no-op listener from the progress phase, attach the real one.
        const freshBtn = confirmBtn.cloneNode(true);
        freshBtn.addEventListener('click', () => { $(modal).modal('hide'); refreshTable(); });
        confirmBtn.replaceWith(freshBtn);
    }
}

// ─── CSV template download ────────────────────────────────────────────────────
function downloadCSVTemplate() {
    const lines = [
        '# REST storage/passwords Manager — Bulk Import Template',
        '# Required columns : username, password',
        '# Optional columns : realm, app, owner, sharing, read, write',
        '#',
        '# Column notes:',
        '#   username : the credential username (required)',
        '#   password : the credential password (required)',
        '#   realm    : optional descriptor, e.g. prod or dev (default: empty)',
        `#   app      : Splunk app context to store the credential in (default: ${getCurrentApp()})`,
        `#   owner    : a Splunk username — must be a real user, NOT * (default: ${currentUser()})`,
        '#   sharing  : one of: global, app, user (default: app)',
        '#   read     : comma-separated roles that can read, or * for all (default: admin,power)',
        '#   write    : comma-separated roles that can write, or * for all (default: admin,power)',
        '#',
        '# Lines starting with # are ignored during import.',
        '#',
        'username,password,realm,app,owner,sharing,read,write',
        `myuser,mysecret,myrealm,${getCurrentApp()},${currentUser()},app,"admin,power","admin,power"`,
    ];
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'credential-import-template.csv';
    a.click();
    URL.revokeObjectURL(a.href);
}

function injectStyles() {
    if (document.getElementById('cred-mgr-styles')) return;
    const style = document.createElement('style');
    style.id = 'cred-mgr-styles';
    style.textContent = `
        .credential-toolbar { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
        .cred-row { cursor: pointer; }
        .cred-row:hover > td { background-color: rgba(0,0,0,0.03); }
        .cred-row.row-expanded > td { background-color: rgba(0,102,204,0.06); border-bottom: none !important; }
        .inline-update-row > td { background-color: rgba(0,102,204,0.03); padding: 12px 16px !important; }
        .cred-chevron { display: inline-block; transition: transform 0.15s ease; color: #999; }
        .row-expanded .cred-chevron { transform: rotate(90deg); color: #0066cc; }
        #btn-delete-selected:not([disabled]) { background-color: #c23b2e; border-color: #a3261d; color: #fff; }
        .modal-body .icon-check-circle { color: #3c763d; }
        .modal-body .icon-alert { color: #c23b2e; }
        .cred-paginator { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
        .cred-page-label { font-size: 13px; color: #555; }
        @keyframes cred-spin { to { transform: rotate(360deg); } }
        .cred-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #ccc; border-top-color: #0066cc; border-radius: 50%; animation: cred-spin 0.7s linear infinite; vertical-align: middle; margin-right: 6px; }
        .cred-loading { color: #555; padding: 8px 0; }
        .hint-warning { color: #8a6200 !important; }
        .multi-select-counter { display: block; font-size: 12px; color: #555; margin-bottom: 3px; }
        .multi-select-actions { display: flex; gap: 6px; margin-top: 4px; }
        .multi-select-btn { padding: 0 2px !important; font-size: 12px !important; height: auto !important; }
        .multi-select-hint { display: block; font-size: 12px; color: #999; font-style: italic; margin-top: 3px; }
        .cred-filter { flex: 1; max-width: 320px; }
        .cred-empty-state { text-align: center; color: #888; padding: 20px !important; font-style: italic; }
        .cred-import-wrap { position: relative; }
        .cred-import-menu { display: none; position: absolute; top: 100%; left: 0; z-index: 1000; background: #fff; border: 1px solid #ccc; border-radius: 3px; box-shadow: 0 3px 8px rgba(0,0,0,0.15); min-width: 170px; margin-top: 2px; }
        .cred-import-menu.open { display: block; }
        .cred-import-item { display: block; width: 100%; text-align: left; padding: 7px 14px; background: none; border: none; cursor: pointer; font-size: 13px; color: #333; white-space: nowrap; }
        .cred-import-item:hover { background: #f5f5f5; }
        .cred-import-item i { margin-right: 6px; }
        .import-preview-scroll { max-height: 300px; overflow-y: auto; margin-top: 8px; }
        .import-preview-scroll .table { font-size: 12px; margin-bottom: 0; }
        .import-result-ok { color: #3c763d; }
        .import-result-fail { color: #c23b2e; }
    `;
    document.head.appendChild(style);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
async function init() {
    const container = document.getElementById('password-table');
    if (!container) return;
    injectStyles();
    showLoading(container, 'Loading credentials…');
    try {
        const creds = await fetchCredentials();
        renderTable(creds, container);
    } catch (err) {
        container.innerHTML = `<div class="alert alert-error"><i class="icon-alert"></i> Failed to load credentials: ${escHtml(err.message)}</div>`;
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
// Use simplexml/ready! purely as a lifecycle hook — it fires reliably after
// all classic dashboard panels have finished rendering.  This is the only
// reliable trigger in the classic dashboard context.
// NOTE: No other splunkjs/mvc components are used anywhere in this file.
require(['splunkjs/mvc/simplexml/ready!'], function() {
    init();
});
