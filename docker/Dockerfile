# Build context: repository root.

# ---- build ----
# Runs on the host platform in multi-arch builds; its output is platform-independent JS.
FROM --platform=$BUILDPLATFORM node:24-slim AS build

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable

WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile && pnpm build
RUN pnpm --filter @jangka/api deploy --prod --legacy /deploy


# ---- runtime ----
FROM node:24-slim AS runtime

ENV NODE_ENV=production PORT=3000 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY --from=build /deploy/node_modules apps/api/node_modules

# Headless Chromium only; xvfb (and the ~170 MB of Mesa/LLVM it pulls in) is for headed browsers.
RUN node apps/api/node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
  && apt-get purge -y --auto-remove xvfb \
  && rm -rf /var/lib/apt/lists/* /ms-playwright/ffmpeg-*

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY --from=build /repo/packages/db/migrations packages/db/migrations
COPY docker/healthcheck.mjs ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD ["node", "healthcheck.mjs"]

CMD ["node", "apps/api/dist/main.js"]
