import { useEffect, useRef, useState } from 'react';
import { motion, useAnimation, useReducedMotion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTypewriter } from './hooks';
import { Stage } from './shared';

type Mode = 'cloud' | 'local' | 'offline';

const MODES: { id: Mode; label: string }[] = [
  { id: 'cloud', label: 'Cloud' },
  { id: 'local', label: 'Full Local' },
  { id: 'offline', label: 'Offline' },
];

const STATUS: Record<Mode, string> = {
  cloud: 'Cloud - artwork + update checks reach out.',
  local: 'Full Local - your server, your keys.',
  offline: 'Offline - nothing leaves this machine.',
};

/** fraction of the particle field that stays alive per mode */
const DENSITY: Record<Mode, number> = { cloud: 1, local: 0.45, offline: 0 };

const PARTICLE_COUNT = 180;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  baseAlpha: number;
  warm: boolean;
}

/**
 * Chapter 2 demo - "The kill switch": segmented Cloud / Full Local / Offline
 * toggle draining a particle network field; status line retypes itself.
 */
export default function PrivacyDemo() {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>('cloud');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const targetRef = useRef<number>(PARTICLE_COUNT);
  const changeAtRef = useRef<number>(0);
  const modeRef = useRef<Mode>('cloud');
  const pulse = useAnimation();

  const typedStatus = useTypewriter(STATUS[mode], reduced ?? false, 30);

  /* haptic-style scale pulse on every flip */
  useEffect(() => {
    pulse.start({ scale: [1, 0.985, 1], transition: { duration: 0.35, ease: 'easeOut' } });
  }, [mode, pulse]);

  useEffect(() => {
    modeRef.current = mode;
    targetRef.current = Math.round(PARTICLE_COUNT * DENSITY[mode]);
    changeAtRef.current = performance.now();
  }, [mode]);

  /* particle network field (canvas, ≤200 dots, GPU-friendly 2D) */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const styles = getComputedStyle(document.documentElement);
    const brandRgb = styles.getPropertyValue('--brand-rgb').trim() || '46, 230, 200';
    const accentRgb = styles.getPropertyValue('--accent-rgb').trim() || '62, 201, 245';

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (particlesRef.current.length === 0) {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.012,
        vy: (Math.random() - 0.5) * 0.012,
        r: 0.8 + Math.random() * 1.4,
        alpha: 0,
        baseAlpha: 0.2 + Math.random() * 0.5,
        warm: Math.random() < 0.12,
      }));
    }
    const particles = particlesRef.current;

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = targetRef.current;
      const changeAt = changeAtRef.current;

      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const alive = i < target;
        /* 500ms staggered drain across the field */
        const delay = (i / particles.length) * 500;
        const scheduled = now >= changeAt + delay;

        const goal = alive ? p.baseAlpha : 0;
        if (scheduled) {
          p.alpha += (goal - p.alpha) * Math.min(1, dt * 6);
          if (!alive) p.y += dt * 0.09; /* fade + fall */
        }

        if (alive) {
          p.x += p.vx * dt * 10;
          p.y += p.vy * dt * 10;
          if (p.x < -0.02) p.x = 1.02;
          if (p.x > 1.02) p.x = -0.02;
          if (p.y < -0.02) p.y = 1.02;
          if (p.y > 1.02) p.y = -0.02;
        } else if (p.y > 1.1) {
          /* recycle quietly at the top for the next flip back */
          p.y = -0.05;
          p.x = Math.random();
        }

        if (p.alpha > 0.01) {
          ctx.beginPath();
          ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${p.warm ? accentRgb : brandRgb}, ${p.alpha.toFixed(3)})`;
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(tick);
    };

    if (reduced) {
      /* static field - the sync effect below draws it; no motion loop */
      return () => ro.disconnect();
    }

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced]);

  /* reduced-motion: draw the static field once per mode change */
  useEffect(() => {
    if (!reduced) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const brandRgb = styles.getPropertyValue('--brand-rgb').trim() || '46, 230, 200';
    const accentRgb = styles.getPropertyValue('--accent-rgb').trim() || '62, 201, 245';
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    particlesRef.current.forEach((p, i) => {
      p.alpha = i < targetRef.current ? p.baseAlpha : 0;
      if (p.alpha > 0.01) {
        ctx.beginPath();
        ctx.arc(p.x * rect.width, p.y * rect.height, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.warm ? accentRgb : brandRgb}, ${p.alpha.toFixed(3)})`;
        ctx.fill();
      }
    });
  }, [mode, reduced]);

  return (
    <Stage className="flex flex-col p-5">
      {/* stylized app window over the network field */}
      <motion.div animate={pulse} className="relative flex min-h-[380px] flex-1 flex-col overflow-hidden rounded-card border border-line bg-bg-1/70">
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden="true" />

        <div className="relative z-10 flex h-9 items-center gap-1.5 border-b border-line bg-bg-2/80 px-3 backdrop-blur-sm">
          <span className="h-2 w-2 rounded-full bg-[rgba(var(--brand-rgb),0.6)]" />
          <span className="h-2 w-2 rounded-full bg-[rgba(var(--accent-rgb),0.6)]" />
          <span className="h-2 w-2 rounded-full bg-[rgba(var(--warm-rgb),0.6)]" />
          <span className="mx-auto flex h-5 w-1/2 items-center justify-center rounded bg-bg-0 font-mono text-[0.625rem] tracking-[0.04em] text-ink-3">
            settings · privacy
          </span>
          <span className="w-8" />
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-7 p-6">
          {/* segmented kill switch */}
          <div className="relative flex rounded-chip border border-line bg-bg-0/80 p-1 backdrop-blur-sm" role="tablist" aria-label="Privacy mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'relative z-10 rounded-chip px-4 py-2 font-mono text-[0.75rem] tracking-[0.04em] transition-colors duration-200',
                  mode === m.id ? 'text-brand' : 'text-ink-3 hover:text-ink-1',
                )}
              >
                {mode === m.id && (
                  <motion.span
                    layoutId="privacy-segment"
                    className="absolute inset-0 -z-10 rounded-chip border border-line-strong bg-[var(--surface-glass-2)]"
                    transition={{ type: 'spring', stiffness: 170, damping: 22 }}
                  />
                )}
                {m.label}
              </button>
            ))}
          </div>

          {/* external-link icons cross out as the app goes quiet */}
          <div className="flex items-center gap-4" aria-hidden="true">
            {['tmdb', 'osdb', 'gh'].map((label) => (
              <span
                key={label}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[0.625rem] text-ink-3 transition-opacity duration-500',
                  mode === 'cloud' ? 'opacity-100' : 'opacity-40',
                )}
              >
                <ExternalLink className="h-3 w-3" />
                {label}
                <span
                  className={cn(
                    'absolute left-1/2 top-1/2 h-px w-[120%] -translate-x-1/2 -translate-y-1/2 -rotate-12 bg-warm transition-transform duration-500',
                    mode === 'cloud' ? 'scale-x-0' : 'scale-x-100',
                  )}
                  style={{ transformOrigin: 'center' }}
                />
              </span>
            ))}
          </div>

          {/* retyping status line + mode dot */}
          <div className="flex min-h-[24px] items-center gap-2.5">
            <span className={cn('pulse-dot', mode !== 'cloud' && 'pulse-dot-brand')} />
            <p className="font-mono text-[0.75rem] tracking-[0.04em] text-ink-2">
              {typedStatus}
              <span className="ml-0.5 inline-block h-3 w-[7px] animate-caret-blink bg-brand align-[-2px]" />
            </p>
          </div>
        </div>
      </motion.div>
    </Stage>
  );
}
