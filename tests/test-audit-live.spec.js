const { test, expect } = require('@playwright/test');
require('dotenv').config();

test.describe('Audit Log Live Debug', () => {
  const splunkBaseUrl = `http://${process.env.SPLUNK_HOST || '127.0.0.1'}:${process.env.SPLUNK_PORT || '8000'}`;

  test('capture exact audit log flow with current deployed code', async ({ page }) => {
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

    // Capture all splunkd requests/responses
    const trace = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/search/jobs')) {
        trace.push({
          type: 'req',
          method: req.method(),
          url: url,
          postData: (req.postData() || '').slice(0, 1000),
          contentType: req.headers()['content-type'] || '(none)',
        });
      }
    });

    page.on('response', async (resp) => {
      const url = resp.url();
      if (url.includes('/search/jobs')) {
        try {
          const body = await resp.text();
          trace.push({
            type: 'resp',
            status: resp.status(),
            method: resp.request().method(),
            url: url,
            body: body.slice(0, 3000),
          });
        } catch (e) {}
      }
    });

    // Navigate to audit log
    await page.goto(`${splunkBaseUrl}/en-US/app/rest-storage-passwords-manager/audit_log`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const container = page.locator('#audit-log-app');
    await expect(container).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(10000);

    const pageText = await container.innerText();

    console.log('=== PAGE CONTENT ===');
    console.log(pageText.slice(0, 2000));

    console.log('\n=== FULL TRACE ===\n');
    trace.forEach((t, i) => {
      if (t.type === 'req') {
        console.log(`--- ${i + 1}. REQUEST ---`);
        console.log(`${t.method} ${t.url}`);
        console.log(`Content-Type: ${t.contentType}`);
        if (t.postData && t.postData !== '(none)') {
          console.log(`Body: ${t.postData.slice(0, 500)}`);
        }
      } else {
        console.log(`--- ${i + 1}. RESPONSE ---`);
        console.log(`${t.method} -> ${t.status}`);
        console.log(`${t.url}`);
        // Extract key info
        const sidMatch = t.body.match(/"sid"\s*:\s*"([^"]+)"/);
        const isDoneMatch = t.body.match(/"isDone"\s*:\s*(\w+)/);
        const dispatchMatch = t.body.match(/"dispatchState"\s*:\s*"([^"]+)"/);
        const fieldMatch = t.body.match(/"fields"\s*:\s*\[([\s\S]*?)\]/);
        const resultsMatch = t.body.match(/"results"\s*:\s*\[([\s\S]*?)\]/);

        if (sidMatch) console.log(`SID: ${sidMatch[1]}`);
        if (isDoneMatch) console.log(`isDone: ${isDoneMatch[1]}`);
        if (dispatchMatch) console.log(`dispatchState: ${dispatchMatch[1]}`);
        if (resultsMatch) {
          try {
            const parsed = JSON.parse(`[${resultsMatch[1]}]`);
            console.log(`Result count: ${parsed.length}`);
            if (parsed.length > 0) console.log(`First: ${JSON.stringify(parsed[0]).slice(0, 300)}`);
          } catch (e) {}
        }
        console.log(`Body (first 500): ${t.body.slice(0, 500)}`);
      }
      console.log('');
    });
  });
});