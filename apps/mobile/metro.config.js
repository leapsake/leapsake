// Metro config for the Leapsake mobile app inside the pnpm monorepo.
//
// Two things make this non-default:
//
// 1. Monorepo — Metro must watch the repo root so it picks up our workspace
//    packages (`packages/*`), and resolve modules from both the app's and the
//    root's node_modules (pnpm `nodeLinker: hoisted`).
//
// 2. Raw-TS workspace packages — `@leapsake/*` ship TypeScript source and use
//    ESM `.js`-suffixed relative imports (e.g. `from "./person.js"`) under
//    `moduleResolution: "bundler"`. The file on disk is `person.ts`, so Metro's
//    resolver — which honors explicit extensions — can't find it. We shim it:
//    if a relative `.js` import fails to resolve, retry against `.ts`/`.tsx`.
//    Real `.js` files (node_modules) still resolve on the first attempt, so the
//    shim only ever fires for our source.
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
