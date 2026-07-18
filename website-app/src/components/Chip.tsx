import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ChipVariant = 'default' | 'featured' | 'instant' | 'warm' | 'outline';

interface ChipProps {
  children: ReactNode;
  variant?: ChipVariant;
  className?: string;
}

/**
 * Chip / Badge - pill, mono 0.75rem, --line border, glass.
 * featured: brand dot · instant: accent pulsing dot · warm: amber star · outline.
 */
export default function Chip({ children, variant = 'default', className }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-chip border px-3 py-1 font-mono text-[0.75rem] leading-none tracking-[0.04em]',
        variant === 'outline' ? 'border-line-strong bg-transparent' : 'border-line bg-[var(--surface-glass)] backdrop-blur-sm',
        variant === 'instant' ? 'text-accent2' : variant === 'warm' ? 'text-warm' : 'text-ink-2',
        className,
      )}
    >
      {variant === 'featured' && <span className="h-1.5 w-1.5 rounded-full bg-brand shadow-glow-brand" />}
      {variant === 'instant' && <span className="pulse-dot scale-75" />}
      {variant === 'warm' && <Star className="h-3 w-3 fill-current" strokeWidth={0} />}
      {children}
    </span>
  );
}
