import { readFileSync } from "node:fs";
import path from "node:path";
import { assetPath, FONT_STYLESHEETS, FONT_SUBSET } from "./assets";

let css: string | null = null;

/** Fontsource @font-face rules with the files inlined, since the PDF page has no network access. */
export function fontCss(): string {
  css ??= FONT_STYLESHEETS.map((stylesheet) => {
    const file = assetPath(stylesheet);
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(/@font-face\s*{[^}]*}/g)]
      .map(([face]) => {
        const url = /url\(\.\/(files\/[^)]+)\)/.exec(face)?.[1];
        if (!url || !FONT_SUBSET.test(url)) return "";
        const data = readFileSync(path.join(path.dirname(file), url)).toString("base64");
        return face.replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${data})`);
      })
      .join("");
  }).join("");
  return css;
}
