import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { EASE_EXPO, subscribeToast } from '@/pages/brand/utils';

/** Page-local toast host - fixed bottom-center glass chip, auto-hides. */
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer = 0;
    const unsubscribe = subscribeToast((m) => {
      setMsg(m);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 1800);
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-7 z-[60] flex justify-center px-4" aria-live="polite">
      <AnimatePresence>
        {msg && (
          <motion.div
            key={msg}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.25, ease: EASE_EXPO }}
            className="glass-panel flex items-center gap-2 rounded-chip px-4 py-2 font-mono text-[0.8125rem] tracking-[0.04em] text-brand shadow-glow-brand"
          >
            <Check className="h-3.5 w-3.5" />
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Radial brand flash - fires from a control when its change lands ────── */

export function ControlFlash({ pulse }: { pulse: number }) {
  if (pulse === 0) return null;
  return (
    <motion.span
      key={pulse}
      aria-hidden="true"
      className="pointer-events-none absolute -inset-3 rounded-card"
      style={{ background: 'radial-gradient(closest-side, rgba(var(--brand-rgb), 0.22), transparent 72%)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 0] }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    />
  );
}
