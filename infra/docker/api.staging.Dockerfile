# syntax=docker/dockerfile:1
# Free-tier STAGING image for the API (Render free web service, see render.yaml and docs/FREE_STAGING.md).
# Differs from api.Dockerfile: keeps the full workspace (Prisma CLI, compiled seed/CLI) so the entrypoint can
# apply migrations on start. Do not use it for production; production runs the `migrate` image as a release step.
#   docker build -f infra/docker/api.staging.Dockerfile -t dudhwala-api-staging .
FROM node:22-bookworm-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NODE_ENV=staging
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @dudhwala/shared build \
 && pnpm --filter @dudhwala/api prisma:generate \
 && pnpm --filter @dudhwala/api build
RUN chown -R node:node /repo
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||process.env.PORT||4000)+'/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "/repo/infra/docker/staging-entrypoint.sh"]
