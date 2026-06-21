// Pure helper behind the <AdvancedOnly> control-level gate. Kept separate from
// the component so the decision is unit-testable without a React render. The
// rule is intentionally trivial today (Advanced ⇔ NOT simpleMode), but living
// in one place means a future tweak (e.g. a per-control allowlist) lands here
// and stays consistent with the tab-level gating.

/** True when Advanced-only controls should be shown for the given tier. */
export function shouldShowAdvanced(simpleMode: boolean): boolean {
  return !simpleMode;
}
