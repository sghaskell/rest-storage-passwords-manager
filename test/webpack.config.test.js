/**
 * Test: webpack.config.js production hardening
 * 
 * Validates that webpack.config.js has:
 * - TerserPlugin with drop_console in plugins
 * - Conditional devtool (false for prod, 'source-map' for dev)
 * 
 * Run with: node --test test/webpack.config.test.js
 */

const { test, describe } = require('node:test');
const assert = require('assert');

describe('webpack.config.js Task 1 - TerserPlugin and conditional devtool', () => {
  test('exports a function that returns config object', () => {
    const config = require('../webpack.config');
    assert.strictEqual(
      typeof config, 'function',
      'webpack.config.js should export a function for conditional config'
    );
  });

  test('includes TerserPlugin in plugins array when mode is production', () => {
    // Fresh require to avoid caching issues
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const prodConfig = config({}, { mode: 'production' });
    const terserPlugin = prodConfig.plugins.find(
      (p) => p.constructor && p.constructor.name === 'TerserPlugin'
    );
    assert.ok(terserPlugin, 'Should have TerserPlugin in production config');
  });

  test('has drop_console: true in TerserPlugin terserOptions', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const prodConfig = config({}, { mode: 'production' });
    const terserPlugin = prodConfig.plugins.find(
      (p) => p.constructor && p.constructor.name === 'TerserPlugin'
    );
    // TerserPlugin stores terser options under minimizer.options.compress
    assert.ok(
      terserPlugin.options &&
      terserPlugin.options.minimizer &&
      terserPlugin.options.minimizer.options &&
      terserPlugin.options.minimizer.options.compress &&
      terserPlugin.options.minimizer.options.compress.drop_console === true,
      'TerserPlugin should have drop_console: true in compress options via minimizer'
    );
  });

  test('sets devtool to false in production mode', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const prodConfig = config({}, { mode: 'production' });
    assert.strictEqual(
      prodConfig.devtool, false,
      'devtool should be false in production'
    );
  });

  test('sets devtool to source-map in development mode', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const devConfig = config({}, { mode: 'development' });
    assert.strictEqual(
      devConfig.devtool, 'source-map',
      'devtool should be source-map in development'
    );
  });
});

describe('webpack.config.js Task 2 - React/ReactDOM externals', () => {
  test('externalizes react as React global', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const devConfig = config({}, { mode: 'development' });
    assert.strictEqual(
      devConfig.externals['react'], 'React',
      'react should be externalized as React global'
    );
  });

  test('externalizes react-dom as ReactDOM global', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const devConfig = config({}, { mode: 'development' });
    assert.strictEqual(
      devConfig.externals['react-dom'], 'ReactDOM',
      'react-dom should be externalized as ReactDOM global'
    );
  });

  test('preserves splunkjs/mvc/simplexml/ready! external', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const devConfig = config({}, { mode: 'development' });
    assert.strictEqual(
      devConfig.externals['splunkjs/mvc/simplexml/ready!'],
      'splunkjs/mvc/simplexml/ready!',
      'splunkjs ready! external should be preserved'
    );
  });

  test('has exactly 3 externals entries', () => {
    delete require.cache[require.resolve('../webpack.config')];
    const config = require('../webpack.config');
    const devConfig = config({}, { mode: 'development' });
    const keys = Object.keys(devConfig.externals);
    assert.strictEqual(
      keys.length, 3,
      `Should have exactly 3 externals, found: ${keys.join(', ')}`
    );
  });
});
