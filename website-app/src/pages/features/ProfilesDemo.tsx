import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Lock } from 'lucide-react';
import { Link } from 'react-router';
import Chip from '@/components/Chip';
import { cn } from '@/lib/utils';
import { EASE_EXPO, StreamBar, Stage } from './shared';

interface ProfileRow {
  title: string;
  meta: string;
  progress: number;
}
interface Profile {
  id: string;
  name: string;
  role: string;
  initial: string;
  ring: string;
  text: string;
  locked?: boolean;
  badge?: string;
  rows: ProfileRow[];
}

const PROFILES: Profile[] = [
  {
    id: 'alex',
    name: 'Alex',
    role: 'Admin',
    initial: 'A',
    ring: 'ring-brand',
    text: 'text-brand',
    rows: [
      { title: 'The Last Relay', meta: '1:12 left · 4K', progress: 0.62 },
      { title: 'Night Signal', meta: '42 min left', progress: 0.41 },
      { title: 'Orbital', meta: 'start over', progress: 0.03 },
    ],
  },
  {
    id: 'sam',
    name: 'Sam',
    role: 'Password',
    initial: 'S',
    ring: 'ring-accent2',
    text: 'text-accent2',
    locked: true,
    rows: [
      { title: 'Copper Noir', meta: '38 min left', progress: 0.55 },
      { title: 'Deep Field', meta: 'E04 · 21 min left', progress: 0.7 },
      { title: 'Paper Harvest', meta: '1:26 left', progress: 0.18 },
    ],
  },
  {
    id: 'kids',
    name: 'Kids',
    role: 'maturity cap: PG',
    initial: 'K',
    ring: 'ring-warm',
    text: 'text-warm',
    badge: 'maturity cap',
    rows: [
      { title: 'The Clockwork Sea', meta: '12 min left', progress: 0.88 },
      { title: 'Deep Field', meta: 'E02 · halfway', progress: 0.5 },
      { title: 'Paper Harvest', meta: 'just started', progress: 0.06 },
    ],
  },
  {
    id: 'guest',
    name: 'Guest',
    role: 'temporary',
    initial: 'G',
    ring: 'ring-line-strong',
    text: 'text-ink-2',
    rows: [
      { title: 'Ember Road', meta: '58 min left', progress: 0.44 },
      { title: 'Orbital', meta: 'just started', progress: 0.09 },
      { title: 'The Last Relay', meta: 'not started', progress: 0 },
    ],
  },
];

/**
 * Chapter 3 demo - "Who's watching?": avatar select morphs the shared preview
 * panel; Sam's profile demos the 4-dot passcode unlock.
 */
export default function ProfilesDemo() {
  const reduced = useReducedMotion();
  const [selectedId, setSelectedId] = useState('alex');
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const selected = PROFILES.find((p) => p.id === selectedId) ?? PROFILES[0];

  const pick = (p: Profile) => {
    if (p.locked && !unlocked) {
      if (unlocking) return;
      setUnlocking(true);
      /* 4 dots fill with springs, then the card unlocks */
      window.setTimeout(() => {
        setUnlocked(true);
        setUnlocking(false);
        setSelectedId(p.id);
      }, reduced ? 250 : 950);
      return;
    }
    setSelectedId(p.id);
  };

  return (
    <Stage className="flex flex-col justify-between gap-6 p-5">
      {/* avatar row */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {PROFILES.map((p) => {
          const isSel = selectedId === p.id;
          const showLock = p.locked && !unlocked;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className={cn(
                'group relative flex flex-col items-center gap-2 rounded-card border px-2 py-4 transition-colors duration-200',
                isSel ? 'border-line-strong bg-[var(--surface-glass-2)]' : 'border-line hover:bg-[var(--surface-glass)]',
              )}
              aria-pressed={isSel}
            >
              <motion.span
                animate={isSel && p.id === 'sam' && !reduced ? { rotate: [-8, 0] } : { rotate: 0 }}
                transition={{ type: 'spring', stiffness: 170, damping: 16 }}
                className={cn(
                  'relative flex h-12 w-12 items-center justify-center rounded-full bg-bg-2 font-display text-lg ring-2',
                  p.ring,
                )}
              >
                {showLock ? <Lock className="h-4 w-4 text-ink-3" /> : <span className={p.text}>{p.initial}</span>}
              </motion.span>
              <span className="text-center">
                <span className="block text-[0.8125rem] font-medium leading-tight text-ink-1">{p.name}</span>
                <span className="mt-0.5 block font-mono text-[0.5625rem] uppercase tracking-[0.08em] text-ink-3">{p.role}</span>
              </span>
              {isSel && (
                <motion.span
                  layoutId="profile-underline"
                  className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full"
                  style={{ backgroundImage: 'var(--grad-stream)' }}
                  transition={{ type: 'spring', stiffness: 170, damping: 22 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* passcode mock */}
      <AnimatePresence>
        {unlocking && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center gap-2.5"
            aria-label="Entering passcode"
          >
            {[0, 1, 2, 3].map((i) => (
              <motion.span
                key={i}
                initial={{ scale: 0.4, opacity: 0.3 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.12 + i * 0.14, type: 'spring', stiffness: 300, damping: 18 }}
                className="h-2.5 w-2.5 rounded-full bg-brand shadow-glow-brand"
              />
            ))}
            <span className="ml-2 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">passcode…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* shared preview panel - morphs to the selected profile's taste */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selected.id + String(unlocked)}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: reduced ? 0.2 : 0.25, ease: EASE_EXPO }}
          className={cn(
            'rounded-card border border-line bg-bg-1/70 p-4',
            selected.id === 'kids' && 'shadow-glow-warm',
          )}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-3">
              continue watching · <span className={selected.text}>{selected.name}</span>
            </p>
            {selected.badge && <Chip variant="warm">{selected.badge}</Chip>}
          </div>
          <div className="flex flex-col gap-3.5">
            {selected.rows.map((row, i) => (
              <div key={row.title}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <p className="text-[0.875rem] font-medium leading-tight text-ink-1">{row.title}</p>
                  <p className="shrink-0 font-mono text-[0.625rem] tracking-[0.04em] text-ink-3">{row.meta}</p>
                </div>
                <StreamBar value={row.progress} delay={0.08 + i * 0.08} />
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex justify-end">
        <Link
          to="/household"
          className="group/hh inline-flex items-center gap-2 font-mono text-[0.75rem] tracking-[0.04em] text-brand transition-colors hover:text-accent2"
        >
          Household controls
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/hh:translate-x-1" />
        </Link>
      </div>
    </Stage>
  );
}
