# syntax=docker/dockerfile:1
# Storefront (APP=web, port 3000) or admin (APP=admin, port 3001) image (Next.js standalone).
# NEXT_PUBLIC_* values are compiled into the browser bundle, so build one image per
# environment (staging, production):
#   docker build -f infra/docker/next.Dockerfile --build-arg APP=web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/v1 \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://example.com \
#     --build-arg NEXT_PUBLIC_MEDIA_ORIGINS=https://media.example.com -t dudhwala-web .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP=web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_ORIGINS
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_MEDIA_ORIGINS=$NEXT_PUBLIC_MEDIA_ORIGINS
COPY . .
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dudhwala/shared build && pnpm --filter "@dudhwala/$APP" build

FROM node:22-bookworm-slim AS runtime
ARG APP=web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 APP=$APP
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/$APP/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/$APP/.next/static ./apps/$APP/.next/static
COPY --from=build --chown=node:node /repo/apps/$APP/public ./apps/$APP/public
USER node
# PORT: 3000 for web, 3001 for admin (set by the platform).
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "exec node apps/$APP/server.js"]
