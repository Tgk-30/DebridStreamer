2026-07-12 | downloads v1 engine (Rust) | gpt-5.6-sol[high] | success | contract-conformant, compile-safe; review found ffmpeg-CI-not-wired blocker (fixed) + hardening items (spun off)
2026-07-12 | downloads v1 UI (queue/Detail actions/settings) | gpt-5.6-terra[xhigh] | success | 2778 tests green integrated; seam type-checks clean
2026-07-12 | player geometry v3 | BLOCKED | awaiting | two shipped fixes (overlay portal, FBO pixel-dims) did NOT resolve the native squish+inset; cannot diagnose native render without runtime data; asked Brendan for DS_MPV_DEBUG log
2026-07-12 | v0.6.4 field reports: exit-fullscreen crash + wrap axis | gpt-5.6-sol[max] + opus review | success | crash = setFrame on fullscreen window during teardown; review caught permanent aspect-lock before ship
2026-07-12 | v0.6.5-web ship: fullscreen-safe mutations + width-anchored wrap | fable-integrate | success | 4/4 green first try; 2782 tests
