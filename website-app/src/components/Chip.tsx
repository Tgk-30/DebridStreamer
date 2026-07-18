import type { ReactNode } from 'react';
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
        'inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[0.75rem] font-medium leading-none',
        variant === 'outline' ? 'border-line-strong bg-transparent' : 'border-line bg-bg-2',
        variant === 'instant' ? 'text-accent2' : variant === 'warm' ? 'text-warm' : 'text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  );
}
