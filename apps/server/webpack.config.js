const { join } = require('path');

module.exports = {
  entry: './src/main.ts',
  target: 'node',
  mode: 'development',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    path: join(__dirname, 'dist'),
    filename: 'main.js',
  },
  optimization: {
    minimize: false,
  },
};
