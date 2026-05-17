/**
 * test-parseCreateError.js - Unit tests for parseCreateError helper and default role constants
 *
 * Run with: node tests/test-parseCreateError.js
 */

const assert = require('assert').strict;

const api = require('../appserver/static/react/api.js');

describeOrRun('parseCreateError', () => {
  it('detects 409 status as duplicate', () => {
    const result = api.parseCreateError({ status: 409, message: 'Conflict' });
    assert.strictEqual(result.isDuplicate, true);
    assert.ok(result.message.includes('already exists'));
  });

  it('detects "already exists" in message text as duplicate', () => {
    const result = api.parseCreateError({ status: 200, message: 'Credential already exists' });
    assert.strictEqual(result.isDuplicate, true);
  });

  it('returns isDuplicate:false for non-conflict errors', () => {
    const result = api.parseCreateError({ status: 500, message: 'Server error' });
    assert.strictEqual(result.isDuplicate, false);
  });
});

describeOrRun('DEFAULT_READ_ROLES and DEFAULT_WRITE_ROLES', () => {
  it('DEFAULT_READ_ROLES contains admin and power', () => {
    assert.deepStrictEqual(api.DEFAULT_READ_ROLES, ['admin', 'power']);
  });

  it('DEFAULT_WRITE_ROLES contains admin and power', () => {
    assert.deepStrictEqual(api.DEFAULT_WRITE_ROLES, ['admin', 'power']);
  });
});

// Simple test runner (no framework needed)
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
