const { test, expect } = require('@playwright/test');
require('dotenv').config();

const splunkBaseUrl = `http://${process.env.SPLUNK_HOST || '127.0.0.1'}:${process.env.SPLUNK_PORT || '8000'}`;

async function loginToSplunk(page) {
  const username = process.env.SPLUNK_ADMIN_USER || 'admin';
  const password = process.env.SPLUNK_ADMIN_PASSWORD || 'password';

  await page.goto(`${splunkBaseUrl}/`, { waitUntil: 'networkidle' });

  const isOnLogin = await page.$('input[name="username"]');
  if (isOnLogin) {
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('input[value="Sign In"]'),
    ]);
  }
}

async function navigateToDashboard(page) {
  const appUrl = `${splunkBaseUrl}/en-US/app/rest-storage-passwords-manager/credential_management`;
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const container = page.locator('#credential-manager-app');
  await expect(container).toBeVisible({ timeout: 20000 });
  const table = page.locator('table');
  await expect(table).toBeVisible({ timeout: 15000 });
}

async function waitForModalClose(page) {
  await page.waitForFunction(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const d of dialogs) {
      const style = window.getComputedStyle(d);
      if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
        const rect = d.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) return false;
      }
    }
    return true;
  }, {}, { timeout: 10000 });
}

async function closeResultModal(page) {
  try {
    const closeBtn = page.locator('button').filter({ hasText: /close/i }).first();
    if (await closeBtn.isVisible({ timeout: 2000 })) {
      await closeBtn.click({ timeout: 3000 });
      await waitForModalClose(page);
    }
  } catch (e) { /* no result modal */ }
}

// Create credential the same way handleCreateCredential does (via API in-browser)
async function createCredentialLikeUI(page, { username, password, realm, owner, sharing, readRoles, writeRoles }) {
  return await page.evaluate(async ({ uname, pwd, realm, owner, sharing, readRoles, writeRoles }) => {
    const csrf = document.cookie
      .split(';')
      .map(c => c.trim())
      .find(row => row.startsWith('splunkweb_csrf_token'))
      .split('=')[1];
    const baseUrl = window.location.origin;

    async function req(method, path, body) {
      const full = path.startsWith('/en-US/splunkd/__raw') ? path : `/en-US/splunkd/__raw${path}`;
      const opts = { method, credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
      if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) opts.headers['X-Splunk-Form-Key'] = csrf;
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        opts.body = Object.keys(body).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(body[k]))).join('&');
      }
      const r = await fetch(baseUrl + full, opts);
      return { status: r.status, text: await r.text() };
    }

    const app = 'search';
    const so = encodeURIComponent(owner || 'nobody');
    const sa = encodeURIComponent(app || 'search');

    let cr = await req('POST', `/servicesNS/${so}/${sa}/storage/passwords`,
      { name: uname, password: pwd, realm: realm || '', output_mode: 'json' });

    const aclPath = `/servicesNS/${so}/${sa}/configs/conf-passwords/credential%3A${encodeURIComponent(realm || '')}%3A${encodeURIComponent(uname)}%3A/acl`;

    if (cr.status === 409) {
      const configStanza = encodeURIComponent(`credential:${(realm || '')}:${uname}:`);
      cr = await req('POST', `/servicesNS/${so}/${sa}/configs/conf-passwords/${configStanza}`,
        { password: pwd, output_mode: 'json' });
    }

    if (cr.status >= 200 && cr.status < 300) {
      if (sharing === 'user') {
        await req('POST', aclPath, {
          'perms.read': (readRoles || []).join(','),
          'perms.write': (writeRoles || []).join(','),
          sharing: 'app',
          owner: owner || 'nobody',
          output_mode: 'json',
        });
      }
      await req('POST', aclPath, {
        'perms.read': (readRoles || []).join(','),
        'perms.write': (writeRoles || []).join(','),
        sharing,
        owner: owner || 'nobody',
        output_mode: 'json',
      });
      return { success: true, owner, sharing, status: cr.status };
    }

    return { success: false, owner, sharing, status: cr.status, error: cr.text.substring(0, 200) };
  }, {
    uname: username,
    pwd: password,
    realm: realm || '',
    owner: owner || 'nobody',
    sharing: sharing || 'app',
    readRoles: readRoles || ['admin', 'power'],
    writeRoles: writeRoles || ['admin', 'power'],
  });
}

