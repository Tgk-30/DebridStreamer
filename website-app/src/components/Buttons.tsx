import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PlayGlyph({ className }: { className?: string }) {
  return <ArrowRight aria-hidden="true" className={cn('h-4 w-4', className)} />;
}

interface ButtonBaseProps {
  children: ReactNode;
  to?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  playIcon?: boolean;
  magnetic?: boolean;
}

function renderElement({ to, href, onClick, className, style, children }: ButtonBaseProps) {
  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className} style={style}>
        {children}
      </Link>
    );
  }
  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={className}
        style={style}
        {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} style={style}>
      {children}
    </button>
  );
}

export function PrimaryButton(props: ButtonBaseProps) {
  const { playIcon = true } = props;
  return renderElement({
    ...props,
    className: cn(
      'group inline-flex items-center justify-center gap-2.5 rounded-md bg-brand px-6 py-3.5',
      'font-display text-[0.95rem] font-semibold leading-none text-[var(--ink-on-brand)]',
      'transition-colors hover:bg-accent2 active:bg-brand-deep',
      props.className,
    ),
    children: (
      <>
        {props.children}
        {playIcon && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
      </>
    ),
  });
}

export function GhostButton(props: ButtonBaseProps) {
  const { playIcon = true } = props;
  return renderElement({
    ...props,
    className: cn(
      'group inline-flex items-center justify-center gap-2.5 rounded-md border border-line-strong bg-transparent px-6 py-3.5',
      'font-display text-[0.95rem] font-semibold leading-none text-ink-1',
      'transition-colors hover:border-brand hover:text-brand active:bg-bg-2',
      props.className,
    ),
    children: (
      <>
        {props.children}
        {playIcon && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />}
      </>
    ),
  });
}
