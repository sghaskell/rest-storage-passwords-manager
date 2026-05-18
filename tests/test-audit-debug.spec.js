const { test, expect } = require('@playwright/test');
require('dotenv').config();

test.describe('Audit Log Debug', () => {
  const splunkBaseUrl = `http://${process.env.SPLUNK_HOST || '127.0.0.1'}:${process.env.SPLUNK_PORT || '8000'}`;

  test('test form body with full SPL query through proxy', async ({ page }) => {
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

    const cookies = await page.context().cookies();
    const csrfToken = cookies.find(c => c.name.includes('splunkweb_csrf_token'))?.value || null;

    const searchQuery = 'search index=_audit (action=CREATE_PASSWORD OR action=EDIT_PASSWORD OR action=REMOVE_PASSWORD) | rex field=_raw "password_id=\\"(?<password_id>[^\\"]*)\\\"" | sort -_time | table _time, user, action, password_id, info';

    console.log('SPL query:', searchQuery);

    const body = new URLSearchParams({
      search: searchQuery,
      earliest_time: '-1h',
      latest_time: 'now',
      exec_mode: 'normal',
      output_mode: 'json',
    });

    console.log('\nForm body:', body.toString());

    // Submit job with form body
    const resp = await page.evaluate(async ({ url, body, csrf }) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          ...(csrf ? { 'X-Splunk-Form-Key': csrf } : {}),
        },
        body: body,
        credentials: 'include',
      });
      return { status: r.status, text: await r.text() };
    }, { url: '/en-US/splunkd/__raw/servicesNS/-/-/search/jobs', body: body.toString(), csrf: csrfToken });

    console.log(`Status: ${resp.status}`);
    const sidMatch = resp.text.match(/"sid"\s*:\s*"([^"]+)"/);
    const sid = sidMatch ? sidMatch[1] : null;
    console.log(`SID: ${sid}`);

    if (!sid) {
      console.log('No SID. Full response:', resp.text.slice(0, 1000));
      return;
    }

    // Poll for completion
    await page.waitForTimeout(2000);

    const statusResp = await page.evaluate(async ({ sid }) => {
      const r = await fetch(`/en-US/splunkd/__raw/servicesNS/-/-/search/jobs/${sid}?output_mode=json`, {
        method: 'GET',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });
      return { status: r.status, text: await r.text() };
    }, { sid });

    const isDoneMatch = statusResp.text.match(/"isDone"\s*:\s*(\w+)/);
    const dispatchMatch = statusResp.text.match(/"dispatchState"\s*:\s*"([^"]+)"/);
    console.log(`\nisDone: ${isDoneMatch ? isDoneMatch[1] : 'N/A'}`);
    console.log(`dispatchState: ${dispatchMatch ? dispatchMatch[1] : 'N/A'}`);

    // Check the actual search query the job is running
    const searchMatch = statusResp.text.match(/"search"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    console.log(`Job search: ${searchMatch ? searchMatch[1] : 'N/A'}`);

    if (isDoneMatch && isDoneMatch[1] === 'true') {
      const resultsResp = await page.evaluate(async ({ sid }) => {
        const r = await fetch(`/en-US/splunkd/__raw/servicesNS/-/-/search/jobs/${sid}/results?output_mode=json`, {
          method: 'GET',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
        });
        return { status: r.status, text: await r.text() };
      }, { sid });

      console.log(`\nResults status: ${resultsResp.status}`);
      try {
        const j = JSON.parse(resultsResp.text);
        console.log(`Fields: ${(j.fields || []).map(f => f.name).join(', ')}`);
        console.log(`Result count: ${(j.results || []).length}`);
        if (j.results && j.results.length > 0) {
          console.log(`First result:`, JSON.stringify(j.results[0]).slice(0, 500));
        }
      } catch (e) {
        console.log(`Body (first 1000): ${resultsResp.text.slice(0, 1000)}`);
      }

      // Terminate
      await page.evaluate(async ({ sid, csrf }) => {
        await fetch(`/en-US/splunkd/__raw/servicesNS/-/-/search/jobs/${sid}/control`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            ...(csrf ? { 'X-Splunk-Form-Key': csrf } : {}),
          },
          body: 'action=terminate&output_mode=json',
          credentials: 'include',
        });
      }, { sid, csrf: csrfToken });
    }
  });
});
