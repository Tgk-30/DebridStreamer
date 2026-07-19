import { memo, type CSSProperties } from "react";
import type {
  AppSettings,
  AppearanceAccent,
  AppearanceBackdrop,
  AppearanceChrome,
  AppearanceDensity,
  AppearanceHeroScale,
  AppearanceMotion,
  AppearanceNavLabels,
  AppearanceNavPosition,
  AppearanceNavTint,
  AppearancePanelContrast,
  AppearancePosterSize,
  AppearanceRadius,
  AppearanceTextSize,
} from "../../data/settings";
import { Icon } from "../../components/Icon";
import { InfoTip } from "../../components/InfoTip";
import { SUBTITLE_COLORS } from "../../components/player/CaptionsMenu";
import {
  NAV_RAIL_GROUPS,
  NAV_RAIL_ITEMS,
  applyNavCustomization,
  isScreenHidden,
  type ScreenId,
} from "../../components/NavRail";
import { ACCENTS, THEMES } from "../../theme/themes";
import { Field, SegmentedControl } from "./SettingsControls";

interface AppearanceProfile {
  id: string;
  label: string;
  description: string;
  settings: Pick<
    AppSettings,
    | "theme"
    | "appearanceAccent"
    | "appearanceDensity"
    | "appearanceTextSize"
    | "appearanceMotion"
    | "appearanceRadius"
    | "appearanceBlur"
    | "appearanceChrome"
    | "appearanceBackdrop"
    | "appearanceHeroScale"
    | "appearancePanelContrast"
    | "appearanceNavLabels"
    | "appearanceNavTint"
    | "appearancePosterSize"
  >;
}

const APPEARANCE_PROFILES: AppearanceProfile[] = [
  {
    id: "default-cinema",
    label: "Midnight Studio",
    description: "Neutral dark surfaces that keep artwork in focus.",
    settings: {
      theme: "midnight",
      appearanceAccent: "cyan",
      appearanceDensity: "comfortable",
      appearanceTextSize: "m",
      appearanceMotion: "system",
      appearanceRadius: "default",
      appearanceBlur: 12,
      appearanceChrome: "solid",
      appearanceBackdrop: "subtle",
      appearanceHeroScale: "standard",
      appearancePanelContrast: "standard",
      appearanceNavLabels: "auto",
      appearanceNavTint: "balanced",
      appearancePosterSize: "default",
    },
  },
  {
    id: "compact-control",
    label: "Compact control",
    description: "Tighter panels for desktop remotes and dense libraries.",
    settings: {
      theme: "midnight",
      appearanceAccent: "cyan",
      appearanceDensity: "compact",
      appearanceTextSize: "s",
      appearanceMotion: "normal",
      appearanceRadius: "sharp",
      appearanceBlur: 12,
      appearanceChrome: "solid",
      appearanceBackdrop: "plain",
      appearanceHeroScale: "compact",
      appearancePanelContrast: "high",
      appearanceNavLabels: "icons",
      appearanceNavTint: "solid",
      appearancePosterSize: "compact",
    },
  },
  {
    id: "daylight-room",
    label: "Daylight room",
    description: "Bright Daybreak skin with larger text and softer corners.",
    settings: {
      theme: "light",
      appearanceAccent: "theme",
      appearanceDensity: "comfortable",
      appearanceTextSize: "l",
      appearanceMotion: "system",
      appearanceRadius: "round",
      appearanceBlur: 14,
      appearanceChrome: "balanced",
      appearanceBackdrop: "subtle",
      appearanceHeroScale: "cinematic",
      appearancePanelContrast: "standard",
      appearanceNavLabels: "labels",
      appearanceNavTint: "airy",
      appearancePosterSize: "large",
    },
  },
  {
    id: "warm-evening",
    label: "Warm Rose",
    description: "Amber and rose tones for a softer evening look.",
    settings: {
      theme: "sunset",
      appearanceAccent: "theme",
      appearanceDensity: "comfortable",
      appearanceTextSize: "m",
      appearanceMotion: "system",
      appearanceRadius: "round",
      appearanceBlur: 16,
      appearanceChrome: "balanced",
      appearanceBackdrop: "ambient",
      appearanceHeroScale: "cinematic",
      appearancePanelContrast: "standard",
      appearanceNavLabels: "labels",
      appearanceNavTint: "balanced",
      appearancePosterSize: "large",
    },
  },
  {
    id: "quiet-focus",
    label: "Quiet focus",
    description: "Low-glow dark mode with reduced motion and solid glass.",
    settings: {
      theme: "midnight",
      appearanceAccent: "theme",
      appearanceDensity: "comfortable",
      appearanceTextSize: "m",
      appearanceMotion: "reduced",
      appearanceRadius: "default",
      appearanceBlur: 10,
      appearanceChrome: "solid",
      appearanceBackdrop: "subtle",
      appearanceHeroScale: "standard",
      appearancePanelContrast: "soft",
      appearanceNavLabels: "auto",
      appearanceNavTint: "solid",
      appearancePosterSize: "default",
    },
  },
];

