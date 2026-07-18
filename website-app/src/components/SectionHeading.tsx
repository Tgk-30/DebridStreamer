import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

interface SectionHeadingProps {
  /** e.g. `// 01 · DISCOVER` - always mono */
  eyebrow: string;
  /** string → word-level rise-in; ReactNode → block rise (gradient keyword spans allowed) */
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  /** ghost trailing link, e.g. All features → */
  link?: { to: string; label: string };
  className?: string;
  children?: ReactNode;
}

/**
 * SectionHeading - eyebrow + Display L title + optional lede.
 * Title gets word-level rise-in; eyebrow types on. Reduced motion → opacity fade.
 */
export default function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  link,
  className,
  children,
}: SectionHeadingProps) {
  const reduced = useReducedMotion();
  const centered = align === 'center';

  const wordVariants = {
    hidden: reduced ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(8px)' },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.5, ease: EASE_EXPO, delay: i * 0.07 },
    }),
  };

  const words = typeof title === 'string' ? title.split(' ') : null;

  return (
    <div className={cn('max-w-[720px]', centered && 'mx-auto text-center', className)}>
      <motion.p
        className="eyebrow"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.8 }}
        transition={{ duration: reduced ? 0.2 : 0.6, ease: 'easeOut' }}
      >
        {eyebrow}
      </motion.p>

      <h2 className="display-l mt-4 font-display">
        {words
          ? words.map((word, i) => (
              <motion.span
                key={`${word}-${i}`}
                className="inline-block will-change-transform"
                custom={i}
                variants={wordVariants}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, amount: 0.8 }}
              >
                {word}
                {i < words.length - 1 ? ' ' : ''}
              </motion.span>
            ))
          : (
            <motion.span
              className="inline-block will-change-transform"
              custom={0}
              variants={wordVariants}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.8 }}
            >
              {title}
            </motion.span>
          )}
      </h2>

      {lede && (
        <motion.p
          className={cn('lede mt-5', centered && 'mx-auto')}
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: reduced ? 0.2 : 0.6, ease: EASE_EXPO, delay: 0.15 }}
        >
          {lede}
        </motion.p>
      )}

      {link && (
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <Link
            to={link.to}
            className="group/link mt-6 inline-flex items-center gap-2 font-mono text-[0.8125rem] tracking-[0.04em] text-brand transition-colors hover:text-accent2"
          >
            {link.label}
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/link:translate-x-1" />
          </Link>
        </motion.div>
      )}

      {children}
    </div>
  );
}
