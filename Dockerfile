# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY apps ./apps
COPY scripts/build-error-pages.js ./scripts/build-error-pages.js
RUN npm run build

FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api ./apps/api
COPY apps/shared ./apps/shared
COPY apps/bot ./apps/bot
COPY --from=build /app/apps/web ./apps/web
COPY scripts/run.js ./scripts/run.js
COPY scripts/docker ./scripts/docker
RUN mkdir -p data/mods data/clients data/configs data/launcher/releases apps/web/.next/cache /var/lib/mc-launcher-bot \
    && chown -R node:node data apps/web/.next /var/lib/mc-launcher-bot
USER node
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "/app/scripts/docker/entrypoint.sh"]
