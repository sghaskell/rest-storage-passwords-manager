/**
 * test-csv-sanitization.js - Unit tests for CSV sanitization and row limits
 *
 * Run with: node tests/test-csv-sanitization.js
 */

const assert = require('assert').strict;

// Mock window for getCurrentApp() / getCurrentUser()
global.window = {
  location: { pathname: '/app/search/...' },
  Splunk: { util: { getConfigValue: () => 'testuser' } },
};

const api = require('../appserver/static/react/api.js');

describeOrRun('parseCSV sanitization', () => {
  it('strips null bytes from fields', () => {
    const csv = 'username,password,realm\nuser\x00name,pass\x00word,realm';
    const { rows, errors } = api.parseCSV(csv);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].username, 'username');
    assert.strictEqual(rows[0].password, 'password');
    assert.strictEqual(rows[0].realm, 'realm');
  });

  it('trims whitespace from fields', () => {
    const csv = 'username,password,realm\n  user  ,  pass  ,  realm  ';
    const { rows } = api.parseCSV(csv);
    assert.strictEqual(rows[0].username, 'user');
    assert.strictEqual(rows[0].password, 'pass');
    assert.strictEqual(rows[0].realm, 'realm');
  });

  it('rejects fields exceeding 1024 characters', () => {
    const longValue = 'x'.repeat(1025);
    const csv = `username,password,realm\n${longValue},pass,realm`;
    const { rows, errors } = api.parseCSV(csv);
    assert.strictEqual(rows.length, 0);
    assert.ok(errors.length > 0, 'Should have errors for oversized field');
    assert.ok(errors[0].includes('1024'), 'Error should mention 1024 character limit');
  });

  it('handles script tag injection in fields', () => {
    const csv = 'username,password,realm\n<script>alert(1)</script>,pass,realm';
    const { rows } = api.parseCSV(csv);
    // Null bytes stripped, trimmed — but script tags pass through (Splunk handles escaping)
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].username, '<script>alert(1)</script>');
  });

  it('sanitizes all optional fields', () => {
    const csv = 'username,password,realm,app,owner,sharing,read,write\nuser,pass, r , app , own , app , r1 , w1 ';
    const { rows } = api.parseCSV(csv);
    assert.strictEqual(rows[0].realm, 'r');
    assert.strictEqual(rows[0].app, 'app');
    assert.strictEqual(rows[0].owner, 'own');
    assert.strictEqual(rows[0].read, 'r1');
    assert.strictEqual(rows[0].write, 'w1');
  });
});

describeOrRun('parseCSV row limit', () => {
  it('enforces 500 row limit', () => {
    const lines = ['username,password,realm'];
    for (let i = 0; i < 510; i++) {
      lines.push(`user${i},pass${i},realm`);
    }
    const csv = lines.join('\n');
    const { rows, errors } = api.parseCSV(csv);
    assert.strictEqual(rows.length, 500);
    assert.ok(errors.some(e => e.includes('500')), 'Should mention row limit');
  });

  it('allows exactly 500 rows without warning', () => {
    const lines = ['username,password,realm'];
    for (let i = 0; i < 500; i++) {
      lines.push(`user${i},pass${i},realm`);
    }
    const csv = lines.join('\n');
    const { rows, errors } = api.parseCSV(csv);
    assert.strictEqual(rows.length, 500);
    assert.strictEqual(errors.length, 0);
  });

  it('handles fewer than 500 rows normally', () => {
    const csv = 'username,password,realm\nuser1,pass1,r\nuser2,pass2,r';
    const { rows, errors } = api.parseCSV(csv);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(errors.length, 0);
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
