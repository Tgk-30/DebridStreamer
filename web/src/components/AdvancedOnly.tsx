// Per-control experience gate. The Settings tabs already hide whole *tabs* in
// Simple mode (see visibleTabs in Settings.tsx); this adds CONTROL-level
// granularity so a tab that's visible in Simple mode can still hold back its
// power-user dials. It reads the same effective Simple/Advanced tier the tab
// gating uses (useSimpleMode → server profile session in Server Mode, the
// AppSettings flag in Local Mode), so the two stay in lock-step.
//
// Usage: wrap the advanced control(s) and they vanish in Simple mode.
//   <AdvancedOnly>
//     <Field label="Maximum file size">…</Field>
//   </AdvancedOnly>

import type { ReactNode } from "react";
import { useSimpleMode } from "../store/AppStore";
import { shouldShowAdvanced } from "../lib/advancedGating";

/** Renders children only when the effective experience tier is Advanced. In
 *  Simple mode it renders nothing (the control is hidden, not disabled). */
export function AdvancedOnly({ children }: { children: ReactNode }) {
  const simpleMode = useSimpleMode();
  if (!shouldShowAdvanced(simpleMode)) return null;
  return <>{children}</>;
}
