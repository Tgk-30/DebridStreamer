// Selectable themes / skins.
//
// Each theme is a complete set of CSS-variable overrides applied to the document
// root via a `data-theme` attribute. The base values live in theme.css (the
// Aurora-glass dark default); a `[data-theme="…"]` block there retunes accent +
// background + glass tints for each alternative skin. This module is the pure
// SOURCE OF TRUTH for the theme list (ids, labels, swatch colors) plus the
// apply/persist logic — all unit-tested without a DOM.
//
// Adding a theme = add an entry here + a matching `[data-theme="id"]` block in
// theme.css. The default ("aurora") intentionally has NO override block so it
// renders identically to the historical look.

/** A selectable theme. `swatch*` drive the Settings preview card (no DOM read
 * needed to render the picker). */
export interface ThemeDef {
  id: string;
  label: string;
  description: string;
  /** Whether the OS color-scheme hint should be light (affects form controls). */
  light: boolean;
  /** Preview swatch: background gradient stops + accent dot. */
  swatchBg: [string, string];
  swatchAccent: string;
}

/** The shipped themes. Order = display order in the picker. */
export const THEMES: ThemeDef[] = [
  {
    id: "aurora",
    label: "Aurora",
    description: "The cinematic dark glass default.",
    light: false,
    swatchBg: ["#0d0f1a", "#171729"],
    swatchAccent: "rgb(140,133,250)",
  },
  {
    id: "light",
    label: "Daybreak",
    description: "Bright frosted glass for daylight.",
    light: true,
    swatchBg: ["#eef1f8", "#dfe4f2"],
    swatchAccent: "rgb(99,91,232)",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Near-black, low saturation, minimal glow.",
    light: false,
    swatchBg: ["#06070a", "#0c0d12"],
    swatchAccent: "rgb(120,176,224)",
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm amber-and-rose aurora.",
    light: false,
    swatchBg: ["#1c1014", "#241419"],
    swatchAccent: "rgb(250,138,92)",
  },
];

/** The default theme id (the historical Aurora-glass look). */
export const DEFAULT_THEME_ID = "aurora";

/** The Store key the chosen theme is persisted under (KV table; not a secret). */
export const THEME_SETTING_KEY = "ui_theme";

/** Whether `id` names a shipped theme. Pure. */
export function isValidThemeId(id: string | null | undefined): id is string {
  return id != null && THEMES.some((t) => t.id === id);
}

/** Resolve a raw stored value to a valid theme id, falling back to the default
 * for unknown/empty input. Pure. */
export function resolveThemeId(id: string | null | undefined): string {
  return isValidThemeId(id) ? id : DEFAULT_THEME_ID;
}

/** Look up a theme def by id (or the default). Pure. */
export function themeById(id: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === resolveThemeId(id)) ?? THEMES[0];
}

/** Apply a theme to a document root by setting `data-theme` (and the
 * `color-scheme` hint so native form controls match). The default theme removes
 * the attribute so the base theme.css values apply unchanged. DOM side effect
 * only — the id resolution is the pure `resolveThemeId`. Accepts any
 * `Element & { style }`-ish root so tests can pass a stub. */
export function applyTheme(
  id: string | null | undefined,
  root: {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    style: { setProperty(prop: string, value: string): void };
  },
): string {
  const resolved = resolveThemeId(id);
  const def = themeById(resolved);
  if (resolved === DEFAULT_THEME_ID) {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", resolved);
  }
  root.style.setProperty("color-scheme", def.light ? "light" : "dark");
  return resolved;
}
