/**
 * test-reference-data.js - Unit tests for getApps, getUsers, getRoles
 *
 * Tests verify data mapping from Splunk REST API responses and
 * graceful degradation when requests fail.
 *
 * Run with: node tests/test-reference-data.js
 */

const assert = require('assert').strict;

// Minimal DOM mock — splunkdRequest calls getCSRFToken() which accesses document.cookie
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { cookie: '' };
}

// Intercept fetch before requiring api.js
const originalFetch = globalThis.fetch || (() => {});
const routeMocks = {};

globalThis.fetch = async (url, opts) => {
  const method = opts?.method || 'GET';
  // Match on the internal path portion after __raw
  for (const [routePattern, mock] of Object.entries(routeMocks)) {
    if (url.includes(routePattern)) {
      if (mock.error) {
        throw new Error(mock.error);
      }
      const body = mock.body || {};
      return {
        ok: true,
        status: 200,
        json: async () => typeof body === 'string' ? JSON.parse(body) : body,
        text: async () => typeof body === 'string' ? body : JSON.stringify(body),
      };
    }
  }
  // Unmatched route — throw to trigger graceful fallback
  throw new Error(`Unmocked fetch: ${url}`);
};

const api = require('../appserver/static/react/api.js');

// --- Test runner (async-aware) ---
let pendingTests = [];

function describeOrRun(name, fn) {
  console.log(`\nTesting: ${name}`);
  try {
    if (fn.constructor.name === 'AsyncFunction') {
      pendingTests.push(fn.bind(this));
    } else {
      fn();
    }
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

function it(desc, fn) {
  pendingTests.push(async () => {
    try {
      await fn();
      console.log(`  ✓ ${desc}`);
    } catch (e) {
      console.error(`  ✗ ${desc}: ${e.message}`);
      process.exitCode = 1;
      throw e;
    }
  });
}

async function flushTests() {
  const tests = pendingTests.splice(0);
  for (const test of tests) {
    await test();
  }
}

// --- Tests: getApps ---
describeOrRun('getApps', () => {
  it('maps entry array to { name } objects', async () => {
    const appsPath = '/servicesNS/-/-/apps/local';
    routeMocks[appsPath] = { body: { entry: [{ name: 'search' }, { name: 'dashboard' }] } };
    const result = await api.getApps();
    assert.deepStrictEqual(result, [{ name: 'search' }, { name: 'dashboard' }]);
    delete routeMocks[appsPath];
  });

  it('returns empty array on network failure', async () => {
    // No mock set — fetch will throw, triggering graceful fallback
    const result = await api.getApps();
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when response has no entry key', async () => {
    const appsPath = '/servicesNS/-/-/apps/local';
    routeMocks[appsPath] = { body: {} };
    const result = await api.getApps();
    assert.deepStrictEqual(result, []);
    delete routeMocks[appsPath];
  });

  return flushTests();
});

// --- Tests: getUsers ---
describeOrRun('getUsers', () => {
  it('maps /authentication/users to array of { name, fullName, email }', async () => {
    const userPath = '/authentication/users';
    routeMocks[userPath] = { body: { entry: [
      { name: 'admin', content: { fullName: 'Admin User', email: 'admin@example.com' } },
      { name: 'reader', content: { fullName: '', email: '' } },
    ]} };
    const result = await api.getUsers();
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].name, 'admin');
    assert.strictEqual(result[0].fullName, 'Admin User');
    assert.strictEqual(result[0].email, 'admin@example.com');
    assert.strictEqual(result[1].name, 'reader');
    assert.strictEqual(result[1].fullName, '');
    delete routeMocks[userPath];
  });

  it('returns empty array on network failure', async () => {
    const result = await api.getUsers();
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when no entries', async () => {
    const userPath = '/authentication/users';
    routeMocks[userPath] = { body: { entry: [] } };
    const result = await api.getUsers();
    assert.deepStrictEqual(result, []);
    delete routeMocks[userPath];
  });

  return flushTests();
});

// --- Tests: getCurrentUser ---
describeOrRun('getCurrentUser', () => {
  it('returns "nobody" when Splunk.util is not available', async () => {
    const result = api.getCurrentUser();
    assert.strictEqual(result, 'nobody');
  });

  return flushTests();
});

// --- Tests: getRoles ---
describeOrRun('getRoles', () => {
  it('maps entry array to role name strings', async () => {
    const rolesPath = '/authorization/roles';
    routeMocks[rolesPath] = { body: { entry: [{ name: 'admin' }, { name: 'power' }, { name: 'user' }] } };
    const result = await api.getRoles();
    assert.deepStrictEqual(result, ['admin', 'power', 'user']);
    delete routeMocks[rolesPath];
  });

  it('returns empty array on network failure', async () => {
    const result = await api.getRoles();
    assert.deepStrictEqual(result, []);
  });

  return flushTests();
});

// --- Tests: parseError (both XML and JSON) ---
describeOrRun('parseError', () => {
  it('extracts message from Splunk JSON error format', async () => {
    const jsonErr = '{"messages":[{"type":"WARN","text":"Login failed"},{"type":"ERROR","text":"Bad password"}]}';
    const result = api.parseError(jsonErr);
    assert.strictEqual(result, 'Login failed; Bad password');
  });

  it('handles legacy XML error format', async () => {
    const xmlErr = '<response><messages><msg code="123">Credential already exists</msg></messages></response>';
    const result = api.parseError(xmlErr);
    assert.strictEqual(result, 'Credential already exists');
  });

  it('returns empty string for null input', async () => {
    assert.strictEqual(api.parseError(null), '');
    assert.strictEqual(api.parseError(undefined), '');
    assert.strictEqual(api.parseError(''), '');
  });

  it('handles JSON with error string field', async () => {
    const jsonErr = '{"error":"Something went wrong"}';
    const result = api.parseError(jsonErr);
    assert.strictEqual(result, 'Something went wrong');
  });

  return flushTests();
});

// --- Tests: parseCreateError ---
describeOrRun('parseCreateError', () => {
  it('detects HTTP 409 as duplicate conflict', async () => {
    const err = new Error('Conflict');
    err.status = 409;
    const result = api.parseCreateError(err);
    assert.strictEqual(result.isDuplicate, true);
    assert.ok(result.message.includes('already exists'));
  });

  it('detects "already exists" in message as duplicate', async () => {
    const err = new Error('credential already exists');
    err.status = 500;
    const result = api.parseCreateError(err);
    assert.strictEqual(result.isDuplicate, true);
  });

  it('returns original error message for non-duplicate errors', async () => {
    const err = new Error('Connection refused');
    err.status = 502;
    const result = api.parseCreateError(err);
    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.message, 'Connection refused');
  });

  it('falls back to generic message when error has no message', async () => {
    const err = {};
    err.status = 502;
    const result = api.parseCreateError(err);
    assert.strictEqual(result.isDuplicate, false);
    assert.ok(result.message.includes('Failed to create'));
  });

  return flushTests();
});

// --- Tests: buildAclPath ---
describeOrRun('buildAclPath', () => {
  it('builds correct ACL path with credential: prefix', async () => {
    const path = api.buildAclPath('prod:api-user:', 'admin', 'search');
    assert.ok(path.includes('credential%3Aprod%3Aapi-user%3A'));
    assert.ok(path.includes('/configs/conf-passwords/'));
  });

  it('defaults owner to nobody when not provided', async () => {
    const path = api.buildAclPath('test:cred:', undefined, 'search');
    assert.ok(path.includes('nobody'));
  });

  return flushTests();
});
