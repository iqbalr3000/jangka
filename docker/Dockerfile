# Build context: repository root (docker compose -f docker/docker-compose.yml up --build).
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build

# The api bundle is self-contained, so the runtime image needs no node_modules.
FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY --from=build /repo/packages/db/migrations packages/db/migrations
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
