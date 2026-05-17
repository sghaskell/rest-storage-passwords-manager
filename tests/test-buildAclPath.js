/**
 * test-buildAclPath.js - Unit tests for buildAclPath helper
 *
 * Run with: node tests/test-buildAclPath.js
 */

const assert = require('assert').strict;

// Import api.js module (CommonJS)
const api = require('../appserver/static/react/api.js');

describeOrRun('buildAclPath', () => {
  it('builds correct ACL path with credential: prefix for default owner/app', () => {
    const result = api.buildAclPath('prod:api-user:', 'nobody', 'search');
    assert.strictEqual(
      result,
      '/servicesNS/nobody/search/configs/conf-passwords/credential%3Aprod%3Aapi-user%3A/acl'
    );
  });

  it('uses default owner "nobody" when owner is falsy', () => {
    const result = api.buildAclPath('test:user:', null, 'search');
    assert.strictEqual(
      result,
      '/servicesNS/nobody/search/configs/conf-passwords/credential%3Atest%3Auser%3A/acl'
    );
  });

  it('uses default app "search" when app is falsy', () => {
    const result = api.buildAclPath('test:user:', 'nobody', null);
    assert.strictEqual(
      result,
      '/servicesNS/nobody/search/configs/conf-passwords/credential%3Atest%3Auser%3A/acl'
    );
  });

  it('URL-encodes special characters in stanza key', () => {
    const result = api.buildAclPath('my realm:user@host:', 'nobody', 'search');
    assert.ok(result.includes('credential%3Amy%20realm%3Auser%40host%3A'));
  });

  it('URL-encodes custom owner and app', () => {
    const result = api.buildAclPath('admin:user:', 'admin_user', 'my_app');
    assert.strictEqual(
      result,
      '/servicesNS/admin_user/my_app/configs/conf-passwords/credential%3Aadmin%3Auser%3A/acl'
    );
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
