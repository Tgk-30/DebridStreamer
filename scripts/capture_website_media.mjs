#!/usr/bin/env node
// Capture REAL app screenshots for website/media at the QA-pinned dimensions.
// Requirements: a vite dev server for web/ (default http://localhost:5199),
// `npm i playwright-core` + `npx playwright-core install chromium`
// (set PLAYWRIGHT_BROWSERS_PATH), and TMDB_KEY in the environment (the walk
// completes the real onboarding with it so Discover shows live artwork).
// Compress results into website/media with: pngquant --quality 65-90 --speed 1
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const OUT = new URL("./media-raw/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const TMDB_KEY = process.env.TMDB_KEY ?? "";
if (!TMDB_KEY) throw new Error("TMDB_KEY missing");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 848 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 120)));
await page.goto("http://localhost:5199/", { waitUntil: "domcontentloaded" });

async function clickText(text) {
  await page
    .locator("button", { hasText: text })
    .first()
    .click({ timeout: 15000 });
}

// Tier welcome → wizard device path with the real TMDB key → add-later.
await page.waitForSelector("text=Welcome to DebridStreamer", { timeout: 20000 });
await clickText("Skip");
await page.waitForSelector("text=How do you want to use DebridStreamer?");
await clickText("Just watch on this device");
await page.waitForSelector("text=Power up search");
await page.fill('.first-run-field input', TMDB_KEY);
await clickText("Test key & continue");
await page.waitForSelector("text=Connect your debrid service", { timeout: 20000 });
await clickText("Add later");
// Welcome tour → skip; setup nudge → dismiss.
await page.waitForSelector('[aria-label="Skip the tour"]', { timeout: 20000 });
await page.evaluate(() =>
  document.querySelector('[aria-label="Skip the tour"]').click(),
);
await page.waitForSelector(".setup-nudge-dismiss", { timeout: 20000 });
await page.evaluate(() => document.querySelector(".setup-nudge-dismiss").click());

// Let Discover hydrate with real TMDB artwork (poster rows + hero backdrop).
await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
await sleep(9000);
const imgStats = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll("img")];
  return {
    total: imgs.length,
    tmdb: imgs.filter((i) => i.src.includes("image.tmdb.org")).length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
  };
});
console.log("discover imgs:", JSON.stringify(imgStats));
await page.mouse.move(4, 840); // park the cursor away from hover targets
await sleep(400);
await page.screenshot({ path: `${OUT}discover-desktop.png` });
console.log("shot: discover-desktop");

// Tablet Discover - same state, narrower viewport.
await page.setViewportSize({ width: 768, height: 1196 });
await sleep(2500);
await page.screenshot({ path: `${OUT}discover-tablet.png` });
console.log("shot: discover-tablet");

// Mobile Settings.
await page.setViewportSize({ width: 390, height: 792 });
await sleep(1500);
const navText = await page.evaluate(() =>
  [...document.querySelectorAll("nav a, nav button, .nav-rail button, .nav-rail a")]
    .map((n) => n.textContent.trim())
    .filter(Boolean)
    .slice(0, 12),
);
console.log("nav items:", JSON.stringify(navText));
// Settings usually lives under "More" on phones.
const opened = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll("button, a")];
  const more = nodes.find((n) => (n.textContent ?? "").trim() === "More");
  if (more) {
    more.click();
    return "more";
  }
  const settings = nodes.find((n) => (n.textContent ?? "").trim() === "Settings");
  if (settings) {
    settings.click();
    return "settings";
  }
  return "none";
});
console.log("opened:", opened);
await sleep(900);
if (opened === "more") {
  await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("button, a")];
    const settings = nodes.find((n) => (n.textContent ?? "").includes("Settings"));
    if (settings) settings.click();
  });
  await sleep(1200);
}
console.log(
  "on settings:",
  await page.evaluate(() => document.body.innerText.includes("Appearance") || document.body.innerText.includes("Keys")),
);
await sleep(1200);
await page.screenshot({ path: `${OUT}settings-mobile.png` });
console.log("shot: settings-mobile");

await browser.close();
console.log("CAPTURE DONE");
