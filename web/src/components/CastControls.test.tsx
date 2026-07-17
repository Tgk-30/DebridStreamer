// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CastControls, CastDevicePicker } from "./CastControls";
import type { CastDevice } from "../lib/tauri";

const devices: CastDevice[] = [
  {
    id: "uuid:living-room",
    name: "Living Room TV",
    avControlUrl: "http://10.0.0.10/av",
    renderingControlUrl: "http://10.0.0.10/volume",
    location: "http://10.0.0.10/device.xml",
  },
  {
    id: "uuid:bedroom",
    name: "Bedroom Kodi",
    avControlUrl: "http://10.0.0.11/av",
    renderingControlUrl: null,
    location: "http://10.0.0.11/device.xml",
  },
];

describe("CastDevicePicker", () => {
  it("lists discovered devices and selects the chosen renderer", () => {
    const onSelect = vi.fn();
    render(
      <CastDevicePicker
        phase="selecting"
        devices={devices}
        device={null}
        error={null}
        onSelect={onSelect}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Living Room TV")).toBeInTheDocument();
    expect(screen.getByText("Bedroom Kodi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Bedroom Kodi/ }));
    expect(onSelect).toHaveBeenCalledWith(devices[1]);
  });

  it("shows the empty state and retries discovery", () => {
    const onRetry = vi.fn();
    render(
      <CastDevicePicker
        phase="selecting"
        devices={[]}
        device={null}
        error={null}
        onSelect={() => {}}
        onRetry={onRetry}
        onClose={() => {}}
      />,
    );

    expect(
      screen.getByText("No cast devices found on your network"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("CastControls desktop gate", () => {
  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("hides in browsers and appears in the Tauri desktop shell", () => {
    const media = { url: "https://cdn.example/movie.mkv", title: "Movie" };
    const { rerender } = render(
      <CastControls media={media} buttonClassName="cast-test-button" />,
    );
    expect(
      screen.queryByRole("button", { name: "Cast to a device" }),
    ).toBeNull();

    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    rerender(
      <CastControls media={media} buttonClassName="cast-test-button" />,
    );
    expect(
      screen.getByRole("button", { name: "Cast to a device" }),
    ).toBeInTheDocument();
  });
});
