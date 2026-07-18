import { useRef, useState } from 'react';
import { ScrollTrigger, useGSAP, gsap } from '@/lib/gsap';
import { getLenis } from '@/lib/scroll';
import { cn } from '@/lib/utils';
import { CHAPTERS } from './shared';

/** Smooth-scrolls to a chapter through the global Lenis (falls back to native). */
export function scrollToChapter(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = getLenis();
  if (lenis) lenis.scrollTo(el, { offset: -140, duration: 1.2 });
  else el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Sticky chapter sub-nav (top 80px, glass bar, z-30).
 * Active chapter auto-highlights via ScrollTrigger and updates the URL hash;
 * on mobile it collapses to a horizontally scrollable strip.
 */
export default function ChapterNav() {
  const [active, setActive] = useState<string>(CHAPTERS[0].id);
  const barRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    /* entrance - pills stagger 40ms */
    gsap.from('.chapter-pill', { y: -8, opacity: 0, duration: 0.5, stagger: 0.04, ease: 'expo.out', delay: 1 });

    const triggers = CHAPTERS.map((c) =>
      ScrollTrigger.create({
        trigger: `#${c.id}`,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: (self) => {
          if (!self.isActive) return;
          setActive(c.id);
          if (window.location.hash !== `#${c.id}`) {
            window.history.replaceState(null, '', `#${c.id}`);
          }
          /* keep the active pill visible inside the horizontal strip */
          const bar = barRef.current;
          const pill = bar?.querySelector<HTMLElement>(`[data-chapter="${c.id}"]`);
          if (bar && pill) {
            bar.scrollTo({
              left: pill.offsetLeft - bar.clientWidth / 2 + pill.clientWidth / 2,
              behavior: 'smooth',
            });
          }
        },
      }),
    );
    return () => triggers.forEach((t) => t.kill());
  }, { dependencies: [] });

  return (
    <div className="sticky top-[80px] z-30 flex justify-center px-4">
      <div
        ref={barRef}
        className="flex max-w-full items-center gap-1 overflow-x-auto rounded-chip border border-line bg-[var(--surface-glass-2)] px-2 py-2 shadow-card backdrop-blur-[18px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="navigation"
        aria-label="Feature chapters"
      >
        {CHAPTERS.map((c) => (
          <button
            key={c.id}
            type="button"
            data-chapter={c.id}
            onClick={() => scrollToChapter(c.id)}
            className={cn(
              'chapter-pill flex shrink-0 items-center gap-1.5 rounded-chip px-3 py-1.5 font-mono text-[0.75rem] leading-none tracking-[0.04em] transition-colors duration-200',
              active === c.id ? 'bg-[var(--surface-glass)] text-brand' : 'text-ink-3 hover:text-ink-1',
            )}
            aria-current={active === c.id ? 'true' : undefined}
          >
            {active === c.id && <span className="h-1 w-1 rounded-full bg-brand shadow-glow-brand" />}
            {c.nav}
          </button>
        ))}
      </div>
    </div>
  );
}
