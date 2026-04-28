const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: 'line',
});
