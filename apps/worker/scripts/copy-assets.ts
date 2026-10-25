import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { runtimeAssets } from "../src/assets";

// Usage: tsx copy-assets.ts <outDir>. Run by the api build so the Docker image needs no
// mermaid / fontsource packages at runtime, only these files.
const outDir = process.argv[2];
if (!outDir) throw new Error("usage: copy-assets.ts <outDir>");
for (const { specifier, source } of runtimeAssets()) {
  const target = path.join(outDir, specifier);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
}
