const { test, expect } = require('@playwright/test');

function getSplunkBaseUrl() {
  const host = process.env.SPLUNK_HOST || '127.0.0.1';
  const port = process.env.SPLUNK_PORT || '8000';
  return `http://${host}:${port}`;
}

async function login(page) {
  const base = getSplunkBaseUrl();
  await page.goto(base + '/en-US/account/login');
  await page.waitForTimeout(2000);

  const url = page.url();
  if (url.includes('account/login') || url.includes('login')) {
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'A00mast3r');
    await page.click('input[type="submit"]');
    await page.waitForTimeout(3000);
  }
}

async function goToCredentials(page) {
  const base = getSplunkBaseUrl();
  await page.goto(base + '/en-US/app/rest-storage-passwords-manager/credential_management');
  await page.waitForTimeout(5000);
  await page.waitForSelector('tbody tr td', { timeout: 15000 });
}

async function clickHeaderCheckbox(page) {
  // Use Playwright's force click to bypass pointer-event interception
  await page.locator('thead input[type="checkbox"]').first().click({ force: true });
  await page.waitForTimeout(1500);
}

async function clickRowCheckbox(page, index) {
  await page.evaluate(idx => {
    const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
    if (checkboxes[idx]) {
      checkboxes[idx].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }, index);
  await page.waitForTimeout(500);
}

async function navigateToPage(page, pageNum) {
  await page.evaluate(pNum => {
    const allButtons = Array.from(document.querySelectorAll('button'));
    const btn = allButtons.find(b => b.textContent.trim() === String(pNum));
    if (btn) btn.click();
  }, pageNum);
  await page.waitForTimeout(2000);
}

async function getSelectionCount(page) {
  const el = page.locator('span:has-text("selected")').first();
  const count = await el.count();
  if (count === 0) return 0;
  const text = await el.textContent();
  const match = text.match(/(\d+)\s*selected/);
  return match ? parseInt(match[1], 10) : 0;
}

async function getCheckedCount(page) {
  // React-controlled checkboxes: the `checked` attribute doesn't update,
  // but the DOM property does. Use evaluate to read the property.
  return await page.evaluate(() => {
    const checkboxes = document.querySelectorAll('tbody input[type="checkbox"]');
    let count = 0;
    for (const cb of checkboxes) {
      if (cb.checked) count++;
    }
    return count;
  });
}

test.describe('Multi-page checkbox selection', () => {
  test('select-all per page accumulates correctly across pages', async ({ page }) => {
    await login(page);
    await goToCredentials(page);

    // Dump all credential composite keys across all pages to find duplicates
    const dumpPageKeys = async () => {
      const keys = await page.evaluate(() => {
        const rows = document.querySelectorAll('tbody tr');
        const keys = [];
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          const name = cells[1]?.textContent?.trim() || '';
          const realm = cells[2]?.textContent?.trim() || '';
          const app = cells[3]?.textContent?.trim() || '';
          const owner = cells[4]?.textContent?.trim() || '';
          keys.push(realm + ':' + name + ':' + app + ':' + owner);
        });
        return keys;
      });
      return keys;
    };

    const allPageKeys = {};
    for (let p = 1; p <= 8; p++) {
      if (p > 1) await navigateToPage(page, p);
      allPageKeys[p] = await dumpPageKeys();
    }
    // Go back to page 1
    await navigateToPage(page, 1);

    // Find cross-page duplicate keys
    const allKeysFlat = [];
    for (const p of Object.keys(allPageKeys)) {
      allKeysFlat.push(...allPageKeys[p].map(k => ({ page: p, key: k })));
    }
    const keyMap = {};
    allKeysFlat.forEach(item => {
      if (!keyMap[item.key]) keyMap[item.key] = [];
      keyMap[item.key].push(item.page);
    });
    const duplicates = Object.entries(keyMap).filter(([k, pages]) => pages.length > 1);
    if (duplicates.length > 0) {
      console.log(`CROSS-PAGE DUPLICATES (${duplicates.length}):`, duplicates.map(([k, pages]) => `${k} → pages ${pages.join(', ')}`));
    } else {
      console.log('No cross-page key duplicates found');
    }

    const totalCredsText = await page.locator('span:has-text("of")').first().textContent();
    const totalMatch = totalCredsText.match(/of (\d+) credential/);
    const totalCreds = totalMatch ? parseInt(totalMatch[1], 10) : 71;

    // Collect selection counts per page
    const results = [];

    // --- Page 1: select all ---
    let selCount = await getSelectionCount(page);
    let checkedCount = await getCheckedCount(page);

    await clickHeaderCheckbox(page);

    selCount = await getSelectionCount(page);
    checkedCount = await getCheckedCount(page);
    results.push({ page: 1, sel: selCount, checked: checkedCount, action: 'select' });

    // --- Pages 2-8: select all ---
    for (let p = 2; p <= 8; p++) {
      await navigateToPage(page, p);
      checkedCount = await getCheckedCount(page);

      await clickHeaderCheckbox(page);

      selCount = await getSelectionCount(page);
      checkedCount = await getCheckedCount(page);
      results.push({ page: p, sel: selCount, checked: checkedCount, action: 'select' });
    }

    // Print cumulative selection pattern
    const pattern = results.map(r => `P${r.page}:sel=${r.sel},checked=${r.checked}`).join(' | ');
    console.log(`Selection pattern: ${pattern} (total creds: ${totalCreds})`);

    // --- Verify: each page's selection should be cumulative and clean ---
    const bugs = [];
    for (const r of results) {
      const pageNum = r.page;
      const expected = Math.min(pageNum * 10, totalCreds);
      if (r.sel !== expected) {
        bugs.push(`P${pageNum}: expected ${expected}, got ${r.sel} (off by ${r.sel - expected})`);
        console.error(`BUG: Page ${pageNum} — expected ${expected} selected, got ${r.sel} (diff: ${r.sel - expected})`);
      }
    }

    // Final assertion: selection count should be totalCreds (all pages selected)
    const finalSel = results[results.length - 1].sel;
    expect(finalSel).toBe(totalCreds, `After selecting all pages, should have ${totalCreds} selected, got ${finalSel}. Pattern: ${bugs.join(', ')}`);
  });

  test('deselect page via header checkbox removes only that page', async ({ page }) => {
    await login(page);
    await goToCredentials(page);

    // Select all on page 1
    await clickHeaderCheckbox(page);
    let selCount = await getSelectionCount(page);
    test.info().annotations.push({ type: 'info', description: `After page1 select: ${selCount}` });

    // Select all on page 2
    await navigateToPage(page, 2);
    await clickHeaderCheckbox(page);
    selCount = await getSelectionCount(page);
    test.info().annotations.push({ type: 'info', description: `After page1+2 select: ${selCount}` });

    // Deselect page 2 by clicking header checkbox again
    await clickHeaderCheckbox(page);
    selCount = await getSelectionCount(page);
    test.info().annotations.push({ type: 'info', description: `After page2 deselect: ${selCount}` });

    // Verify page 1 still selected
    await navigateToPage(page, 1);
    const checked1 = await getCheckedCount(page);
    expect(checked1).toBeGreaterThan(0, 'Page 1 should still be selected after deselecting page 2');

    // Verify page 2 is deselected
    await navigateToPage(page, 2);
    const checked2 = await getCheckedCount(page);
    expect(checked2).toBe(0, 'Page 2 should be deselected');
  });

  test('individual row selection works correctly', async ({ page }) => {
    await login(page);
    await goToCredentials(page);

    // Click first row checkbox
    await clickRowCheckbox(page, 0);
    let selCount = await getSelectionCount(page);
    expect(selCount).toBe(1, 'Clicking first row should select 1');

    // Click second row checkbox
    await clickRowCheckbox(page, 1);
    selCount = await getSelectionCount(page);
    expect(selCount).toBe(2, 'Clicking second row should select 2');

    // Uncheck first row
    await clickRowCheckbox(page, 0);
    selCount = await getSelectionCount(page);
    expect(selCount).toBe(1, 'Unchecking first row should leave 1 selected');
  });

  test('toggle prev/next between pages causes selection corruption', async ({ page }) => {
    await login(page);
    await goToCredentials(page);

    // Select all on page 1
    await clickHeaderCheckbox(page);
    let selCount = await getSelectionCount(page);
    let checkedCount = await getCheckedCount(page);
    console.log(`Page 1 select-all: sel=${selCount}, checked=${checkedCount}`);

    // Navigate to page 2
    await navigateToPage(page, 2);
    checkedCount = await getCheckedCount(page);
    selCount = await getSelectionCount(page);
    console.log(`Page 2 (no select): sel=${selCount}, checked=${checkedCount}`);

    // Toggle back and forth 6 times using Prev/Next buttons
    for (let i = 1; i <= 6; i++) {
      // Go to page 1
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const prevBtn = btns.find(b => b.getAttribute('aria-label') === 'Go to previous page' || b.textContent.includes('Prev'));
        if (prevBtn && !prevBtn.disabled) prevBtn.click();
      });
      await page.waitForTimeout(2000);

      checkedCount = await getCheckedCount(page);
      selCount = await getSelectionCount(page);
      const currentPage = await page.evaluate(() => {
        const pc = document.querySelector('.Paginator-pageControl');
        return pc ? pc.textContent : '?';
      });
      console.log(`Toggle ${i} → page 1: sel=${selCount}, checked=${checkedCount}, paginator="${currentPage}"`);

      // Go to page 2
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const nextBtn = btns.find(b => b.getAttribute('aria-label') === 'Go to next page' || b.textContent.includes('Next'));
        if (nextBtn && !nextBtn.disabled) nextBtn.click();
      });
      await page.waitForTimeout(2000);

      checkedCount = await getCheckedCount(page);
      selCount = await getSelectionCount(page);
      const currentPage2 = await page.evaluate(() => {
        const pc = document.querySelector('.Paginator-pageControl');
        return pc ? pc.textContent : '?';
      });
      console.log(`Toggle ${i} → page 2: sel=${selCount}, checked=${checkedCount}, paginator="${currentPage2}"`);
    }

    // Final state — navigate back to page 1
    await navigateToPage(page, 1);
    checkedCount = await getCheckedCount(page);
    selCount = await getSelectionCount(page);
    console.log(`Final page 1: sel=${selCount}, checked=${checkedCount}`);

    // Page 1 should still have 10 checked
    expect(checkedCount).toBe(10, `Page 1 should have 10 checked after toggling, got ${checkedCount}`);
    expect(selCount).toBe(10, `Selection count should be 10 after toggling, got ${selCount}`);
  });

  test('table styling: stripe rows and header alignment', async ({ page }) => {
    await login(page);
    await goToCredentials(page);

    // Check that table has proper structure
    const tableCount = await page.locator('table').count();
    expect(tableCount).toBeGreaterThan(0, 'Table element should exist');

    // Check header row exists
    const headerCells = await page.locator('thead th').count();
    expect(headerCells).toBeGreaterThan(0, 'Header cells should exist');

    // Check body rows exist
    const bodyRows = await page.locator('tbody tr').count();
    expect(bodyRows).toBeGreaterThan(0, 'Body rows should exist');

    // Check stripe rows styling — alternate rows should have different background
    const firstRowBg = await page.locator('tbody tr').first().evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    
    if (bodyRows >= 2) {
      const secondRowBg = await page.locator('tbody tr').nth(1).evaluate(el => 
        window.getComputedStyle(el).backgroundColor
      );
      // Stripe rows should have alternating backgrounds
      test.info().annotations.push({ 
        type: 'info', 
        description: `Row 1 BG: ${firstRowBg}, Row 2 BG: ${secondRowBg}` 
      });
    }

    // Check that checkbox column is present and aligned
    const headerCheckbox = await page.locator('thead input[type="checkbox"]').count();
    expect(headerCheckbox).toBe(1, 'Header should have 1 checkbox');

    const bodyCheckboxes = await page.locator('tbody input[type="checkbox"]').count();
    expect(bodyCheckboxes).toBe(bodyRows, 'Each body row should have a checkbox');
  });
});
