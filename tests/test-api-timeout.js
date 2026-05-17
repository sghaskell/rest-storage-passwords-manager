/**
 * test-api-timeout.js - Unit tests for fetch timeout and AbortController
 *
 * Run with: node tests/test-api-timeout.js
 */

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

describeOrRun('api fetch timeout configuration', () => {
  it('DEFAULT_FETCH_TIMEOUT_MS constant is defined in api.js', () => {
    const source = fs.readFileSync(path.join(__dirname, '../appserver/static/react/api.js'), 'utf8');
    assert.ok(source.includes('DEFAULT_FETCH_TIMEOUT_MS'), 'api.js should define DEFAULT_FETCH_TIMEOUT_MS');
    assert.ok(source.includes('30000'), 'Default timeout should be 30000ms');
  });

  it('apiRequest uses AbortController with timeout', () => {
    const source = fs.readFileSync(path.join(__dirname, '../appserver/static/react/api.js'), 'utf8');
    assert.ok(source.includes('AbortController'), 'apiRequest should use AbortController');
    assert.ok(source.includes('controller.abort()'), 'AbortController should be triggered on timeout');
    assert.ok(source.includes('signal: controller.signal'), 'signal should be passed to fetch');
  });

  it('splunkdRequest uses AbortController with timeout', () => {
    const source = fs.readFileSync(path.join(__dirname, '../appserver/static/react/api.js'), 'utf8');
    // Count AbortController occurrences — should be in both apiRequest and splunkdRequest
    const matches = source.match(/AbortController/g);
    assert.ok(matches && matches.length >= 2, 'Both apiRequest and splunkdRequest should use AbortController');
  });

  it('timeout is configurable via options.timeout', () => {
    const source = fs.readFileSync(path.join(__dirname, '../appserver/static/react/api.js'), 'utf8');
    assert.ok(source.includes('options.timeout'), 'Timeout should be configurable via options');
  });
});

describeOrRun('non-JSON response handling', () => {
  it('apiRequest handles non-JSON content-type gracefully', () => {
    const source = fs.readFileSync(path.join(__dirname, '../appserver/static/react/api.js'), 'utf8');
    assert.ok(source.includes('content-type'), 'Should check content-type header');
    assert.ok(source.includes('Invalid response'), 'Should return error object for non-JSON');
  });

  it('splunkdRequest handles non-JSON content-type gracefully', () => {
    const source = fs.readFileSync(path.join(__dirname, '../appserver/static/react/api.js'), 'utf8');
    const matches = source.match(/Invalid response/g);
    assert.ok(matches && matches.length >= 2, 'Both functions should handle non-JSON responses');
  });
});

// Simple test runner
function describeOrRun(name, fn) {
  console.log(`\nTesting: ${name}`);
  try {
    fn();
    console.log(`  ✓ All tests passed`);
  } catch (e) {
    console.error(`  ✗ FAILED: ${e.message}`);
    process.exitCode = 1;
  }
}

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
  } catch (e) {
    console.error(`  ✗ ${desc}: ${e.message}`);
    throw e;
  }
}
