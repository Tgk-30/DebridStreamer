import { motion, useReducedMotion } from 'framer-motion';
import { Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useThemePreset, useThemeTweaks } from '@/theme.config';
import SectionHeading from '@/components/SectionHeading';
import { copyWithToast, EASE_EXPO } from '@/pages/brand/utils';

interface TokenRow {
  name: string;
  role: string;
  kind: 'color' | 'gradient' | 'glow';
}

const GROUPS: { title: string; rows: TokenRow[] }[] = [
  {
    title: 'Base',
    rows: [
      { name: '--bg-0', role: 'page background', kind: 'color' },
      { name: '--bg-1', role: 'alternating section bands', kind: 'color' },
      { name: '--bg-2', role: 'raised panels', kind: 'color' },
      { name: '--line', role: 'hairline borders', kind: 'color' },
    ],
  },
  {
    title: 'Brand',
    rows: [
      { name: '--brand', role: 'primary actions, the mark, active states', kind: 'color' },
      { name: '--accent', role: 'instant / live indicators, links', kind: 'color' },
      { name: '--warm', role: 'ratings, projector warmth', kind: 'color' },
    ],
  },
  {
    title: 'Ink',
    rows: [
      { name: '--ink-1', role: 'headings, primary text', kind: 'color' },
      { name: '--ink-2', role: 'body / lede text', kind: 'color' },
      { name: '--ink-3', role: 'captions, meta, disabled', kind: 'color' },
    ],
  },
  {
    title: 'Gradients & glows',
    rows: [
      { name: '--grad-stream', role: 'headline keywords, button sheen, beams', kind: 'gradient' },
      { name: '--grad-warm', role: 'projector-lamp bloom behind CTAs', kind: 'gradient' },
      { name: '--glow-brand', role: 'primary glow shadow', kind: 'glow' },
      { name: '--glow-accent', role: 'live-indicator glow', kind: 'glow' },
      { name: '--glow-warm', role: 'warm bloom shadow', kind: 'glow' },
    ],
  },
];

/** Live computed value of a CSS custom property - re-reads on every theme change. */
function useCssVar(name: string): string {
  useThemePreset();
  useThemeTweaks();
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function Swatch({ row }: { row: TokenRow }) {
  if (row.kind === 'gradient') {
    return (
      <span
        className="brandpg-grad-drift h-8 w-24 shrink-0 rounded-lg border border-line"
        style={{ backgroundImage: `var(${row.name})` }}
      />
    );
  }
  if (row.kind === 'glow') {
    return (
      <span className="flex h-8 w-24 shrink-0 items-center justify-center rounded-lg border border-line bg-bg-0">
        <span className="h-4 w-10 rounded-md bg-bg-2" style={{ boxShadow: `var(${row.name})` }} />
      </span>
    );
  }
  return (
    <span className="h-8 w-8 shrink-0 rounded-lg border border-line-strong/50 bg-bg-2 p-1">
      <span className="block h-full w-full rounded-[6px]" style={{ background: `var(${row.name})` }} />
    </span>
  );
}

function Row({ row, index }: { row: TokenRow; index: number }) {
  const reduced = useReducedMotion();
  const value = useCssVar(row.name);

  return (
    <motion.button
      type="button"
      onClick={() => copyWithToast(`${row.name}: ${value}`, 'Copied')}
      title={`Copy ${row.name}: ${value}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: reduced ? 0.2 : 0.45, ease: EASE_EXPO, delay: index * 0.05 }}
      className={cn(
        'group flex w-full items-center gap-4 rounded-row border border-line bg-[var(--surface-glass)] px-4 py-3 text-left',
        'transition-[border-color,background-color] duration-200 hover:border-line-strong hover:bg-[var(--surface-glass-2)]',
      )}
    >
      <motion.span
        initial={reduced ? false : { scale: 0.6 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ delay: index * 0.05 + 0.12, type: 'spring', stiffness: 320, damping: 20 }}
        className="shrink-0"
      >
        <Swatch row={row} />
      </motion.span>
      <span className="w-[5.5rem] shrink-0 font-mono text-[0.8125rem] tracking-[0.02em] text-brand sm:w-28">
        {row.name}
      </span>
      <span className="hidden w-44 shrink-0 truncate font-mono text-[0.75rem] tracking-[0.02em] text-ink-3 lg:block">
        {value}
      </span>
      <span className="ml-auto text-right font-body text-[0.8125rem] leading-snug text-ink-2">{row.role}</span>
      <Copy className="h-3.5 w-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
    </motion.button>
  );
}

/** Section 3 - Color tokens: live-var swatch tables (they ARE the live vars). */
export default function TokenTables() {
  return (
    <section className="relative border-t border-line py-[clamp(88px,12vw,152px)]">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <SectionHeading
          eyebrow="// TOKENS"
          title="Color, on rails."
          lede="Every swatch below reads the live custom property - drag the playground sliders and watch the table re-theme itself. Click any row to copy it."
        />

        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title} className={group.rows.length > 4 ? 'lg:col-span-2' : undefined}>
              <p className="font-mono text-[0.75rem] uppercase tracking-[0.22em] text-ink-3">
                <span className="text-brand">▸</span> {group.title}
              </p>
              <div className="mt-4 flex flex-col gap-2.5">
                {group.rows.map((row, i) => (
                  <Row key={row.name} row={row} index={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
