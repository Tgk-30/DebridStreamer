import type { HTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** internal route - whole card becomes a link */
  to?: string;
  /** conic border-beam on hover (default true) */
  beam?: boolean;
}

/**
 * GlassCard - glass fill, blur 14px, --line border, --r-card, --shadow-card.
 * Hover: lift y -6px, border beam, inner top highlight.
 */
export default function GlassCard({ children, to, beam = true, className, ...rest }: GlassCardProps) {
  const classes = cn(
    'glass-panel group relative block rounded-card p-6',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.06),var(--shadow-card)]',
    'transition-[transform,background-color,border-color] duration-300 ease-expo',
    'hover:-translate-y-1.5 hover:bg-[var(--surface-glass-2)]',
    beam && 'border-beam',
    className,
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...(rest as Record<string, unknown>)}>
        {children}
      </Link>
    );
  }
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
