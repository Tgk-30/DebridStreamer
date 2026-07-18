import { motion, useReducedMotion } from 'framer-motion';
import { GhostButton, PrimaryButton } from '@/components/Buttons';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Section 5 - Closing CTA. */
export default function ClosingCta() {
  const reduced = useReducedMotion();

  const word = (text: string, i: number, gradient = false) => (
    <motion.span
      key={text}
      className={gradient ? 'text-gradient inline-block will-change-transform' : 'inline-block will-change-transform'}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.75 }}
      transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO, delay: i * 0.09 }}
    >
      {text}{' '}
    </motion.span>
  );

  return (
    <section className="relative flex min-h-[56vh] items-center justify-center overflow-hidden py-24">
      <div aria-hidden="true" className="absolute inset-0 opacity-40" style={{ background: 'var(--grad-warm)' }} />

      <div className="relative z-10 mx-auto max-w-[860px] px-6 text-center">
        <motion.p
          className="eyebrow"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.75 }}
          transition={{ duration: reduced ? 0.2 : 0.6 }}
        >
          {'// BRING IT HOME'}
        </motion.p>

        <h2 className="display-l mt-5 font-display">
          {word('One', 0)}
          {word('server.', 1)}
          {word('Every', 2, true)}
          {word('person.', 3, true)}
          {word('Every', 4)}
          {word('screen.', 5)}
        </h2>

        <motion.div
          className="mt-10 flex flex-wrap items-center justify-center gap-4"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.75 }}
          transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO, delay: 0.35 }}
        >
          <PrimaryButton to="/self-host">Set up your server</PrimaryButton>
          <GhostButton to="/download">Get the apps</GhostButton>
        </motion.div>

        <motion.p
          className="mt-7 font-mono text-[0.8125rem] tracking-[0.04em] text-ink-3"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          profiles · kids&apos; limits · requests - built in, no plugins
        </motion.p>
      </div>
    </section>
  );
}
