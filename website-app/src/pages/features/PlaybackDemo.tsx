import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap';
import { hasWebGL, prefersReducedMotion } from '@/lib/motion';
import type { ConstellationDriver } from '@/components/three/ProviderConstellation';
import { Stage } from './shared';

const ProviderConstellation = lazy(() => import('@/components/three/ProviderConstellation'));

const FALLBACK_NODES = [
  { name: 'Real-Debrid', angle: -0.35 },
  { name: 'AllDebrid', angle: 1.1 },
  { name: 'Premiumize', angle: 2.45 },
  { name: 'TorBox', angle: 3.85 },
  { name: 'Your sources', angle: 5.1 },
];

/** Static SVG diagram with the same topology + animated dashes (fallback). */
function ConstellationFallback() {
  const cx = 240;
  const cy = 170;
  return (
    <svg viewBox="0 0 480 340" className="h-full w-full" role="img" aria-label="Provider constellation diagram">
      {FALLBACK_NODES.map((n) => {
        const x = cx + Math.cos(n.angle) * 150;
        const y = cy + Math.sin(n.angle) * 105;
        const mx = (x + cx) / 2;
        const my = (y + cy) / 2 - 46;
        return (
          <path
            key={n.name}
            d={`M ${x} ${y} Q ${mx} ${my} ${cx} ${cy}`}
            fill="none"
            stroke="var(--brand)"
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="5 7"
            className="dash-flow"
          />
        );
      })}
      <circle cx={cx} cy={cy} r="22" fill="var(--brand)" style={{ filter: 'drop-shadow(0 0 14px var(--brand))' }} />
      <circle cx={cx} cy={cy} r="30" fill="none" stroke="var(--brand)" strokeOpacity="0.4" />
      {FALLBACK_NODES.map((n) => {
        const x = cx + Math.cos(n.angle) * 150;
        const y = cy + Math.sin(n.angle) * 105;
        return (
          <g key={n.name}>
            <rect x={x - 13} y={y - 13} width="26" height="26" rx="6" fill="var(--bg-2)" stroke="var(--line-strong)" transform={`rotate(45 ${x} ${y})`} />
            <circle cx={x} cy={y} r="3.5" fill="var(--accent)" />
            <text
              x={x}
              y={y - 22}
              textAnchor="middle"
              fill="var(--ink-2)"
              fontSize="9.5"
              fontFamily="var(--font-mono)"
              letterSpacing="1.5"
              style={{ textTransform: 'uppercase' }}
            >
              {n.name}
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy + 48} textAnchor="middle" fill="var(--brand)" fontSize="10" fontFamily="var(--font-mono)" letterSpacing="2">
        CACHE CORE
      </text>
    </svg>
  );
}

/**
 * Chapter 5 demo - Scene B, Provider Constellation (the page's one WebGL scene).
 * Lazy + IO-gated mount, unmounted offscreen; DPR ≤ 1.5; SVG fallback for
 * no-WebGL / reduced-motion / small or weak devices.
 */
export default function PlaybackDemo() {
  const stageRef = useRef<HTMLDivElement>(null);
  const driverRef = useRef<ConstellationDriver>({ intro: 0, scrollSpeed: 0.5, pointerX: 0, pointerY: 0 });
  const [inView, setInView] = useState(false);
  const [cached, setCached] = useState(false);
  const [webglOk] = useState(
    () =>
      hasWebGL() &&
      !prefersReducedMotion() &&
      window.innerWidth >= 380 &&
      (navigator.hardwareConcurrency ?? 8) >= 4,
  );

  /* lazy mount/unmount with the chapter's viewport presence */
  useEffect(() => {
    if (!webglOk) return;
    const el = stageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: '160px' });
    io.observe(el);
    return () => io.disconnect();
  }, [webglOk]);

  /* status line cycle: checking caches… → cached ✓ playing instantly */
  useEffect(() => {
    if (!inView && webglOk) return;
    const id = window.setInterval(() => setCached((v) => !v), 2600);
    return () => window.clearInterval(id);
  }, [inView, webglOk]);

  useGSAP(
    () => {
      if (!webglOk) return;
      /* entrance - core scale-up + node stagger-pop when 60% visible */
      const entrance = ScrollTrigger.create({
        trigger: stageRef.current,
        start: 'top 60%',
        once: true,
        onEnter: () => gsap.to(driverRef.current, { intro: 1, duration: 1.4, ease: 'power2.out' }),
      });
      /* chapter-scrubbed orbit speed 0.5×→1.5× */
      const scrub = ScrollTrigger.create({
        trigger: '#playback',
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.4,
        onUpdate: (self) => {
          driverRef.current.scrollSpeed = 0.5 + self.progress;
        },
      });
      return () => {
        entrance.kill();
        scrub.kill();
      };
    },
    { dependencies: [webglOk] },
  );

  const onPointerMove = (e: ReactPointerEvent) => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return;
    driverRef.current.pointerX = ((e.clientX - r.left) / r.width) * 2 - 1;
    driverRef.current.pointerY = -(((e.clientY - r.top) / r.height) * 2 - 1);
  };

  return (
    <Stage className="min-h-[480px]" >
      <div ref={stageRef} onPointerMove={onPointerMove} className="absolute inset-0">
        {/* ambient glow behind the core */}
        <div
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(closest-side, rgba(var(--brand-rgb), 0.16), transparent)' }}
        />

        {webglOk ? (
          inView ? (
            <Suspense fallback={null}>
              <ProviderConstellation driver={driverRef} />
            </Suspense>
          ) : null
        ) : (
          <ConstellationFallback />
        )}

        {/* hint */}
        <p className="absolute right-5 top-4 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">
          {webglOk ? 'click a node to focus' : 'static diagram'}
        </p>

        {/* status line */}
        <div className="absolute inset-x-0 bottom-4 flex justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={cached ? 'cached' : 'checking'}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              className={
                cached
                  ? 'font-mono text-[0.75rem] tracking-[0.04em] text-accent2'
                  : 'font-mono text-[0.75rem] tracking-[0.04em] text-ink-3'
              }
            >
              {cached ? 'cached ✓ playing instantly' : 'checking caches…'}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </Stage>
  );
}
