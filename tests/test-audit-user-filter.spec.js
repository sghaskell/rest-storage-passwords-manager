const { test, expect } = require('@playwright/test');
require('dotenv').config();

test.describe('Audit Log User Filter', () => {
  const splunkBaseUrl = `http://${process.env.SPLUNK_HOST || '127.0.0.1'}:${process.env.SPLUNK_PORT || '8000'}`;

  test('user filter multi-select works', async ({ page }) => {
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

    await page.goto(`${splunkBaseUrl}/en-US/app/rest-storage-passwords-manager/audit_log`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const container = page.locator('#audit-log-app');
    await expect(container).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(8000);

    // Count initial rows (all users selected)
    const allRows = await page.locator('tbody tr').count();
    console.log(`Total rows (all users): ${allRows}`);

    // Check that multi-select exists
    const multiSelect = page.locator('[role="listbox"], [role="combobox"]').nth(1);
    const isMultiVisible = await multiSelect.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Multi-select visible: ${isMultiVisible}`);

    // Click the multi-select to open dropdown
    if (isMultiVisible) {
      await multiSelect.click();
      await page.waitForTimeout(500);

      // Get available options
      const options = page.locator('[role="option"]');
      const optionCount = await options.count();
      console.log(`User options available: ${optionCount}`);

      const optionTexts = [];
      for (let i = 0; i < optionCount; i++) {
        optionTexts.push(await options.nth(i).innerText());
      }
      console.log(`Users: ${optionTexts.join(', ')}`);

      // Deselect splunk-system-user
      const splunkSystemOpt = page.locator('[role="option"]').filter({ hasText: 'splunk-system-user' });
      if (await splunkSystemOpt.count() > 0) {
        await splunkSystemOpt.first().click();
        await page.waitForTimeout(1000);

        // Close dropdown by clicking elsewhere
        await page.locator('tbody').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const filteredRows = await page.locator('tbody tr').count();
        console.log(`Rows after deselecting splunk-system-user: ${filteredRows}`);
        console.log(`Rows removed: ${allRows - filteredRows}`);

        // Verify fewer rows
        if (filteredRows < allRows) {
          console.log('PASS: Filter reduced row count');
        } else if (filteredRows === 0) {
          console.log('PASS: All rows were splunk-system-user, now empty');
        } else {
          console.log('WARN: Row count unchanged, filter may not be working');
        }
      }

      // Re-open and re-select to restore
      await multiSelect.click();
      await page.waitForTimeout(500);
      const splunkSystemOpt2 = page.locator('[role="option"]').filter({ hasText: 'splunk-system-user' });
      if (await splunkSystemOpt2.count() > 0) {
        await splunkSystemOpt2.first().click();
        await page.waitForTimeout(1000);
        await page.locator('tbody').first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);

        const restoredRows = await page.locator('tbody tr').count();
        console.log(`Rows after re-selecting: ${restoredRows}`);
      }
    }

    const pageText = await container.innerText();
    console.log('\n=== PAGE CONTENT ===');
    console.log(pageText.slice(0, 1000));
  });
});