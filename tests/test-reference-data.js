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
  it('maps current-context to { username, fullName, email }', async () => {
    const userPath = '/authentication/current-context';
    routeMocks[userPath] = { body: { entry: [{ content: { name: 'admin', fullName: 'Admin User', email: 'admin@example.com' } }] } };
    const result = await api.getUsers();
    assert.strictEqual(result.username, 'admin');
    assert.strictEqual(result.fullName, 'Admin User');
    assert.strictEqual(result.email, 'admin@example.com');
    delete routeMocks[userPath];
  });

  it('returns { username: "nobody" } on network failure', async () => {
    const result = await api.getUsers();
    assert.deepStrictEqual(result, { username: 'nobody' });
  });

  it('handles missing content fields with fallbacks', async () => {
    const userPath = '/authentication/current-context';
    routeMocks[userPath] = { body: { entry: [{ content: {} }] } };
    const result = await api.getUsers();
    assert.strictEqual(result.username, 'nobody');
    assert.strictEqual(result.fullName, '');
    assert.strictEqual(result.email, '');
    delete routeMocks[userPath];
  });

  it('returns nobody when no entries', async () => {
    const userPath = '/authentication/current-context';
    routeMocks[userPath] = { body: { entry: [] } };
    const result = await api.getUsers();
    assert.deepStrictEqual(result, { username: 'nobody' });
    delete routeMocks[userPath];
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