function appearanceProfileMatches(
  draft: AppSettings,
  profile: AppearanceProfile,
): boolean {
  const settings = profile.settings;
  return (
    draft.theme === settings.theme &&
    draft.appearanceAccent === settings.appearanceAccent &&
    draft.appearanceDensity === settings.appearanceDensity &&
    draft.appearanceTextSize === settings.appearanceTextSize &&
    draft.appearanceMotion === settings.appearanceMotion &&
    draft.appearanceRadius === settings.appearanceRadius &&
    draft.appearanceBlur === settings.appearanceBlur &&
    draft.appearanceChrome === settings.appearanceChrome &&
    draft.appearanceBackdrop === settings.appearanceBackdrop &&
    draft.appearanceHeroScale === settings.appearanceHeroScale &&
    draft.appearancePanelContrast === settings.appearancePanelContrast &&
    draft.appearanceNavLabels === settings.appearanceNavLabels &&
    draft.appearanceNavTint === settings.appearanceNavTint &&
    draft.appearancePosterSize === settings.appearancePosterSize
  );
}

/** Reorder + show/hide the navigation items. Reorder is scoped within each nav
 * group (moving an item never changes its group); "Settings" is always shown so
 * the user can never lock themselves out of this very screen. Hidden items stay
 * listed here (greyed) so they can be brought back. Changes apply live. */
