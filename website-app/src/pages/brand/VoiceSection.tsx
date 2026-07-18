import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import SectionHeading from '@/components/SectionHeading';
import GlassCard from '@/components/GlassCard';
import { EASE_EXPO } from '@/pages/brand/utils';

const CARDS = [
  {
    title: 'Confident',
    do: "Plays what's cached. Instantly.",
    dont: 'We strive to minimize latency…',
  },
  {
    title: 'Friendly',
    do: "Let's get you streaming.",
    dont: 'Initiate content acquisition.',
  },
  {
    title: 'Playful (never jokey)',
    do: 'Your server. Your streams. Your rules.',
    dont: '🚀 DISRUPT your media!!1',
  },
];

/** ✅ line that types itself once, the first time its card is hovered. */
function TypedDo({ text, active }: { text: string; active: boolean }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(text.length);
  const [started, setStarted] = useState(false);

  // first hover restarts the text from zero (render-adjust pattern)
  if (active && !started) {
    setStarted(true);
    if (!reduced) setN(0);
  }

  useEffect(() => {
    if (!started || reduced) return;
    const iv = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          window.clearInterval(iv);
          return v;
        }
        return v + 1;
      });
    }, 1000 / 34);
    return () => window.clearInterval(iv);
  }, [started, reduced, text.length]);

  const typing = n < text.length;
  return (
    <span className="font-mono text-[0.9rem] leading-[1.6] text-ink-1">
      {text.slice(0, n)}
      {typing && <span aria-hidden="true" className="animate-caret-blink ml-0.5 inline-block h-[1em] w-[0.5em] translate-y-[2px] bg-brand" />}
    </span>
  );
}

function VoiceCard({ card, index }: { card: (typeof CARDS)[number]; index: number }) {
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: reduced ? 0.2 : 0.55, ease: EASE_EXPO, delay: index * 0.1 }}
    >
      <GlassCard className="h-full" onMouseEnter={() => setHovered(true)}>
        <p className="display-s font-display text-ink-1">{card.title}</p>

        <div className="mt-5 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <motion.span
              initial={reduced ? false : { scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ delay: index * 0.1 + 0.35, type: 'spring', stiffness: 320, damping: 14 }}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand shadow-glow-brand"
            >
              <Check className="h-3 w-3 text-[var(--ink-on-brand)]" strokeWidth={3.5} />
            </motion.span>
            <TypedDo text={card.do} active={hovered} />
          </div>

          <div className="flex items-start gap-3">
            <motion.span
              initial={reduced ? false : { scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ delay: index * 0.1 + 0.45, type: 'spring', stiffness: 320, damping: 14 }}
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--destructive))]"
            >
              <X className="h-3 w-3 text-[hsl(var(--destructive))]" strokeWidth={3} />
            </motion.span>
            <span className="font-body text-[0.9rem] leading-[1.6] text-ink-3 line-through decoration-line-strong">
              {card.dont}
            </span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

/** Section 6 - Voice: do/don't pairs. */
export default function VoiceSection() {
  return (
    <section className="relative border-t border-line py-[clamp(88px,12vw,152px)]">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <SectionHeading eyebrow="// VOICE" title="Confident. Friendly. A little playful." />

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {CARDS.map((card, i) => (
            <VoiceCard key={card.title} card={card} index={i} />
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className={cn('mt-10 text-center font-mono text-[0.8125rem] tracking-[0.04em] text-ink-3')}
        >
          {'// exclamation points: one per page, max.'}
        </motion.p>
      </div>
    </section>
  );
}
