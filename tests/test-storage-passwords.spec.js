const { test, expect } = require('@playwright/test');
require('dotenv').config();

test.describe('storage/passwords debug', () => {
  const SPLUNK_BASE = `http://${process.env.SPLUNK_HOST || '127.0.0.1'}:${process.env.SPLUNK_PORT || '8000'}`;
  const USERNAME = process.env.SPLUNK_ADMIN_USER || 'admin';
  const PASSWORD = process.env.SPLUNK_ADMIN_PASSWORD || 'password';

  test('POST credential and GET it back via storage/passwords', async ({ page }) => {
    await page.goto(`${SPLUNK_BASE}/`, { waitUntil: 'networkidle' });
    const isOnLogin = await page.$('input[name="username"]');
    if (isOnLogin) {
      await page.fill('input[name="username"]', USERNAME);
      await page.fill('input[name="password"]', PASSWORD);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('input[value="Sign In"]'),
      ]);
    }

    const result = await page.evaluate(async () => {
      function getCSRFToken() {
        return document.cookie.split('; ')
          .find(row => row.startsWith('splunkweb_csrf_token'))
          ?.split('=')[1];
      }

      function formEncode(data) {
        const parts = [];
        Object.entries(data).forEach(([key, value]) => {
          if (value !== null && value !== undefined) {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
          }
        });
        parts.push('output_mode=json');
        return parts.join('&');
      }

      async function splunkdRequest(path, options = {}) {
        const method = options.method || 'GET';
        const url = `/en-US/splunkd/__raw${path}`;
        const headers = { 'X-Requested-With': 'XMLHttpRequest' };
        const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
        if (isMutation) {
          const csrfToken = getCSRFToken();
          if (csrfToken) headers['X-Splunk-Form-Key'] = csrfToken;
        }
        let body = undefined;
        if (isMutation && options.body) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          body = formEncode(options.body);
        }
        const response = await fetch(url, { method, headers, body, credentials: 'include' });
        const text = await response.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) { parsed = { text }; }
        if (!response.ok) {
          const error = new Error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed.messages || parsed));
          error.status = response.status;
          throw error;
        }
        return parsed;
      }

      const results = {};
      const credName = 'testpw' + Date.now();
      const stanza = encodeURIComponent(`test:${credName}:`);

      // POST credential
      try {
        await splunkdRequest('/servicesNS/nobody/search/storage/passwords/' + stanza, {
          method: 'POST',
          body: { password: 'test123' },
        });
        results.post = { status: 201, ok: true };
      } catch (e) {
        results.post = { status: e.status, error: e.message.slice(0, 150) };
      }

      // GET via storage/passwords
      try {
        const data = await splunkdRequest('/servicesNS/nobody/search/storage/passwords/' + stanza, { method: 'GET' });
        const entry = data.entry ? data.entry[0] : null;
        results.get_storage = {
          status: 200,
          entryCount: data.entry ? data.entry.length : 0,
          name: entry ? entry.name : null,
          hasPassword: entry && entry.content ? !!entry.content.password : false,
        };
      } catch (e) {
        results.get_storage = { status: e.status, error: e.message.slice(0, 150) };
      }

      // GET via conf-passwords
      try {
        const data = await splunkdRequest('/servicesNS/nobody/search/configs/conf-passwords/' + stanza, { method: 'GET' });
        const entry = data.entry ? data.entry[0] : null;
        results.get_conf = {
          status: 200,
          entryCount: data.entry ? data.entry.length : 0,
          name: entry ? entry.name : null,
          hasPassword: entry && entry.content ? !!entry.content.password : false,
        };
      } catch (e) {
        results.get_conf = { status: e.status, error: e.message.slice(0, 150) };
      }

      // List all via storage/passwords
      try {
        const data = await splunkdRequest('/servicesNS/nobody/search/storage/passwords', { method: 'GET' });
        const entries = data.entry || [];
        const ourEntry = entries.find(e => e.name === `test:${credName}:`);
        results.list_storage = {
          status: 200,
          count: entries.length,
          found: !!ourEntry,
        };
      } catch (e) {
        results.list_storage = { status: e.status, error: e.message.slice(0, 150) };
      }

      // List all via conf-passwords
      try {
        const data = await splunkdRequest('/servicesNS/nobody/search/configs/conf-passwords', { method: 'GET' });
        const entries = data.entry || [];
        const ourEntry = entries.find(e => e.name === `test:${credName}:`);
        results.list_conf = {
          status: 200,
          count: entries.length,
          found: !!ourEntry,
        };
      } catch (e) {
        results.list_conf = { status: e.status, error: e.message.slice(0, 150) };
      }

      // Cleanup
      try {
        await splunkdRequest('/servicesNS/nobody/search/storage/passwords/' + stanza, { method: 'DELETE' });
        results.cleanup = { status: 204, ok: true };
      } catch (e) {
        results.cleanup = { status: e.status, error: e.message.slice(0, 150) };
      }

      return results;
    });

    console.log('\n=== storage/passwords vs conf-passwords ===');
    for (const [key, val] of Object.entries(result)) {
      console.log(`${key}: ${JSON.stringify(val)}`);
    }

    expect(result.post.ok).toBe(true);
    expect(result.get_storage.hasPassword).toBe(true);
    expect(result.list_storage.found).toBe(true);
    expect(result.list_conf.found).toBe(true);
  });
});
