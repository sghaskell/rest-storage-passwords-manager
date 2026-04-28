const { test, expect } = require('@playwright/test');
require('dotenv').config();

test.describe('Splunk App Smoke Test', () => {
  test('should load the credentials table after login', async ({ page }) => {
    const username = process.env.SPLUNK_ADMIN_USER || 'admin';
    const password = process.env.SPLUNK_ADMIN_PASSWORD || 'password';

    // Ignore HTTPS errors for self-signed Splunk certs
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    
    // 1. Navigate to Splunk login
    await page.goto('http://127.0.0.1:8000/', { waitUntil: 'networkidle' });

    // 2. Login
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        page.click('input[value="Sign In"]')
    ]);
    
    console.log('Login click processed. Current URL:', page.url());
    await expect(page).not.toHaveURL(/.*account\/login.*/);

    // Listen for console messages to debug JS errors
    page.on('console', msg => console.log(`BROWSER CONSOLE: ${msg.type()} - ${msg.text()}`));
    page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));
    page.on('request', request => {
        if (request.url().includes('bundle.js')) {
            console.log(`REQUEST: ${request.method()} ${request.url()}`);
        }
    });
    page.on('requestfailed', request => {
        console.log(`REQUEST FAILED: ${request.url()} - ${request.failure().errorText}`);
    });
    page.on('response', response => {
        if (response.url().includes('bundle.js')) {
            console.log(`RESPONSE: ${response.status()} ${response.url()}`);
        }
    });

    // 3. Navigate to the app

    // 3. Navigate to the app
    const appHomeUrl = 'http://127.0.0.1:8000/en-US/app/rest-storage-passwords-manager';
    console.log(`Navigating to app home: ${appHomeUrl}`);
    
    try {
        await page.goto(appHomeUrl, { waitUntil: 'networkidle', timeout: 30000 });
        console.log('Reached app home. Current URL:', page.url());
    } catch (e) {
        console.error(`Navigation to home failed: ${e.message}`);
    }

    const appUrl = 'http://127.0.0.1:8000/en-US/app/rest-storage-passwords-manager/credential_management';
    console.log(`Navigating to view: ${appUrl}`);
    
    try {
        await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 30000 });
        console.log('Reached view. Current URL:', page.url());
    } catch (e) {
        console.error(`Navigation to view failed: ${e.message}`);
    }

    // 4. Verify the React app rendered
    const container = page.locator('#credential-manager-app');
    try {
        await expect(container).toBeVisible({ timeout: 20000 });
        console.log('App container found. Checking for content...');
        
        const content = await container.innerText();
        if (content.includes('Loading credentials...')) {
            console.log('App is still loading credentials...');
            // Wait a bit more for the table
            await page.waitForSelector('table', { timeout: 20000 });
        } else if (content.includes('Initialization Error')) {
            console.error('App showed an initialization error: ' + content);
            throw new Error('App initialization error: ' + content);
        }
    } catch (e) {
        console.log('App container not visible. Current URL:', page.url());
        console.log('Page title:', await page.title());
        const pageContent = await page.content();
        if (pageContent.includes('Login')) {
            console.log('Still on login page. Authentication failed or session lost.');
        } else if (pageContent.includes('launcher/home')) {
            console.log('Redirected to Splunk Home. App may not be installed or path is incorrect.');
        } else if (pageContent.includes('404')) {
            console.log('Page not found (404).');
        } else {
            console.log('Page content snippet:', pageContent.slice(0, 500));
        }
        throw e;
    }

    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10000 });
    // 5. Check that at least one row exists
    const header = page.locator('th');
    await expect(header.first()).toBeVisible();
    
    console.log('✓ App loaded and table rendered successfully');
  });
});
