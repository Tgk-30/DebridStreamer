import { motion, useReducedMotion } from 'framer-motion';
import { scrollToTarget } from '@/lib/scroll';
import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { EASE_EXPO } from '@/pages/brand/utils';

/** Section 8 - Closing CTA: "Same soul. Your skin." - rendered in the live theme. */
export default function ClosingCta() {
  const reduced = useReducedMotion();

  const word = (text: string, i: number, gradient = false) => (
    <motion.span
      key={text}
      className={gradient ? 'text-gradient inline-block' : 'inline-block'}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(8px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.8 }}
      transition={{ duration: reduced ? 0.2 : 0.55, ease: EASE_EXPO, delay: i * 0.09 }}
    >
      {text}
      {i < 3 ? ' ' : ''}
    </motion.span>
  );

  return (
    <section className="relative overflow-hidden py-[clamp(88px,12vw,152px)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-30" style={{ background: 'var(--grad-warm)' }} />

      <div className="relative mx-auto max-w-[820px] px-6 text-center md:px-10">
        <p className="eyebrow">{'// YOUR TURN'}</p>
        <h2 className="display-l mt-5 font-display">
          {word('Same', 0)}
          {word('soul.', 1)}
          {word('Your', 2, true)}
          {word('skin.', 3, true)}
        </h2>
        <motion.p
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: reduced ? 0.2 : 0.55, ease: EASE_EXPO, delay: 0.35 }}
          className="lede mx-auto mt-6 max-w-[560px]"
        >
          This headline - and every pixel around it - is rendering in whatever theme you just built. That&rsquo;s the
          proof.
        </motion.p>

        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: reduced ? 0.2 : 0.55, ease: EASE_EXPO, delay: 0.45 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-4"
        >
          <PrimaryButton onClick={() => scrollToTarget('#playground')}>Take the theme for a spin</PrimaryButton>
          <GhostButton to="/download">Download the app</GhostButton>
        </motion.div>
      </div>
    </section>
  );
}