async function cleanupTestCredentials(page, names) {
  return page.evaluate(async ({ names }) => {
    const csrf = document.cookie
      .split(';')
      .map(c => c.trim())
      .find(row => row.startsWith('splunkweb_csrf_token'))
      .split('=')[1];
    const baseUrl = window.location.origin;

    async function req(method, path) {
      const full = path.startsWith('/en-US/splunkd/__raw') ? path : `/en-US/splunkd/__raw${path}`;
      const opts = { method, credentials: 'include', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } };
      if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) opts.headers['X-Splunk-Form-Key'] = csrf;
      try { const r = await fetch(baseUrl + full, opts); return r.status; } catch (e) { return 0; }
    }

    for (const name of names) {
      try { await req('DELETE', `/servicesNS/admin/search/storage/passwords/%3A${encodeURIComponent(name)}%3A`); } catch (e) {}
      try { await req('DELETE', `/servicesNS/admin/search/configs/conf-passwords/${encodeURIComponent('credential::' + name + ':')}`); } catch (e) {}
    }
  }, { names });
}

// ─── Test: standalone user-scoped credential bulk delete + undo ───

test('should bulk delete and undo standalone user-scoped credential (ACL bump)', async ({ page }) => {
  await loginToSplunk(page);
  await navigateToDashboard(page);

  const TEST_NAME = 'standalone-user-' + Date.now();
  const TEST_PASSWORD = 'StandalonePwd!456';

  try {
    // ─── Step 1: Create standalone user-scoped credential ───
    console.log(`\n=== Step 1: Create ${TEST_NAME} (sharing=user, owner=admin) ===`);

    const createResult = await createCredentialLikeUI(page, {
      username: TEST_NAME,
      password: TEST_PASSWORD,
      realm: '',
      owner: 'admin',
      sharing: 'user',
      readRoles: ['admin', 'power'],
      writeRoles: ['admin'],
    });

    console.log(`  Create: success=${createResult.success}, status=${createResult.status}`);
    expect(createResult.success, 'credential created').toBe(true);

    // Navigate fresh so the table loads with the new credential
    await navigateToDashboard(page);
    await page.waitForTimeout(2000);

    // Verify credential visible
    const searchInput = page.locator('input[placeholder="Search across all fields..."]').first();
    await searchInput.fill(TEST_NAME);
    await page.waitForTimeout(1000);

    const rowsAfterCreate = await page.locator('tbody tr').filter({ hasText: TEST_NAME }).count();
    console.log(`  Rows visible: ${rowsAfterCreate}`);
    expect(rowsAfterCreate, 'credential visible after create').toBe(1);

    // Verify it's user-scoped
    const scopeCheck = await page.evaluate(async (name) => {
      const csrf = document.cookie.split(';').map(c => c.trim()).find(r => r.startsWith('splunkweb_csrf_token')).split('=')[1];
      const r = await fetch(window.location.origin + '/en-US/splunkd/__raw/servicesNS/-/-/configs/conf-passwords?count=0&output_mode=json', {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await r.json();
      const entries = (data.entry || []).filter(e => (e.name || '').includes(name));
      return entries.map(e => ({ sharing: e.acl.sharing, owner: e.acl.owner }));
    }, TEST_NAME);
    console.log(`  Scope: ${JSON.stringify(scopeCheck)}`);
    expect(scopeCheck[0].sharing).toBe('user');

    // ─── Step 2: Bulk delete via UI ───
    console.log(`\n=== Step 2: Bulk delete via UI ===`);

    await page.locator('[data-test="toggle-all"]').first().click();
    await page.waitForTimeout(500);

    const selectedCount = await page.locator('tbody input[type="checkbox"]:checked').count();
    console.log(`  Selected: ${selectedCount}`);
    expect(selectedCount).toBe(1);

    await page.locator('button:has-text("Delete Selected")').first().click();
    await page.waitForTimeout(1500);

    const modalVisible = await page.locator('[role="dialog"]').filter({ hasText: 'Delete' }).first().isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Delete modal visible: ${modalVisible}`);

    if (modalVisible) {
      const confirmBtn = page.locator('[role="dialog"] button').filter({ hasText: /delete/i }).last();
      await confirmBtn.click({ timeout: 5000 });
    }
    await page.waitForTimeout(3000);
    await closeResultModal(page);

    const remaining = await page.locator('tbody tr').filter({ hasText: TEST_NAME }).count();
    console.log(`  Remaining after delete: ${remaining}`);

    // ─── Step 3: Undo via UI ───
    console.log(`\n=== Step 3: Undo via UI ===`);

    const undoToast = page.locator('div:has-text("credential(s) deleted")').first();
    const undoVisible = await undoToast.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`  Undo toast visible: ${undoVisible}`);
    expect(undoVisible, 'undo toast should appear').toBe(true);

    if (undoVisible) {
      const undoBtn = page.locator('button:has-text("Undo")').first();
      if (await undoBtn.isVisible({ timeout: 3000 })) {
        await undoBtn.click();
        await page.waitForTimeout(3000);
        await closeResultModal(page);

        // Navigate fresh to see restored credential
        await navigateToDashboard(page);
        await searchInput.fill(TEST_NAME);
        await page.waitForTimeout(1000);

        const restoredCount = await page.locator('tbody tr').filter({ hasText: TEST_NAME }).count();
        console.log(`  Restored: ${restoredCount}`);
        expect(restoredCount, 'undo should restore credential').toBe(1);

        // Verify scope is still user
        const scopeAfter = await page.evaluate(async (name) => {
          const csrf = document.cookie.split(';').map(c => c.trim()).find(r => r.startsWith('splunkweb_csrf_token')).split('=')[1];
          const r = await fetch(window.location.origin + '/en-US/splunkd/__raw/servicesNS/-/-/configs/conf-passwords?count=0&output_mode=json', {
            credentials: 'include',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          });
          const data = await r.json();
          const entries = (data.entry || []).filter(e => (e.name || '').includes(name));
          return entries.map(e => ({ sharing: e.acl.sharing, owner: e.acl.owner }));
        }, TEST_NAME);
        console.log(`  Scope after undo: ${JSON.stringify(scopeAfter)}`);
        expect(scopeAfter[0].sharing, 'scope should still be user').toBe('user');

        // ─── Step 4: Verify password is correct ───
        console.log(`\n=== Step 4: Verify password ===`);

        // Use the Reveal Password button to test
        const revealBtn = page.locator('button[title="Reveal password"]').first();
        await revealBtn.click({ timeout: 5000 });

        // Wait for the password modal to appear and load
        const passwordModal = page.locator('[role="dialog"]').filter({ hasText: `Password for ${TEST_NAME}` });
        await passwordModal.first().waitFor({ state: 'visible', timeout: 5000 });

        // Read the password from the input value (innerText doesn't capture input values)
        const passwordValue = await passwordModal.locator('input[readonly]').first().inputValue();
        console.log(`  Reveal modal password: ${passwordValue}`);
        expect(passwordValue, 'password should match').toContain(TEST_PASSWORD);

        await closeResultModal(page);
      }
    }

    await searchInput.fill('');
    await page.waitForTimeout(500);

  } finally {
    await cleanupTestCredentials(page, [TEST_NAME]);
  }
});
