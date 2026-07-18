#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const checks = [];

function check(label, condition, fix) {
  checks.push({ label, condition, fix });
}

const appCss = read("web/src/App.css");
const navCss = read("web/src/components/NavRail.css");
const heroCss = read("web/src/components/HeroSpotlight.css");
const moodCss = read("web/src/components/MoodStrip.css");
const settingsCss = read("web/src/screens/Settings.css");
const setupCredentials = read("web/src/lib/serverSetupCredentials.ts");
const setupInvite = read("web/src/lib/serverSetupInvite.ts");
const serverSetupWizard = read("web/src/components/ServerSetupWizard.tsx");
const ciWorkflow = read(".github/workflows/ci.yml");

check(
  "mobile app viewport reserves bottom navigation space",
  /--mobile-nav-reserve:\s*calc\(var\(--mobile-nav-height\)\s*\+\s*var\(--mobile-nav-bottom\)\s*\+\s*30px\)/.test(appCss) &&
    /padding-bottom:\s*var\(--mobile-nav-reserve\)/.test(appCss) &&
    /scroll-padding-bottom:\s*var\(--mobile-nav-reserve\)/.test(appCss),
  "web/src/App.css must reserve scroll and content space for the floating bottom nav.",
);

check(
  "bottom nav has fixed five-slot geometry on phones",
  /@media\s*\(max-width:\s*699px\)[\s\S]*\.nav-rail\s*\{[\s\S]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/.test(navCss) &&
    /width:\s*min\(428px,\s*calc\(100vw - 20px\)\)/.test(navCss) &&
    /height:\s*var\(--mobile-nav-height\)/.test(navCss),
  "web/src/components/NavRail.css must keep the mobile nav as a stable five-slot grid.",
);

check(
  "bottom nav accounts for iOS safe areas",
  /bottom:\s*var\(--mobile-nav-bottom\)/.test(navCss) &&
    /env\(safe-area-inset-bottom\)/.test(appCss),
  "The floating nav must use the shared safe-area-aware bottom offset.",
);

check(
  "bottom nav labels cannot resize the layout",
  /text-overflow:\s*ellipsis/.test(navCss) &&
    /white-space:\s*nowrap/.test(navCss) &&
    /data-mobile-label/.test(navCss),
  "Mobile nav labels must use compact labels, no wrapping, and ellipsis.",
);

check(
  "mobile more sheet is constrained to the viewport",
  /max-height:\s*min\(430px,\s*calc\(100dvh - var\(--mobile-nav-height\) - var\(--mobile-nav-bottom\) - 42px\)\)/.test(navCss) &&
    /overflow-y:\s*auto/.test(navCss),
  "The mobile More sheet must be viewport-constrained and scrollable.",
);

check(
  "hero remains visible when window animations are suspended",
  /:root\[data-suspended\][\s\S]*:root\[data-unfocused\][\s\S]*\.hero-backdrop-layer[\s\S]*animation:\s*none\s*!important[\s\S]*opacity:\s*1\s*!important/.test(heroCss) &&
    /:root\[data-input-idle\][\s\S]*\.hero-content[\s\S]*animation:\s*none\s*!important[\s\S]*opacity:\s*1\s*!important/.test(heroCss),
  "HeroSpotlight.css must settle animated hero layers into a visible state when the window is suspended, unfocused, or idle.",
);

check(
  "Describe a vibe panel has phone and tablet responsive layouts",
  /@media\s*\(max-width:\s*560px\)/.test(moodCss) &&
    /@media\s*\(min-width:\s*561px\)\s*and\s*\(max-width:\s*920px\)/.test(moodCss) &&
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(moodCss) &&
    /overflow-x:\s*auto/.test(moodCss),
  "MoodStrip.css must handle compact phones, short phones, and tablet-width layouts.",
);

check(
  "settings collapses option cards into a native selector on mobile",
  /\.settings-mobile-picker\s*\{[\s\S]*display:\s*none/.test(settingsCss) &&
    /@media\s*\(max-width:\s*560px\)[\s\S]*\.settings-mobile-picker\s*\{[\s\S]*display:\s*flex/.test(settingsCss) &&
    /\.settings-subsection-picker\.is-option-only \.settings-option-strip\s*\{[\s\S]*display:\s*none/.test(settingsCss),
  "Settings mobile layouts must show the selector and hide dense option-card strips.",
);

check(
  "setup wizard debrid selector defaults to first provider",
  /export const DEFAULT_DEBRID_PROVIDER\s*=\s*DEBRID_PROVIDER_OPTIONS\[0\]\.provider/.test(setupCredentials) &&
    /provider:\s*"real_debrid"/.test(setupCredentials),
  "Server setup credentials must default to the first debrid provider option.",
);

check(
  "setup wizard invite preset defaults to first selector option",
  /DEFAULT_SERVER_SETUP_INVITE_PRESET_ID\s*=\s*SERVER_SETUP_INVITE_PRESETS\[0\]\.id/.test(setupInvite) &&
    /id:\s*"family_simple"/.test(setupInvite),
  "Server setup invite presets must default to the first option.",
);

check(
  "setup wizard uses selectors instead of first-field freeform traps",
  /DEBRID_PROVIDER_OPTIONS\.map/.test(serverSetupWizard) &&
    /SERVER_SETUP_INVITE_PRESETS\.map/.test(serverSetupWizard) &&
    /<select/.test(serverSetupWizard),
  "ServerSetupWizard.tsx must render provider and invite preset selectors.",
);

check(
  "CI runs app responsive contract",
  /check_app_responsive_contract\.mjs/.test(ciWorkflow),
  ".github/workflows/ci.yml must run this checker.",
);

const failures = checks.filter((entry) => !entry.condition);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`fail ${failure.label}`);
    console.error(`     ${failure.fix}`);
  }
  process.exit(1);
}

for (const entry of checks) {
  console.log(`ok   ${entry.label}`);
}
console.log("\nApp responsive contract checks passed.");
