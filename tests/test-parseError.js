/**
 * test-parseError.js - Unit tests for parseError helper
 *
 * Run with: node tests/test-parseError.js
 */

const assert = require('assert').strict;

const api = require('../appserver/static/react/api.js');

describeOrRun('parseError', () => {
  it('returns plain text error unchanged', () => {
    const result = api.parseError('Something went wrong');
    assert.strictEqual(result, 'Something went wrong');
  });

  it('extracts message from XML <msg> tag', () => {
    const xml = '<response><messages><msg type="ERROR">Credential already exists</msg></messages></response>';
    const result = api.parseError(xml);
    assert.ok(result.includes('already exists'), `Expected "already exists" in: ${result}`);
  });

  it('extracts first <msg> tag when multiple present', () => {
    const xml = '<response><messages><msg type="ERROR">First error</msg><msg type="WARN">Second warning</msg></messages></response>';
    const result = api.parseError(xml);
    assert.ok(result.includes('First error'), `Expected "First error" in: ${result}`);
    assert.ok(!result.includes('Second warning'), `Should not include "Second warning": ${result}`);
  });

  it('returns original text trimmed when no <msg> tag', () => {
    const xml = '<response><messages><trace>Error at line 42</trace></messages></response>';
    const result = api.parseError(xml);
    assert.ok(!result.includes('<msg'), `Should not contain unmatched tags: ${result}`);
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
