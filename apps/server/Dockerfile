# syntax=docker/dockerfile:1

# The Leapsake blind relay as a single self-contained file. Two stages: install
# the relay's workspace subgraph and esbuild-bundle it (build), then run just that
# one file on a clean image with no node_modules (runtime). Build from the repo
# root so the workspace packages are in context:
#
#   docker build -f apps/server/Dockerfile -t leapsake-relay .
#
# or via docker-compose.yml (which sets context: . for you).

# --- build: install the relay's dependency subgraph and bundle it ------------
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
# The repo-root .dockerignore keeps node_modules / dist / .git out of the context.
COPY . .
# Install the workspace so esbuild can resolve + inline the relay's deps, then emit
# dist/index.mjs with everything but Node built-ins bundled in (see the README).
# `pnpm install` can't be scoped by --filter (it always installs the whole
# workspace), but because we *bundle*, no install scripts are needed:
# `--ignore-scripts` skips the desktop/mobile postinstalls (electron's binary
# download, better-sqlite3's native build), keeping the build hermetic and
# toolchain-free. The unrelated packages are harmless JS, discarded with this stage.
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @leapsake/server build

# --- runtime: one file, zero runtime deps ------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Only the bundle — no node_modules, no source.
COPY --from=build /repo/apps/server/dist/index.mjs ./index.mjs
# The blind append-log lives on a volume so a restart keeps it (sync.md §2: losing
# it costs at most one re-join per device, but don't discard it needlessly).
ENV RELAY_DB=/data/relay.db
RUN mkdir -p /data && chown node:node /data
VOLUME /data
# Default relay port (override with PORT). The relay speaks plain HTTP here; TLS is
# terminated in front of it (Option A, the default) or in-process later (Option B).
EXPOSE 4000
USER node
CMD ["node", "index.mjs"]
