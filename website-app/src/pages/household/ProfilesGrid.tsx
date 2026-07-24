import { memo, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Inbox, Info, Lock, LockOpen, RotateCcw, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import GlassCard from '@/components/GlassCard';
import SectionHeading from '@/components/SectionHeading';
import Chip from '@/components/Chip';
import { POSTERS, posterSrc } from '@/pages/household/data';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const posterTitle = (n: number) => POSTERS.find((p) => p.n === n)?.title ?? '';

/* ── Resume bar (stream-fill metaphor) ─────────────────────────────────── */

function ResumeBar({ title, pct, delay }: { title: string; pct: number; delay: number }) {
  const reduced = useReducedMotion();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-body text-[0.875rem] leading-[1.5] text-ink-2">{title}</span>
        <span className="shrink-0 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div className="stream-fill mt-1.5">
        <motion.span
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: pct }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: reduced ? 0.2 : 0.9, ease: EASE_EXPO, delay }}
        />
      </div>
    </div>
  );
}

/* ── Taste row thumbs (flip in + invented-title tooltip) ───────────────── */

function TasteThumb({ n, index }: { n: number; index: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="group/thumb relative"
      tabIndex={0}
      style={{ transformPerspective: 600 }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, rotateY: 70 }}
      whileInView={{ opacity: 1, rotateY: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO, delay: 0.25 + index * 0.08 }}
    >
      <img
        src={posterSrc(n)}
        alt={posterTitle(n)}
        loading="lazy"
        draggable={false}
        className="aspect-[2/3] w-full rounded-md border border-line object-cover transition-shadow duration-300 group-hover/thumb:shadow-glow-brand"
      />
      <span className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-row border border-line bg-bg-1 px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-ink-2 opacity-0 shadow-card transition-opacity duration-200 group-hover/thumb:opacity-100 group-focus-visible/thumb:opacity-100">
        {posterTitle(n)}
      </span>
    </motion.div>
  );
}

/* ── Passcode dots + pad (Sam's lock demo) ─────────────────────────────── */

const PasscodePad = memo(function PasscodePad({ onDigit }: { onDigit: () => void }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" aria-label="Passcode pad (any 4 digits unlock)">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => (
        <button
          key={d}
          type="button"
          onClick={onDigit}
          aria-label={`Digit ${d}`}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-[var(--surface-glass)] font-mono text-[0.75rem] text-ink-2 transition-[background-color,border-color,color,transform] duration-150 hover:border-line-strong hover:text-brand active:scale-90"
        >
          {d}
        </button>
      ))}
    </div>
  );
});

