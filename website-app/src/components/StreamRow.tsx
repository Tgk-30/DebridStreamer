import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StreamRowMeta {
  label: string;
  /** instant: accent text · dim: ink-3 · warm: amber */
  variant?: 'instant' | 'dim' | 'warm';
}

interface StreamRowProps {
  /** leading provider/platform icon (rendered inside a chip) */
  icon: ReactNode;
  title: string;
  meta: StreamRowMeta[];
  /** trailing size, e.g. `24 MB` */
  size?: string;
  /** external URL (GitHub Releases) or internal route */
  href: string;
  className?: string;
}

/**
 * StreamRow - styled like the app's stream-picker result.
 * Hover: row slides x +8px, a stream-fill bar sweeps the bottom edge, badge glows.
 */
export default function StreamRow({ icon, title, meta, size, href, className }: StreamRowProps) {
  const external = href.startsWith('http');

  const body = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-bg-2 text-brand transition-shadow duration-300 group-hover:shadow-glow-brand">
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-[1rem] font-semibold leading-[1.6] text-ink-1">
          {title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {meta.map((m) => (
            <span
              key={m.label}
              className={cn(
                'inline-flex items-center gap-1.5 font-mono text-[0.75rem] tracking-[0.04em]',
                m.variant === 'instant' ? 'text-accent2' : m.variant === 'warm' ? 'text-warm' : 'text-ink-3',
              )}
            >
              {m.label}
            </span>
          ))}
        </span>
      </span>

      {size && <span className="hidden shrink-0 font-mono text-[0.8125rem] tracking-[0.04em] text-ink-3 sm:block">{size}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 transition-all duration-200 group-hover:translate-x-1 group-hover:text-brand" />

      {/* stream-fill sweep along the bottom edge */}
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 transition-transform duration-500 ease-expo group-hover:scale-x-100"
        style={{ backgroundImage: 'var(--grad-stream)' }}
      />
    </>
  );

  const classes = cn(
    'border-beam group relative flex items-center gap-4 overflow-hidden rounded-row border border-line',
    'bg-[var(--surface-glass)] px-5 py-4 backdrop-blur-sm',
    'transition-[transform,background-color,border-color] duration-300 ease-expo',
    'hover:translate-x-2 hover:border-line-strong hover:bg-[var(--surface-glass-2)]',
    className,
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={classes}>
        {body}
      </a>
    );
  }
  return (
    <Link to={href} className={classes}>
      {body}
    </Link>
  );
}
