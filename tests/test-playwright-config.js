const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('assert');

// Test that playwright.config.js exports getSplunkBaseUrl with correct defaults and env var support
describe('playwright.config.js Splunk URL Configuration', () => {
  beforeEach(() => {
    // Clean up env vars before each test
    delete process.env.SPLUNK_HOST;
    delete process.env.SPLUNK_PORT;
  });

  afterEach(() => {
    // Clean up env vars after each test
    delete process.env.SPLUNK_HOST;
    delete process.env.SPLUNK_PORT;
  });

  test('exports getSplunkBaseUrl function', () => {
    delete require.cache[require.resolve('../playwright.config.js')];
    const config = require('../playwright.config.js');
    assert.strictEqual(typeof config.getSplunkBaseUrl, 'function', 'getSplunkBaseUrl must be exported');
  });

  test('defaults host to 127.0.0.1 when SPLUNK_HOST not set', () => {
    delete process.env.SPLUNK_HOST;
    delete require.cache[require.resolve('../playwright.config.js')];
    const config = require('../playwright.config.js');
    const url = config.getSplunkBaseUrl();
    assert.ok(url.includes('127.0.0.1'), `URL should contain default host 127.0.0.1, got: ${url}`);
  });

  test('defaults port to 8000 when SPLUNK_PORT not set', () => {
    delete process.env.SPLUNK_PORT;
    delete require.cache[require.resolve('../playwright.config.js')];
    const config = require('../playwright.config.js');
    const url = config.getSplunkBaseUrl();
    assert.ok(url.includes('8000'), `URL should contain default port 8000, got: ${url}`);
  });

  test('uses SPLUNK_HOST env var when set', () => {
    process.env.SPLUNK_HOST = 'custom.host.com';
    delete require.cache[require.resolve('../playwright.config.js')];
    const config = require('../playwright.config.js');
    const url = config.getSplunkBaseUrl();
    assert.ok(url.includes('custom.host.com'), `URL should contain custom host, got: ${url}`);
  });

  test('uses SPLUNK_PORT env var when set', () => {
    process.env.SPLUNK_PORT = '9000';
    delete require.cache[require.resolve('../playwright.config.js')];
    const config = require('../playwright.config.js');
    const url = config.getSplunkBaseUrl();
    assert.ok(url.includes('9000'), `URL should contain custom port, got: ${url}`);
  });
});
