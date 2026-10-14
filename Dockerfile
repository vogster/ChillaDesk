# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /repo
# Pin pnpm from the packageManager field once, so later stages do not download it again.
COPY package.json ./
RUN corepack enable && corepack install

# ---- build both apps ----
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm turbo run build --filter=@chilladesk/api --filter=@chilladesk/web

# ---- production dependencies of the API only ----
FROM base AS api-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --prod --filter=@chilladesk/api...

# ---- API runtime ----
FROM node:24-alpine AS api
ENV NODE_ENV=production
# Used only when DATABASE_URL is not set (embedded PGlite).
ENV PGLITE_DATA_DIR=/data/pglite
RUN mkdir -p /data && chown node:node /data
VOLUME /data
WORKDIR /repo
COPY --from=api-deps /repo/node_modules ./node_modules
COPY --from=api-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/drizzle ./apps/api/drizzle
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.mjs"]

# ---- Web: static files + reverse proxy to the API ----
FROM caddy:2-alpine AS web
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
EXPOSE 80

# ---- Everything in one container: the API serves the web app, data in /data ----
# For trying ChillaDesk with one docker run, or a small team. Without DATABASE_URL it uses
# the embedded PGlite database in /data/pglite; set DATABASE_URL to use PostgreSQL.
FROM node:24-alpine AS all-in-one
ENV NODE_ENV=production \
    PGLITE_DATA_DIR=/data/pglite \
    FILES_DIR=/data/files \
    WEB_DIR=/repo/web
RUN apk add --no-cache su-exec && mkdir -p /data
VOLUME /data
WORKDIR /repo
COPY --from=api-deps /repo/node_modules ./node_modules
COPY --from=api-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /repo/apps/web/dist ./web
COPY --chmod=755 docker/all-in-one-entrypoint.sh /usr/local/bin/chilladesk-entrypoint
WORKDIR /repo/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["chilladesk-entrypoint"]
CMD ["node", "dist/server.mjs"]
