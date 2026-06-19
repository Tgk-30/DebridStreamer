// Step-state machine for the Server first-run setup wizard. Kept pure + free of
// React so the ordering/next/back/progress logic is unit-testable in isolation.
// The component (ServerSetupWizard.tsx) owns the side effects (credential PUTs,
// invite POSTs); this module only owns "which step are we on and what's next".

export type ServerSetupStep = "welcome" | "keys" | "access" | "invite" | "done";

/** Linear order the owner walks through. "done" is the terminal confirmation. */
export const SERVER_SETUP_STEPS: ServerSetupStep[] = [
  "welcome",
  "keys",
  "access",
  "invite",
  "done",
];

/** Human label for each step (used in the progress rail). */
export const SERVER_SETUP_STEP_LABELS: Record<ServerSetupStep, string> = {
  welcome: "Welcome",
  keys: "API keys",
  access: "Access",
  invite: "Invite",
  done: "Finish",
};

/** Zero-based index of a step in the linear flow. */
export function stepIndex(step: ServerSetupStep): number {
  return SERVER_SETUP_STEPS.indexOf(step);
}

/** The next step, or null when already at the terminal step. */
export function nextStep(step: ServerSetupStep): ServerSetupStep | null {
  const index = stepIndex(step);
  if (index < 0 || index >= SERVER_SETUP_STEPS.length - 1) return null;
  return SERVER_SETUP_STEPS[index + 1];
}

/** The previous step, or null when already at the first step. */
export function previousStep(step: ServerSetupStep): ServerSetupStep | null {
  const index = stepIndex(step);
  if (index <= 0) return null;
  return SERVER_SETUP_STEPS[index - 1];
}

/** True for the terminal confirmation step. */
export function isFinalStep(step: ServerSetupStep): boolean {
  return step === "done";
}

/** 0–1 progress through the non-terminal steps, for a progress bar. The "done"
 *  step reports a full 1. */
export function stepProgress(step: ServerSetupStep): number {
  const denom = SERVER_SETUP_STEPS.length - 1;
  if (denom <= 0) return 1;
  return Math.min(1, stepIndex(step) / denom);
}
