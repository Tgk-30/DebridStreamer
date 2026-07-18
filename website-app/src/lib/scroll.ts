import type Lenis from 'lenis';

/** Global Lenis handle so route changes / anchor CTAs can scroll through it. */
let lenis: Lenis | null = null;

export function setLenis(instance: Lenis | null) {
  lenis = instance;
}

export function getLenis(): Lenis | null {
  return lenis;
}

export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { immediate: true });
  else window.scrollTo(0, 0);
}

export function scrollToTarget(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (lenis) lenis.scrollTo(el as HTMLElement, { offset: -96, duration: 1.4 });
  else (el as HTMLElement).scrollIntoView({ behavior: 'smooth' });
}
