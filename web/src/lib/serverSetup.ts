// Decision logic for the Server first-run setup wizard.
//
// The persona FirstRunWizard is a LOCAL-MODE concern (see firstRun.ts). A
// freshly-deployed SERVER has its own guided setup: once the owner account
// exists (ServerModeGate's setup-owner step ran), the owner still has to add
// API keys, expose the server, and invite the household. This module decides
// whether to OFFER that wizard, kept pure so it's unit-testable without a
// React render or live server.
//
// Completion is tracked with the EXISTING `onboarding_completed` Store flag
// (markServerSetupComplete delegates to markOnboardingComplete), so a finished
// or skipped setup never re-prompts on this device. We also auto-skip when the
// server already looks configured (it has credentials), so connecting an
// already-set-up server never drags the owner back through setup.

import { getStore } from "../storage";
import { markOnboardingComplete } from "./firstRun";

const SERVER_SETUP_KEY = "onboarding_completed";

/** The minimum shape of the admin health counts the gate inspects. */
interface ServerSetupSignals {
  /** Effective experience role of the signed-in profile. */
  role: "owner" | "admin" | "member" | "restricted";
  /** Number of stored server credentials (TMDB/debrid/AI/etc.). */
  credentialCount: number;
}

/** Pure gate: should we OFFER the server-setup wizard for these signals?
 *
 *  Only the owner sets a server up, and only while it still looks empty (no
 *  credentials configured yet). An already-configured server is treated as
 *  "done" so reconnecting it never re-triggers setup. The persisted
 *  onboarding flag is checked separately by shouldShowServerSetup(). */
export function serverNeedsSetup(signals: ServerSetupSignals): boolean {
  if (signals.role !== "owner") return false;
  return signals.credentialCount === 0;
}

/** Async gate used by the host: combines the persisted "completed" flag with
 *  the live server signals. Returns true only when the owner hasn't already
 *  finished/skipped setup on this device AND the server still looks empty. */
export async function shouldShowServerSetup(
  signals: ServerSetupSignals,
): Promise<boolean> {
  if (!serverNeedsSetup(signals)) return false;
  try {
    const done = await getStore().getSetting(SERVER_SETUP_KEY);
    return done == null;
  } catch {
    // If the store can't be read, don't trap the owner behind setup.
    return false;
  }
}

/** Persist that server setup is finished/skipped so the wizard never reappears
 *  on this device. Reuses the shared onboarding flag. */
export async function markServerSetupComplete(): Promise<void> {
  await markOnboardingComplete();
}
