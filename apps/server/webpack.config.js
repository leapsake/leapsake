import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
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
		path: path.resolve(__dirname, 'dist'),
		filename: 'main.js',
		module: true,
	},
	optimization: {
		minimize: false,
	},
};
