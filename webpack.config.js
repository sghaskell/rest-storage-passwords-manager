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
    // Splunk does NOT provide React/ReactDOM as globals — they must be bundled.
    // splunkjs/mvc is loaded at runtime via window.require(), not during webpack bundling.
    // styled-components IS provided by Splunk globally — externalize to avoid duplicate instance
    // breaking @splunk/react-ui component styling (duplicate context issue).
    externals: {
      'styled-components': 'styled-components',
    },
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
