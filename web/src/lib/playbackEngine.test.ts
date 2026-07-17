import { describe, expect, it } from "vitest";
import { PLAYBACK_ENGINE_LABEL, viewportPixelSize } from "./playbackEngine";

describe("playback engine diagnostics", () => {
  it("keeps the three user-visible engine labels explicit", () => {
    expect(PLAYBACK_ENGINE_LABEL).toEqual({
      "webview-hls-transcode": "Webview HLS transcode",
      "webview-direct": "Webview direct",
      "native-mpv": "Native mpv",
    });
  });

  it("reports the backing-pixel display size", () => {
    expect(viewportPixelSize(1000.5, 695.5, 2)).toEqual({
      width: 2001,
      height: 1391,
    });
  });

  it("rejects invalid display geometry", () => {
    expect(viewportPixelSize(0, 700, 2)).toBeNull();
    expect(viewportPixelSize(1000, Number.NaN, 2)).toBeNull();
    expect(viewportPixelSize(1000, 700, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

