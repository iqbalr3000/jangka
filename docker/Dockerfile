# Build context: repository root (docker compose -f docker/docker-compose.yml up --build).
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build
# The api bundle holds everything but Playwright (its only prod dependency); the worker's
# runtime files (mermaid's browser build, fonts) are in dist/assets.
RUN pnpm --filter @jangka/api deploy --prod --legacy /deploy

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=3000 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /deploy/node_modules apps/api/node_modules
# Headless Chromium + its system libraries and fonts; same Playwright version as the bundle uses.
# Playwright's dependency list includes xvfb, which pulls in Mesa/LLVM (~170 MB); only headed
# browsers need it, so it's removed with everything installed just for it.
RUN node apps/api/node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
  && apt-get purge -y --auto-remove xvfb \
  && rm -rf /var/lib/apt/lists/* /ms-playwright/ffmpeg-*
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY --from=build /repo/packages/db/migrations packages/db/migrations
USER node
EXPOSE 3000
# Checks the API and its database; APP_ROLE=worker serves no HTTP, so it only checks the process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "if (process.env.APP_ROLE === 'worker') process.exit(0); fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
