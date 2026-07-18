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
  void beam;
  const classes = cn(
    'group relative block rounded-card border border-line bg-bg-2 p-6',
    'transition-[background-color,border-color] duration-200',
    to && 'hover:border-line-strong hover:bg-[color-mix(in_srgb,var(--bg-2)_88%,var(--brand))]',
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
