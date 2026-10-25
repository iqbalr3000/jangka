import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

export const MERMAID_SCRIPT = "mermaid/dist/mermaid.min.js";
export const FONT_STYLESHEETS = [
  "@fontsource-variable/inter/wght.css",
  "@fontsource-variable/jetbrains-mono/wght.css",
];
// Normal style, Latin + Latin Extended subsets (each face keeps its unicode-range).
export const FONT_SUBSET = /-latin(-ext)?-wght-normal\.woff2$/;

/**
 * A file the worker reads at runtime: next to the api bundle (`dist/assets/<specifier>`, the
 * Docker image ships only these files) or from node_modules (dev, tests).
 */
export function assetPath(specifier: string): string {
  const bundled = path.join(import.meta.dirname, "assets", specifier);
  return existsSync(bundled) ? bundled : require.resolve(specifier);
}

/** Every runtime asset as `{ specifier, source }`, for copying next to the bundle at build time. */
export function runtimeAssets(): { specifier: string; source: string }[] {
  const fonts = FONT_STYLESHEETS.flatMap((stylesheet) => {
    const source = require.resolve(stylesheet);
    const files = [...readFileSync(source, "utf8").matchAll(/url\(\.\/(files\/[^)]+)\)/g)]
      .map((m) => m[1] ?? "")
      .filter((file) => FONT_SUBSET.test(file));
    const dir = path.posix.dirname(stylesheet);
    return [
      { specifier: stylesheet, source },
      ...files.map((file) => ({
        specifier: `${dir}/${file}`,
        source: path.join(path.dirname(source), file),
      })),
    ];
  });
  return [{ specifier: MERMAID_SCRIPT, source: require.resolve(MERMAID_SCRIPT) }, ...fonts];
}
