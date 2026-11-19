# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/indexer/Dockerfile .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Reduce the monorepo to @stellarlens/indexer and its workspace deps (db), with a pruned lockfile.
FROM base AS pruner
RUN npm install -g turbo@2.10.12
COPY . .
RUN turbo prune @stellarlens/indexer --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Root build config that every package extends; turbo prune only carries workspace packages.
COPY --from=pruner /app/tsconfig.base.json /app/turbo.json ./
RUN pnpm turbo run build --filter=@stellarlens/indexer

# Runtime: production dependencies plus compiled output only.
FROM base AS runner
ENV NODE_ENV=production REGISTRY_PORT=3002
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/apps/indexer/dist apps/indexer/dist
USER node
EXPOSE 3002
# The registry server (and its /health route) only runs in daemon mode, not with POLL_ONCE=true.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${REGISTRY_PORT}/health" >/dev/null || exit 1
CMD ["node", "apps/indexer/dist/index.js"]
