const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

process.env.EXPO_ROUTER_APP_ROOT = path.resolve(projectRoot, 'app');

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.blockList = [
  ...(config.resolver.blockList || []),
  /\/\.pnpm\//,
  /\/pnpm\//,
];

module.exports = config;
