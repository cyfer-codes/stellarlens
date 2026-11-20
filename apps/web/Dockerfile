# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/web/Dockerfile .

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# Reduce the monorepo to @stellarlens/web and its workspace deps (db), with a pruned lockfile.
FROM base AS pruner
RUN npm install -g turbo@2.10.12
COPY . .
RUN turbo prune @stellarlens/web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Root build config that every package extends; turbo prune only carries workspace packages.
COPY --from=pruner /app/tsconfig.base.json /app/turbo.json ./
RUN pnpm turbo run build --filter=@stellarlens/web

# One-shot seeding (admin user, dashboard api key): the tsx scripts need dev dependencies.
FROM builder AS tools
WORKDIR /app/apps/web
CMD ["sh", "-c", "pnpm seed-admin && pnpm seed-api-key"]

# Runtime: production dependencies plus the Next.js build only.
FROM base AS runner
ENV NODE_ENV=production PORT=3000
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/apps/web/next.config.js apps/web/next.config.js
COPY --from=builder --chown=node:node /app/apps/web/.next apps/web/.next
USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/login" >/dev/null || exit 1
CMD ["sh", "-c", "exec node_modules/.bin/next start -p \"$PORT\""]
