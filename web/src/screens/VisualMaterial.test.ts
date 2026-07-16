import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("overlay material regressions", () => {
  it("keeps Detail's aurora layers over an opaque base without a backdrop filter", () => {
    const css = readFileSync("src/screens/Detail.css", "utf8");
    const detailRule = css.match(/\.detail\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(css).toMatch(
      /\.detail\s*\{[\s\S]*?radial-gradient\([\s\S]*?radial-gradient\([\s\S]*?var\(--bg-1\);/,
    );
    expect(detailRule).not.toMatch(/^\s*(?:-webkit-)?backdrop-filter\s*:/m);
  });

  it("keeps Browse deep enough to conceal its covered screen while retaining blur", () => {
    const css = readFileSync("src/screens/Browse.css", "utf8");
    expect(css).toMatch(
      /\.browse::before\s*\{[\s\S]*?var\(--bg-1\) 90%[\s\S]*?var\(--bg-1\) 96%[\s\S]*?backdrop-filter:\s*blur\(20px\)/,
    );
  });

  it("uses an opaque captions popover over live video", () => {
    const css = readFileSync("src/components/VideoPlayer.css", "utf8");
    expect(css).toMatch(
      /\.captions-menu\s*\{[^}]*background:\s*rgba\(12, 14, 22, 1\);/s,
    );
  });

  it("keeps clean-save status legible and the profiles checkbox aligned with other toggles", () => {
    const css = readFileSync("src/screens/Settings.css", "utf8");
    expect(css).toMatch(
      /\.settings-footer\.is-clean \.btn\.btn-prominent:disabled\s*\{[^}]*opacity:\s*1;[^}]*color:\s*var\(--text-primary\);/s,
    );
    expect(css).toMatch(
      /\.settings-profiles \.settings-toggle-row\s*\{[^}]*justify-content:\s*flex-start;/s,
    );
  });
});