function NavCustomizer({
  order,
  hidden,
  onChange,
  serverMode,
}: {
  order: readonly ScreenId[];
  hidden: readonly ScreenId[];
  onChange: (next: { order: ScreenId[]; hidden: ScreenId[] }) => void;
  serverMode: boolean;
}) {
  // Offer only items that exist in the current mode (drop server-only-unavailable
  // screens like Debrid/Downloads in Server Mode). simpleMode is left false so
  // power-user items can still be pre-arranged before switching to Advanced.
  const offered = NAV_RAIL_ITEMS.filter(
    (item) => !isScreenHidden(item.id, { serverMode, simpleMode: false }),
  );
  // Show every offered item in the user's current order (hidden ones included so
  // they can be un-hidden) - pass hidden:[] so nothing is filtered out here.
  const ordered = applyNavCustomization(offered, { order, hidden: [] });
  const hiddenSet = new Set(hidden);
  const groups = NAV_RAIL_GROUPS.filter((group) =>
    ordered.some((item) => item.group === group),
  );
  const isCustomized = order.length > 0 || hidden.length > 0;

  function move(id: ScreenId, dir: -1 | 1) {
    const flat = ordered.map((item) => item.id);
    const groupOf = (sid: ScreenId) =>
      ordered.find((item) => item.id === sid)?.group;
    const idx = flat.indexOf(id);
    const j = idx + dir;
    // Group items are contiguous, so an in-group neighbor is exactly idx +/- 1;
    // a cross-group neighbor means we're at a group edge - no move.
    if (j < 0 || j >= flat.length || groupOf(flat[idx]) !== groupOf(flat[j])) {
      return;
    }
    [flat[idx], flat[j]] = [flat[j], flat[idx]];
    onChange({ order: flat, hidden: [...hidden] });
  }

  function toggleHidden(id: ScreenId) {
    if (id === "settings") return;
    const next = hiddenSet.has(id)
      ? hidden.filter((h) => h !== id)
      : [...hidden, id];
    onChange({ order: [...order], hidden: next });
  }

  return (
    <div className="settings-navcustom">
      <div className="settings-navcustom-head">
        <span className="settings-label-line">
          <span className="settings-sources-title">Menu items</span>
          <InfoTip label="About menu items">
            Reorder items within a section or hide the ones you do not use.
            Settings always stays visible.
          </InfoTip>
        </span>
        <button
          type="button"
          className="settings-navcustom-reset"
          disabled={!isCustomized}
          onClick={() => onChange({ order: [], hidden: [] })}
        >
          Reset
        </button>
      </div>

      {groups.map((group) => {
        const groupItems = ordered.filter((item) => item.group === group);
        return (
          <div className="settings-navcustom-group" key={group}>
            <div className="settings-navcustom-group-label">{group}</div>
            {groupItems.map((item, indexInGroup) => {
              const isHidden = hiddenSet.has(item.id);
              const locked = item.id === "settings";
              return (
                <div
                  className={`settings-navcustom-row${isHidden ? " is-hidden" : ""}`}
                  key={item.id}
                >
                  <span className="settings-navcustom-icon" aria-hidden>
                    <Icon name={item.icon} size={17} />
                  </span>
                  <span className="settings-navcustom-name">{item.label}</span>
                  {locked && (
                    <span className="settings-navcustom-lock">Always shown</span>
                  )}
                  <div className="settings-navcustom-actions">
                    <button
                      type="button"
                      className="settings-navcustom-move"
                      onClick={() => move(item.id, -1)}
                      disabled={indexInGroup === 0}
                      aria-label={`Move ${item.label} up`}
                    >
                      <span aria-hidden>↑</span>
                    </button>
                    <button
                      type="button"
                      className="settings-navcustom-move"
                      onClick={() => move(item.id, 1)}
                      disabled={indexInGroup === groupItems.length - 1}
                      aria-label={`Move ${item.label} down`}
                    >
                      <span aria-hidden>↓</span>
                    </button>
                    <button
                      type="button"
                      className="settings-navcustom-toggle"
                      onClick={() => toggleHidden(item.id)}
                      disabled={locked}
                      aria-pressed={!isHidden}
                      aria-label={
                        isHidden ? `Show ${item.label}` : `Hide ${item.label}`
                      }
                      title={isHidden ? "Show" : "Hide"}
                    >
                      <Icon name={isHidden ? "eye-off" : "eye"} size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export interface AppearanceSettingsProps {
  draft: AppSettings;
  serverMode: boolean;
  smartPreload: boolean;
  onApplyAppearance: (next: Partial<AppSettings>) => void;
  onSmartPreloadChange: (enabled: boolean) => void;
  onReplayWelcomeGuide: () => void;
  onReplayTierWelcome: () => void;
}

export const AppearanceSettings = memo(function AppearanceSettings({
  draft,
  serverMode,
  smartPreload,
  onApplyAppearance: applyAppearance,
  onSmartPreloadChange,
  onReplayWelcomeGuide,
  onReplayTierWelcome,
}: AppearanceSettingsProps) {
  const selectedProfile =
    APPEARANCE_PROFILES.find((profile) => appearanceProfileMatches(draft, profile)) ??
    null;

  return (
    <div className="settings-fields">
      <div className="appearance-intro">
        <div>
          <span className="settings-sources-title">Choose a style</span>
          <p className="settings-hint">
            Start with a complete look. Changes apply instantly to this profile.
          </p>
        </div>
        <span className="appearance-saved-state">
          {selectedProfile?.label ?? "Custom style"}
        </span>
      </div>

      <div className="appearance-style-grid" aria-label="Appearance styles">
        {APPEARANCE_PROFILES.map((profile) => {
          const active = profile.id === selectedProfile?.id;
          const theme = THEMES.find((item) => item.id === profile.settings.theme) ?? THEMES[0];
          return (
            <button
              key={profile.id}
              type="button"
              className={`appearance-style-card${active ? " is-active" : ""}`}
              onClick={() => applyAppearance(profile.settings)}
              aria-pressed={active}
              aria-label={`Apply ${profile.label} style`}
            >
              <span
                className="appearance-style-preview"
                style={{
                  background: `linear-gradient(145deg, ${theme.swatchBg[0]}, ${theme.swatchBg[1]})`,
                }}
              >
                <span style={{ background: theme.swatchAccent }} />
                <i />
                <i />
              </span>
              <span className="appearance-style-copy">
                <strong>{profile.label}</strong>
                <small>{profile.description}</small>
              </span>
              {profile.id === "default-cinema" && (
                <span className="appearance-style-default">Default</span>
              )}
              {active && <Icon name="check" size={15} />}
            </button>
          );
        })}
      </div>

      <div className="appearance-section-head">
        <span className="settings-sources-title">Everyday controls</span>
        <span className="settings-hint">The options most people adjust</span>
      </div>

      <div className="settings-control-grid">
        <SegmentedControl
          label="Density"
          value={draft.appearanceDensity}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceDensity: value as AppearanceDensity })
          }
        />
        <SegmentedControl
          label="Text size"
          value={draft.appearanceTextSize}
          options={[
            { value: "s", label: "S" },
            { value: "m", label: "M" },
            { value: "l", label: "L" },
            { value: "xl", label: "XL" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceTextSize: value as AppearanceTextSize })
          }
        />
        <SegmentedControl
          label="Corners"
          value={draft.appearanceRadius}
          options={[
            { value: "sharp", label: "Sharp" },
            { value: "default", label: "Default" },
            { value: "round", label: "Round" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceRadius: value as AppearanceRadius })
          }
        />
        <SegmentedControl
          label="Backdrop"
          value={draft.appearanceBackdrop}
          options={[
            { value: "ambient", label: "Ambient" },
            { value: "subtle", label: "Subtle" },
            { value: "plain", label: "Plain" },
          ]}
          onChange={(value) =>
            applyAppearance({ appearanceBackdrop: value as AppearanceBackdrop })
          }
        />
      </div>

      <div className="appearance-accent-panel">
        <div className="settings-sources-head">
          <span className="settings-sources-title">Accent</span>
          <span className="settings-hint t-secondary">Used for selection and focus</span>
        </div>
        <div className="accent-grid" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((accent) => {
            const active = draft.appearanceAccent === accent.id;
            return (
              <button
                key={accent.id}
                type="button"
                className={`accent-swatch${active ? " is-active" : ""}`}
                style={{ "--accent-preview": accent.color } as CSSProperties}
                onClick={() =>
                  applyAppearance({ appearanceAccent: accent.id as AppearanceAccent })
                }
                role="radio"
                aria-checked={active}
                aria-label={`${accent.label} accent`}
              >
                <span />
                {accent.label}
              </button>
            );
          })}
        </div>
      </div>

      <Field
        label="Glass blur"
        hint="Lower values keep panels crisp. Higher values add frost."
      >
        <div className="settings-range-shell">
          <div className="settings-range-control">
            <input
              type="range"
              min={6}
              max={28}
              step={2}
              value={draft.appearanceBlur}
              onChange={(event) =>
                applyAppearance({ appearanceBlur: Number(event.target.value) })
              }
              aria-label="Glass blur"
            />
            <output aria-live="polite">{draft.appearanceBlur}px</output>
          </div>
          <div className="settings-range-labels" aria-hidden="true">
            <span>Solid</span>
            <span>Frosted</span>
          </div>
        </div>
      </Field>

      <details className="appearance-disclosure">
        <summary>
          <span>
            <strong>Layout and navigation</strong>
            <small>Motion, panels, artwork sizing, and menu setup</small>
          </span>
          <span className="appearance-disclosure-chevron" aria-hidden>⌄</span>
        </summary>
        <div className="appearance-disclosure-body">
          <div className="settings-control-grid">
            <SegmentedControl
              label="Motion"
              value={draft.appearanceMotion}
              options={[
                { value: "system", label: "System" },
                { value: "normal", label: "Normal" },
                { value: "reduced", label: "Reduced" },
              ]}
              onChange={(value) => applyAppearance({ appearanceMotion: value as AppearanceMotion })}
            />
            <SegmentedControl
              label="Panel depth"
              value={draft.appearanceChrome}
              options={[
                { value: "translucent", label: "Light" },
                { value: "balanced", label: "Balanced" },
                { value: "solid", label: "Solid" },
              ]}
              onChange={(value) => applyAppearance({ appearanceChrome: value as AppearanceChrome })}
            />
            <SegmentedControl
              label="Hero size"
              value={draft.appearanceHeroScale}
              options={[
                { value: "compact", label: "Compact" },
                { value: "standard", label: "Standard" },
                { value: "cinematic", label: "Cinema" },
              ]}
              onChange={(value) => applyAppearance({ appearanceHeroScale: value as AppearanceHeroScale })}
            />
            <SegmentedControl
              label="Panel contrast"
              value={draft.appearancePanelContrast}
              options={[
                { value: "soft", label: "Soft" },
                { value: "standard", label: "Standard" },
                { value: "high", label: "High" },
              ]}
              onChange={(value) => applyAppearance({ appearancePanelContrast: value as AppearancePanelContrast })}
            />
            <SegmentedControl
              label="Nav labels"
              value={draft.appearanceNavLabels}
              options={[
                { value: "auto", label: "Auto" },
                { value: "labels", label: "Labels" },
                { value: "icons", label: "Icons" },
              ]}
              onChange={(value) => applyAppearance({ appearanceNavLabels: value as AppearanceNavLabels })}
            />
            <SegmentedControl
              label="Nav position"
              value={draft.appearanceNavPosition}
              options={[
                { value: "side", label: "Side rail" },
                { value: "bottom", label: "Bottom bar" },
              ]}
              onChange={(value) => applyAppearance({ appearanceNavPosition: value as AppearanceNavPosition })}
            />
            <SegmentedControl
              label="Nav surface"
              value={draft.appearanceNavTint}
              options={[
                { value: "airy", label: "Airy" },
                { value: "balanced", label: "Balanced" },
                { value: "solid", label: "Solid" },
              ]}
              onChange={(value) => applyAppearance({ appearanceNavTint: value as AppearanceNavTint })}
            />
            <SegmentedControl
              label="Poster size"
              value={draft.appearancePosterSize}
              options={[
                { value: "compact", label: "Compact" },
                { value: "default", label: "Default" },
                { value: "large", label: "Large" },
              ]}
              onChange={(value) => applyAppearance({ appearancePosterSize: value as AppearancePosterSize })}
            />
          </div>

          <label className="settings-field">
            <span className="settings-field-label">
              <strong>Start on</strong>
              <span className="t-secondary">: the screen shown at launch.</span>
            </span>
            <select
              aria-label="Start screen"
              value={draft.appearanceDefaultTab}
              onChange={(event) => applyAppearance({ appearanceDefaultTab: event.target.value as ScreenId })}
            >
              <option value="discover">Discover</option>
              <option value="search">Search</option>
              <option value="library">Library</option>
              <option value="watchlist">Watchlist</option>
              <option value="calendar">Calendar</option>
              <option value="history">History</option>
            </select>
          </label>

          <NavCustomizer
            order={draft.appearanceNavOrder}
            hidden={draft.appearanceNavHidden}
            serverMode={serverMode}
            onChange={(next) => applyAppearance({ appearanceNavOrder: next.order, appearanceNavHidden: next.hidden })}
          />
        </div>
      </details>

      <details className="appearance-disclosure">
        <summary>
          <span>
            <strong>Subtitles</strong>
            <small>Size, color, and background contrast</small>
          </span>
          <span className="appearance-disclosure-chevron" aria-hidden>⌄</span>
        </summary>
        <div className="appearance-disclosure-body">
          <Field label="Font scale" hint="Adjust subtitle text size in the player.">
            <div className="settings-range-shell">
              <div className="settings-range-control">
                <input type="range" min={0.7} max={1.8} step={0.1} value={draft.subtitleFontScale} onChange={(event) => applyAppearance({ subtitleFontScale: Number(event.target.value) })} aria-label="Subtitle font scale" />
                <output aria-live="polite">{Math.round(draft.subtitleFontScale * 100)}%</output>
              </div>
              <div className="settings-range-labels" aria-hidden="true"><span>Smaller</span><span>Larger</span></div>
            </div>
          </Field>

          <div className="settings-source glass-rest">
            <div className="settings-sources-head">
              <span className="settings-sources-title">Text color</span>
              <span className="settings-hint t-secondary">High contrast presets</span>
            </div>
            <div className="accent-grid" role="radiogroup" aria-label="Subtitle text color">
              {SUBTITLE_COLORS.map((color) => {
                const active = draft.subtitleTextColor === color;
                return <button key={color} type="button" className={`accent-swatch${active ? " is-active" : ""}`} style={{ background: color }} onClick={() => applyAppearance({ subtitleTextColor: color })} role="radio" aria-checked={active} aria-label={`Subtitle color ${color}`} />;
              })}
            </div>
          </div>

          <Field label="Background opacity" hint="Add contrast when the video is bright.">
            <div className="settings-range-shell">
              <div className="settings-range-control">
                <input type="range" min={0} max={0.95} step={0.05} value={draft.subtitleBgOpacity} onChange={(event) => applyAppearance({ subtitleBgOpacity: Number(event.target.value) })} aria-label="Subtitle background opacity" />
                <output aria-live="polite">{Math.round(draft.subtitleBgOpacity * 100)}%</output>
              </div>
              <div className="settings-range-labels" aria-hidden="true"><span>None</span><span>Solid</span></div>
            </div>
          </Field>
        </div>
      </details>

      <details className="appearance-disclosure">
        <summary>
          <span><strong>Extras</strong><small>Preloading, stats, ratings, and guides</small></span>
          <span className="appearance-disclosure-chevron" aria-hidden>⌄</span>
        </summary>
        <div className="appearance-disclosure-body settings-extras">
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={smartPreload}
            onChange={(e) => onSmartPreloadChange(e.target.checked)}
          />
          <span>
            <strong>Smart preloading</strong>
            <InfoTip label="About Smart preloading">
              Quietly warms upcoming screens and images so the app feels instant.
              Turn off on a metered connection to save data.
            </InfoTip>
          </span>
        </label>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={draft.showWatchStats}
            onChange={(e) => applyAppearance({ showWatchStats: e.target.checked })}
          />
          <span>
            <strong>Show watch stats</strong>
            <InfoTip label="About watch stats">
              Adds a personal insights card (time watched, completion, streak,
              favourite genres) to the top of the History screen.
            </InfoTip>
          </span>
        </label>
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={draft.showPosterRatings}
            onChange={(e) => applyAppearance({ showPosterRatings: e.target.checked })}
          />
          <span>
            <strong>Show ratings on posters</strong>
            <InfoTip label="About poster ratings">
              Keeps the TMDB score visible in a poster corner while you browse.
            </InfoTip>
          </span>
        </label>
        <button
          type="button"
          className="btn settings-replay-tour"
          onClick={onReplayWelcomeGuide}
        >
          <Icon name="discover" size={15} />
          Replay welcome guide
        </button>
        <button
          type="button"
          className="btn settings-replay-tour"
          onClick={onReplayTierWelcome}
        >
          <Icon name="discover" size={15} />
          Replay getting-started
        </button>
        </div>
      </details>
    </div>
  );
});
