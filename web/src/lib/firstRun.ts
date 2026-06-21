// First-run detection for the persona onboarding wizard.
//
// The wizard is a LOCAL-MODE concern: a server-pinned build (configured server
// URL) goes straight to ServerModeGate's auth, never the wizard. We use a
// dedicated `onboarding_completed` Store flag — NOT `storage_port_initialized`,
// which flips on the first settings load before the user has done anything.

import { getStore } from "../storage";
import { configuredServerURL } from "./serverMode";

const ONBOARDING_KEY = "onboarding_completed";

function devBypassesOnboarding(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").has("qa-skip-onboarding");
  } catch {
    return false;
  }
}

/** True only on a genuine first run in Local Mode (no prior onboarding, no
 *  configured server URL). */
export async function isFirstRun(): Promise<boolean> {
  if (devBypassesOnboarding()) return false;
  if (configuredServerURL() != null) return false;
  try {
    const done = await getStore().getSetting(ONBOARDING_KEY);
    return done == null;
  } catch {
    // If the store can't be read, don't trap the user behind onboarding.
    return false;
  }
}

/** Persist that onboarding is finished so the wizard never reappears. */
export async function markOnboardingComplete(): Promise<void> {
  try {
    await getStore().setSetting(ONBOARDING_KEY, "true");
  } catch {
    // Non-fatal — worst case the wizard shows again next launch.
  }
}
