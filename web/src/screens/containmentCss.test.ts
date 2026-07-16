import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

describe("long-list containment CSS", () => {
  it("puts Discover visibility containment on rail sections", () => {
    const source = css("Discover.css");
    expect(source).toMatch(
      /\.discover-body > \.rail\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 390px;/s,
    );
  });

  it("limits Settings and Library containment to independently repeated rows", () => {
    const settings = css("Settings.css");
    for (const [selector, height] of [
      ["settings-source", "170px"],
      ["settings-profile-card", "250px"],
      ["settings-usage-row", "44px"],
    ]) {
      expect(settings).toMatch(
        new RegExp(
          `\\.${selector}\\s*\\{[^}]*content-visibility:\\s*auto;[^}]*contain-intrinsic-size:\\s*auto ${height};`,
          "s",
        ),
      );
    }
    expect(css("LibraryScreens.css")).toMatch(
      /\.lib-org-row\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:\s*auto 90px;/s,
    );
  });
});
