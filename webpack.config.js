const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    mode: argv.mode || 'production',
    entry: path.resolve(__dirname, 'appserver/static/react/bundle.jsx'),
    output: {
      path: path.resolve(__dirname, 'appserver/static/react'),
      filename: 'bundle.js',
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', { targets: 'defaults' }],
                ['@babel/preset-react', { runtime: 'classic' }],
              ],
            },
          },
        },
      ],
    },
    resolve: {
      extensions: ['.js', '.jsx'],
    },
    // No externals — React, ReactDOM, and styled-components must all be bundled.
    // Splunk does not provide these as globals.
    externals: {},
    plugins: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
          },
        },
      }),
    ],
    devServer: {
      static: {
        directory: path.join(__dirname, 'appserver/static/react'),
      },
      port: 5173,
      hot: false,
      liveReload: false,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
    devtool: isProduction ? false : 'source-map',
  };
};
