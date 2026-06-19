import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DexieStore } from "../storage/DexieStore";
import { __setStoreForTesting, getStore } from "../storage";
import { isFirstRun, markOnboardingComplete } from "./firstRun";

const g = globalThis as Record<string, unknown>;
let counter = 0;

describe("firstRun", () => {
  beforeEach(() => {
    counter += 1;
    __setStoreForTesting(new DexieStore(`first-run-${counter}-${Date.now()}`));
    delete g.__DEBRIDSTREAMER_SERVER_URL__;
  });
  afterEach(() => {
    __setStoreForTesting(null);
    delete g.__DEBRIDSTREAMER_SERVER_URL__;
  });

  it("is true on a fresh local install", async () => {
    await expect(isFirstRun()).resolves.toBe(true);
  });

  it("is false after onboarding is marked complete", async () => {
    expect(await isFirstRun()).toBe(true);
    await markOnboardingComplete();
    expect(await isFirstRun()).toBe(false);
  });

  it("never shows on a server-pinned build (configured server URL)", async () => {
    g.__DEBRIDSTREAMER_SERVER_URL__ = "https://stream.example.com";
    await expect(isFirstRun()).resolves.toBe(false);
  });

  it("does NOT treat storage_port_initialized as the onboarding flag", async () => {
    await getStore().setSetting("storage_port_initialized", "true");
    await expect(isFirstRun()).resolves.toBe(true);
  });
});
