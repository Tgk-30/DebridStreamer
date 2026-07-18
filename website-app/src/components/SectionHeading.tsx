import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SectionHeadingProps {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'left' | 'center';
  link?: { to: string; label: string };
  className?: string;
  children?: ReactNode;
}

export default function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  link,
  className,
  children,
}: SectionHeadingProps) {
  const centered = align === 'center';
  const cleanEyebrow = eyebrow.replace(/^\/\/\s*/, '').replace(/^\d+\s*[·:]\s*/, '');

  return (
    <div className={cn('max-w-[720px]', centered && 'mx-auto text-center', className)}>
      <p className="eyebrow">{cleanEyebrow}</p>
      <h2 className="display-l mt-4 font-display">{title}</h2>

      {lede && <p className={cn('lede mt-5', centered && 'mx-auto')}>{lede}</p>}

      {link && (
        <Link
          to={link.to}
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand transition-colors hover:text-accent2"
        >
          {link.label}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}

      {children}
    </div>
  );
}
