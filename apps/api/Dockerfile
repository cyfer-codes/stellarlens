# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/api/Dockerfile .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Reduce the monorepo to @stellarlens/api and its workspace deps (db), with a pruned lockfile.
FROM base AS pruner
RUN npm install -g turbo@2.10.12
COPY . .
RUN turbo prune @stellarlens/api --docker

# Install every dependency (manifests first, so this layer caches across source changes), then build.
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Root build config that every package extends; turbo prune only carries workspace packages.
COPY --from=pruner /app/tsconfig.base.json /app/turbo.json ./
RUN pnpm turbo run build --filter=@stellarlens/api

# One-shot migration runner: `drizzle-kit migrate`, the same command CI and the README use.
FROM builder AS migrate
WORKDIR /app/packages/db
CMD ["pnpm", "db:migrate"]

# Runtime: production dependencies plus compiled output only.
FROM base AS runner
ENV NODE_ENV=production PORT=3000
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/ready" >/dev/null || exit 1
CMD ["node", "apps/api/dist/main.js"]
