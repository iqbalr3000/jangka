import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const STYLESHEETS = [
  "@fontsource-variable/inter/wght.css",
  "@fontsource-variable/jetbrains-mono/wght.css",
];
// Normal style, Latin + Latin Extended subsets (each face keeps its unicode-range).
const SUBSET = /-latin(-ext)?-wght-normal\.woff2$/;

let css: string | null = null;

/** Fontsource @font-face rules with the files inlined, since the PDF page has no network access. */
export function fontCss(): string {
  css ??= STYLESHEETS.map((stylesheet) => {
    const file = require.resolve(stylesheet);
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/@font-face\s*{[^}]*}/g)]
      .map(([face]) => {
        const url = /url\(\.\/(files\/[^)]+)\)/.exec(face)?.[1];
        if (!url || !SUBSET.test(url)) return "";
        const data = readFileSync(path.join(path.dirname(file), url)).toString("base64");
        return face.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${data})`);
      })
      .join("");
  }).join("");
  return css;
}