function PasscodeGate({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const [entered, setEntered] = useState(0);
  const [unlocked, setUnlocked] = useState(false);

  const digit = () => {
    if (unlocked) return;
    const next = entered + 1;
    setEntered(next);
    if (next >= 4) setUnlocked(true);
  };
  const relock = () => {
    setUnlocked(false);
    setEntered(0);
  };

  return (
    <div>
      {/* lock header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors duration-300',
              unlocked ? 'border-[rgba(var(--brand-rgb),0.4)] text-brand' : 'border-line text-ink-3',
            )}
          >
            {unlocked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          </span>
          <div className="flex items-center gap-1.5" aria-label={unlocked ? 'Unlocked' : `${entered} of 4 digits entered`}>
            {[0, 1, 2, 3].map((i) => (
              <motion.span
                key={i}
                className={cn(
                  'h-2 w-2 rounded-full border',
                  i < entered || unlocked ? 'border-brand bg-brand' : 'border-line-strong bg-transparent',
                )}
                animate={i < entered ? { scale: [1, 1.6, 1] } : { scale: 1 }}
                transition={{ duration: reduced ? 0.1 : 0.25 }}
              />
            ))}
          </div>
        </div>
        <AnimatePresence mode="wait">
          {unlocked ? (
            <motion.button
              key="relock"
              type="button"
              onClick={relock}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="inline-flex items-center gap-1.5 font-mono text-[0.75rem] tracking-[0.04em] text-brand transition-colors hover:text-accent2"
            >
              <RotateCcw className="h-3 w-3" />
              re-lock
            </motion.button>
          ) : (
            <motion.span
              key="hint"
              className="font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              any 4 digits unlock
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* pad while locked */}
      <AnimatePresence initial={false}>
        {!unlocked && (
          <motion.div
            key="pad"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0.15 : 0.3, ease: EASE_EXPO }}
            className="overflow-hidden"
          >
            <div className="pb-4">
              <PasscodePad onDigit={digit} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* gated content: blurred until unlocked */}
      <div className="relative">
        <div
          className={cn(
            'transition-[filter,opacity] duration-500',
            !unlocked && 'pointer-events-none select-none opacity-60 blur-[8px] saturate-50',
          )}
          aria-hidden={!unlocked}
        >
          {children}
        </div>
        {/* unlock shimmer sweep */}
        <AnimatePresence>
          {unlocked && (
            <motion.span
              key="shimmer"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-md"
              style={{ background: 'linear-gradient(100deg, transparent 20%, rgba(var(--brand-rgb), 0.22) 50%, transparent 80%)' }}
              initial={{ x: '-110%' }}
              animate={{ x: '110%' }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.2 : 0.9, ease: EASE_EXPO }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Card shells ───────────────────────────────────────────────────────── */

function CardHeader({ initial, name, role, ring }: { initial: string; name: string; role: string; ring: string }) {
  return (
    <div className="mb-5 flex items-center gap-3.5">
      <span
        className="flex h-11 w-11 items-center justify-center rounded-full border-2 bg-bg-2 font-display text-[0.95rem] font-semibold text-ink-1"
        style={{ borderColor: ring }}
      >
        {initial}
      </span>
      <div>
        <p className="display-s font-display text-ink-1">{name}</p>
        <Chip className="mt-1 px-2 py-0.5 text-[0.625rem]">{role}</Chip>
      </div>
    </div>
  );
}

function TasteRow({ posters }: { posters: number[] }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-3">on their list</p>
      <div className="grid grid-cols-3 gap-2">
        {posters.map((n, i) => (
          <TasteThumb key={n} n={n} index={i} />
        ))}
      </div>
    </div>
  );
}

/**
 * Section 2 - Personal profiles grid: resume trios, taste rows, Sam's
 * passcode lock demo, Guest's clean slate.
 */
export default function ProfilesGrid() {
  const reduced = useReducedMotion();

  const cardMotion = (i: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(8px)' },
    whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
    viewport: { once: true, amount: 0.5 } as const,
    transition: { duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO, delay: i * 0.12 },
  });

  return (
    <section className="py-[clamp(88px,12vw,152px)]">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <SectionHeading
          eyebrow="// PROFILES"
          title="Yours is yours."
          lede="Each profile keeps its own watchlist, history, resume bars, and recommendations - with an optional household password and optional credential overrides. The server operator can administer profiles and view operational activity."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Alex - Admin */}
          <motion.div {...cardMotion(0)}>
            <GlassCard className="h-full">
              <CardHeader initial="A" name="Alex" role="admin" ring="var(--brand)" />
              <div className="space-y-3.5">
                <ResumeBar title="Night Signal · S1E4" pct={0.62} delay={0.35} />
                <ResumeBar title="Ember Road" pct={0.18} delay={0.5} />
                <ResumeBar title="Glass Harbor · S2E1" pct={0.94} delay={0.65} />
              </div>
              <div className="mt-6">
                <TasteRow posters={[1, 2, 3]} />
              </div>
              <div className="mt-6 flex items-center gap-2 border-t border-line pt-4 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">
                <Inbox className="h-3.5 w-3.5 text-warm" />
                everything + requests inbox
                <span className="ml-auto inline-flex items-center gap-1 rounded-chip border border-[rgba(var(--warm-rgb),0.4)] px-2 py-0.5 text-warm">
                  1 waiting
                </span>
              </div>
            </GlassCard>
          </motion.div>

          {/* Sam - password on */}
          <motion.div {...cardMotion(1)}>
            <GlassCard className="h-full">
              <CardHeader initial="S" name="Sam" role="member · password on" ring="var(--accent)" />
              <PasscodeGate>
                <div className="space-y-3.5">
                  <ResumeBar title="The Last Relay" pct={0.41} delay={0.35} />
                  <ResumeBar title="Paper Comet" pct={0.77} delay={0.5} />
                </div>
                <div className="mt-6">
                  <TasteRow posters={[5, 6, 7]} />
                </div>
              </PasscodeGate>
              <div className="mt-6 flex items-center gap-2 border-t border-line pt-4 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">
                <Sparkles className="h-3.5 w-3.5 text-accent2" />
                credential overrides: on
                <span className="group/info relative ml-auto" tabIndex={0}>
                  <Info className="h-3.5 w-3.5 cursor-help text-ink-3 transition-colors group-hover/info:text-brand" />
                  <span className="pointer-events-none absolute -top-2 right-0 z-10 -translate-y-full whitespace-nowrap rounded-row border border-line bg-bg-1 px-2.5 py-1 opacity-0 shadow-card transition-opacity duration-200 group-hover/info:opacity-100 group-focus-visible/info:opacity-100">
                    Each profile can use its own provider keys.
                  </span>
                </span>
              </div>
            </GlassCard>
          </motion.div>

          {/* Guest - clean slate */}
          <motion.div {...cardMotion(2)} className="md:col-span-2 lg:col-span-1">
            <GlassCard className="h-full">
              <CardHeader initial="G" name="Guest" role="guest" ring="var(--ink-3)" />
              <div className="flex flex-col items-center justify-center rounded-row border border-dashed border-line-strong px-4 py-7 text-center">
                <p className="font-mono text-[0.75rem] leading-[1.6] tracking-[0.04em] text-ink-3">
                  a clean slate - no overrides,
                  <br />
                  no history kept after sign-out
                </p>
              </div>
              <div className="mt-6">
                <TasteRow posters={[8, 4, 6]} />
              </div>
              <div className="mt-6 border-t border-line pt-4 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">
                browsing as guest leaves no trace
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
