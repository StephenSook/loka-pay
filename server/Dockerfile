# Settlement API image. Build from the repository root: docker build -f server/Dockerfile .
# Tests run in CI (server.yml), not in this build.
FROM node:22.23.3-bookworm-slim AS build
RUN npm install --global pnpm@12.3.4
WORKDIR /app
COPY protocol/lib /app/protocol/lib
COPY server/package.json server/pnpm-lock.yaml server/.npmrc /app/server/
WORKDIR /app/server
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY server/src ./src
COPY server/tsconfig.json server/tsconfig.build.json ./
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:22.23.3-bookworm-slim
WORKDIR /app/server
COPY --from=build /app/protocol/lib /app/protocol/lib
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./
# Public inputs only. Private keys are mounted read-only at /run/keys at run time.
COPY config/pins.json /app/config/pins.json
COPY programs/idl/loka_vault.json /app/programs/idl/loka_vault.json
ENV NODE_ENV=production
# Runs as root because the mounted keys are root-owned mode 600 (docs/RUNBOOK-KEYS.md). compose.yaml drops
# every capability, so root here cannot bypass file permissions, and the root filesystem is read-only.
EXPOSE 3001
CMD ["node", "dist/main.js"]
