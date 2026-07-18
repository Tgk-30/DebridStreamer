import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyPreset, THEME_PRESETS, THEME_PRESET_NAMES, useThemePreset } from '@/theme.config';

/**
 * ThemePicker - navbar swatch button → dropdown with the 3 preset dots.
 * Selecting cross-fades :root vars (400ms) and persists to localStorage.
 */
export default function ThemePicker({ className }: { className?: string }) {
  const preset = useThemePreset();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Switch theme preset"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="theme-preset-menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-[var(--surface-glass)] transition-colors duration-150 hover:border-line-strong hover:bg-[var(--surface-glass-2)]"
      >
        {/* live swatch: current preset triad */}
        <span className="flex h-4 w-4 overflow-hidden rounded-full border border-line-strong">
          <span className="h-full w-1/3 bg-brand" />
          <span className="h-full w-1/3 bg-accent2" />
          <span className="h-full w-1/3 bg-warm" />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id="theme-preset-menu"
            role="menu"
            aria-label="Theme preset"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: reduced ? 0.1 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="glass-panel absolute right-0 top-12 z-50 w-56 rounded-card p-2"
          >
            <p className="px-3 pb-1.5 pt-2 font-mono text-[0.6875rem] uppercase tracking-[0.22em] text-ink-3">
              Theme preset
            </p>
            {THEME_PRESET_NAMES.map((name) => {
              const p = THEME_PRESETS[name];
              const active = name === preset;
              return (
                <button
                  key={name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    applyPreset(name);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150',
                    'hover:bg-[var(--surface-glass-2)]',
                    active && 'bg-[var(--surface-glass)]',
                  )}
                >
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-white/15"
                    style={{ background: `linear-gradient(135deg, ${p.brand}, ${p.accent})` }}
                  />
                  <span className="flex-1 font-body text-sm text-ink-1">{p.label}</span>
                  {active && <Check className="h-3.5 w-3.5 text-brand" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
