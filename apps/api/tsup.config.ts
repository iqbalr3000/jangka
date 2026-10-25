import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  // One bundle with everything that can be bundled. Playwright can't (it spawns its driver), and
  // the worker reads mermaid's browser build and font files from node_modules at runtime; the
  // image installs those prod dependencies with `pnpm deploy`.
  noExternal: [/^(?!playwright-core)/],
  external: ["pg-native", "playwright-core"],
  banner: {
    // Bundled CJS deps (pg, pino) call require() on Node builtins.
    // Aliased: bundled ESM deps import createRequire themselves.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
