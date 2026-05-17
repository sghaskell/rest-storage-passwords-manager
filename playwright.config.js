const { defineConfig } = require('@playwright/test');
require('dotenv').config();

/**
 * Get Splunk Docker base URL from environment variables.
 * Used by Playwright tests to target the running Splunk instance.
 * Defaults to 127.0.0.1:8000 (standard Docker Splunk dev port).
 */
function getSplunkBaseUrl() {
  const host = process.env.SPLUNK_HOST || '127.0.0.1';
  const port = process.env.SPLUNK_PORT || '8000';
  return `http://${host}:${port}`;
}

const config = defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 720 },
  },
  reporter: 'line',
});

// Attach getSplunkBaseUrl to config object for test fixtures and external use
config.getSplunkBaseUrl = getSplunkBaseUrl;

module.exports = config;
