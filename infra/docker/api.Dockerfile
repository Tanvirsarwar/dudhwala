# syntax=docker/dockerfile:1
# Dudhwala API image (NestJS). Build from the repository root:
#   docker build -f infra/docker/api.Dockerfile -t dudhwala-api .
# Targets:
#   runtime (default) — the API server: `node dist/main.js`
#   migrate           — one-off release step: `prisma migrate deploy`
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dudhwala/shared build \
 && pnpm --filter @dudhwala/api prisma:generate \
 && pnpm --filter @dudhwala/api build \
 && pnpm --filter @dudhwala/api deploy --prod /out

# Release step: run before new API containers receive traffic (DEPLOYMENT_RUNBOOK §7).
FROM build AS migrate
WORKDIR /repo/apps/api
ENV NODE_ENV=production
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
