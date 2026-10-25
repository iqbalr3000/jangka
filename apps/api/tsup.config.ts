import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  // One bundle with everything that can be bundled. Playwright can't (it spawns its driver): it's
  // the only prod dependency, installed in the image with `pnpm deploy`. The worker's runtime
  // files (mermaid's browser build, fonts) are copied to dist/assets by the build script.
  noExternal: [/^(?!playwright-core)/],
  external: ["pg-native", "playwright-core"],
  banner: {
    // Bundled CJS deps (pg, pino) call require() on Node builtins.
    // Aliased: bundled ESM deps import createRequire themselves.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
