# Build context: repository root (docker compose -f docker/docker-compose.yml up --build).
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build
# The api bundle holds everything except what it reads from node_modules at runtime
# (Playwright, mermaid's browser build, fonts): its prod dependencies.
RUN pnpm --filter @jangka/api deploy --prod --legacy /deploy

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=3000 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /deploy/node_modules apps/api/node_modules
# Headless Chromium + its system libraries and fonts; same Playwright version as the bundle uses.
RUN node apps/api/node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY --from=build /repo/packages/db/migrations packages/db/migrations
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
