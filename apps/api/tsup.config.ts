import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  clean: true,
  // Single self-contained file: the runtime image ships no node_modules.
  noExternal: [/.*/],
  external: ["pg-native"],
  banner: {
    // Bundled CJS deps (pg, pino) call require() on Node builtins.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
