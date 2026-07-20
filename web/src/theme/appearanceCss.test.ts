import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function cssFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    return statSync(path).isDirectory()
      ? cssFiles(path)
      : path.endsWith(".css")
        ? [path]
        : [];
  });
}

const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const css = cssFiles(sourceRoot)
  .map((path) => `${path}\n${readFileSync(path, "utf8")}`)
  .join("\n");

describe("appearance CSS controls", () => {
  it("routes fixed font sizes through rem or the text-scale variable", () => {
    const declarations = css.match(/font-size\s*:[^;{}]+;/g) ?? [];
    const unscaled = declarations.filter(
      (value) => /\b\d+(?:\.\d+)?px\b/.test(value) && !value.includes("--text-scale"),
    );
    expect(unscaled).toEqual([]);
  });

  it("routes fixed spacing through the density-scale variable", () => {
    const declarations = css.match(
      /(?:padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|gap|row-gap|column-gap)\s*:[^;{}]+;/g,
    ) ?? [];
    const unscaled = declarations.filter(
      (value) => /\b-?\d+(?:\.\d+)?px\b/.test(value) && !value.includes("--density-scale"),
    );
    expect(unscaled).toEqual([]);
  });

  it("routes fixed corner radii through the radius-scale variable", () => {
    const declarations = css.match(/border-radius\s*:[^;{}]+;/g) ?? [];
    const unscaled = declarations.filter(
      (value) => /\b\d+(?:\.\d+)?px\b/.test(value) && !value.includes("--radius-scale"),
    );
    expect(unscaled).toEqual([]);
  });

  it("allows an explicit normal-motion choice to override the OS preference", () => {
    const theme = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    expect(theme).toContain(':root:not([data-motion="normal"]) *');
    expect(theme).toContain(':root[data-motion="reduced"] *');
  });
});
