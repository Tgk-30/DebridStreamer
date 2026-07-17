// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { useWakeLock } from "./useWakeLock";

function WakeLockProbe({ active }: { active: boolean }) {
  useWakeLock(active);
  return null;
}

function replaceProperty<T extends object, K extends PropertyKey>(
  target: T,
  key: K,
  value: unknown,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });
  return () => {
    if (descriptor != null) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<PropertyKey, unknown>)[key];
  };
}

afterEach(() => vi.restoreAllMocks());

describe("useWakeLock", () => {
  it("releases when playback stops and reacquires after a hidden tab becomes visible", async () => {
    let firstReleased = false;
    const firstSentinel = new EventTarget() as WakeLockSentinel;
    Object.defineProperties(firstSentinel, {
      released: { get: () => firstReleased },
      release: {
        value: vi.fn(async () => {
          firstReleased = true;
        }),
      },
    });
    const secondSentinel = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(async () => {}),
    }) as unknown as WakeLockSentinel;
    const request = vi.fn()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    const restoreWakeLock = replaceProperty(navigator, "wakeLock", { request });
    let visibility: DocumentVisibilityState = "visible";
    const restoreVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    try {
      const { rerender } = render(<WakeLockProbe active />);
      await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

      // Browsers release the sentinel while hidden. Simulate that automatic
      // release, then ensure the visibility listener requests a fresh one.
      visibility = "hidden";
      firstReleased = true;
      firstSentinel.dispatchEvent(new Event("release"));
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      expect(request).toHaveBeenCalledTimes(1);

      visibility = "visible";
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

      rerender(<WakeLockProbe active={false} />);
      await waitFor(() => expect(secondSentinel.release).toHaveBeenCalledTimes(1));
    } finally {
      restoreWakeLock();
      if (restoreVisibility != null) {
        Object.defineProperty(document, "visibilityState", restoreVisibility);
      } else {
        delete (document as unknown as Record<string, unknown>).visibilityState;
      }
    }
  });

  it("is a no-op when the Wake Lock API is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    try {
      render(<WakeLockProbe active />);
    } finally {
      if (descriptor != null) Object.defineProperty(navigator, "wakeLock", descriptor);
    }
  });
});
