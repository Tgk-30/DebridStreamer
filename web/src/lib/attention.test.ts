// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_MS,
  getAttentionParked,
  installAttentionGate,
  setIdleGateSuppressed,
  subscribeAttention,
} from "./attention";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: () => true,
  });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  setIdleGateSuppressed(false);
  delete document.documentElement.dataset.unfocused;
  delete document.documentElement.dataset.inputIdle;
  vi.useRealTimers();
});

describe("installAttentionGate", () => {
  it("parks and wakes the visible but unfocused window", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAttention(listener);
    cleanup = installAttentionGate();

    window.dispatchEvent(new Event("blur"));
    expect(document.documentElement).toHaveAttribute("data-unfocused");
    expect(getAttentionParked()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    expect(document.documentElement).not.toHaveAttribute("data-unfocused");
    expect(getAttentionParked()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("idles after five minutes and throttles pointer-move timer resets", () => {
    cleanup = installAttentionGate();

    vi.advanceTimersByTime(IDLE_MS);
    expect(document.documentElement).toHaveAttribute("data-input-idle");

    window.dispatchEvent(new Event("pointermove"));
    expect(document.documentElement).not.toHaveAttribute("data-input-idle");

    vi.advanceTimersByTime(500);
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(IDLE_MS - 500);
    expect(document.documentElement).toHaveAttribute("data-input-idle");
  });

  it("does not idle while a mounted player suppresses the idle gate", () => {
    cleanup = installAttentionGate();
    setIdleGateSuppressed(true);

    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(document.documentElement).not.toHaveAttribute("data-input-idle");

    setIdleGateSuppressed(false);
    vi.advanceTimersByTime(IDLE_MS);
    expect(document.documentElement).toHaveAttribute("data-input-idle");
  });
});
