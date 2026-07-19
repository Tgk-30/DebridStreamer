// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { defaultSettings } from "../../data/settings";

const iconRender = vi.hoisted(() => vi.fn(() => null));

vi.mock("../../components/Icon", () => ({
  Icon: iconRender,
}));

import {
  AppearanceSettings,
  type AppearanceSettingsProps,
} from "./AppearanceSettings";

describe("AppearanceSettings memoization", () => {
  it("bails out for identical props and renders when the draft changes", () => {
    const props: AppearanceSettingsProps = {
      draft: defaultSettings(),
      serverMode: false,
      smartPreload: false,
      onApplyAppearance: vi.fn(),
      onSmartPreloadChange: vi.fn(),
      onReplayWelcomeGuide: vi.fn(),
      onReplayTierWelcome: vi.fn(),
    };
    const { rerender } = render(<AppearanceSettings {...props} />);
    const initialIconRenders = iconRender.mock.calls.length;
    expect(initialIconRenders).toBeGreaterThan(0);

    rerender(<AppearanceSettings {...props} />);
    expect(iconRender).toHaveBeenCalledTimes(initialIconRenders);

    const changedDraft = {
      ...props.draft,
      appearanceDensity:
        props.draft.appearanceDensity === "compact" ? "comfortable" : "compact",
    } as const;
    rerender(<AppearanceSettings {...props} draft={changedDraft} />);
    expect(iconRender.mock.calls.length).toBeGreaterThan(initialIconRenders);
  });
});
