// Watches the monorepo and resolves the raw-TypeScript workspace packages; see
// `packages/README.md` → _Consumed as raw TypeScript_.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName, platform);
    } catch (error) {
      const base = moduleName.slice(0, -".js".length);
      for (const ext of [".ts", ".tsx"]) {
        try {
          return resolve(context, base + ext, platform);
        } catch {
          // try the next candidate extension
        }
      }
      throw error;
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
