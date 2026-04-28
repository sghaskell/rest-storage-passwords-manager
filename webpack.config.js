const path = require('path');

module.exports = {
  mode: 'production',
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
  externals: {
    'splunkjs/mvc/simplexml/ready!': 'splunkjs/mvc/simplexml/ready!',
  },
  plugins: [],
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
  devtool: 'source-map',
};
