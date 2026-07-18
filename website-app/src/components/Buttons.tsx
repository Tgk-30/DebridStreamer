import type { CSSProperties, ReactNode } from 'react';
import { useRef } from 'react';
import { Link } from 'react-router';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/** 4px play-triangle that nudges +3px on hover (parent needs `group`). */
export function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 8 10"
      aria-hidden="true"
      className={cn('h-[9px] w-[8px] fill-current transition-transform duration-200 group-hover:translate-x-[3px]', className)}
    >
      <path d="M0 0L8 5L0 10V0Z" />
    </svg>
  );
}

/** Magnetic hover - attracts toward cursor (max 6px), springs back on leave. */
function Magnetic({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 170, damping: 22 });
  const sy = useSpring(y, { stiffness: 170, damping: 22 });

  if (reduced) return <>{children}</>;

  return (
    <motion.div
      ref={ref}
      className="inline-block"
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = e.clientX - (rect.left + rect.width / 2);
        const dy = e.clientY - (rect.top + rect.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < 48 + rect.width / 2) {
          x.set(Math.max(-6, Math.min(6, dx * 0.18)));
          y.set(Math.max(-6, Math.min(6, dy * 0.18)));
        }
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

interface ButtonBaseProps {
  children: ReactNode;
  /** internal route */
  to?: string;
  /** external URL */
  href?: string;
  onClick?: () => void;
  className?: string;
  style?: CSSProperties;
  /** show the 4px play triangle after the label */
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
    const external = href.startsWith('http');
    return (
      <a
        href={href}
        onClick={onClick}
        className={className}
        style={style}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
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

/** Primary - pill, Space Grotesk 600, dark ink on --grad-stream, --glow-brand, magnetic. */
export function PrimaryButton(props: ButtonBaseProps) {
  const { playIcon = true, magnetic = true } = props;
  const el = renderElement({
    ...props,
    style: { ...props.style, backgroundImage: 'var(--grad-stream)' },
    className: cn(
      'group inline-flex items-center justify-center gap-2.5 rounded-chip px-[26px] py-[14px]',
      'font-display text-[0.95rem] font-semibold leading-none tracking-[-0.01em] text-[var(--ink-on-brand)]',
      'shadow-glow-brand transition-[transform,box-shadow] duration-200 ease-expo hover:scale-[1.03] active:scale-[0.97]',
      props.className,
    ),
    children: (
      <>
        {props.children}
        {playIcon && <PlayGlyph />}
      </>
    ),
  });
  return magnetic ? <Magnetic>{el}</Magnetic> : el;
}

/** Ghost - 1px --line-strong, glass fill, brand text, border beam on hover. */
export function GhostButton(props: ButtonBaseProps) {
  const { playIcon = true } = props;
  return renderElement({
    ...props,
    className: cn(
      'border-beam group inline-flex items-center justify-center gap-2.5 rounded-chip px-[26px] py-[14px]',
      'border border-line-strong bg-[var(--surface-glass)] font-display text-[0.95rem] font-semibold leading-none tracking-[-0.01em] text-brand backdrop-blur-sm',
      'transition-[background-color,border-color,transform] duration-200 ease-expo hover:bg-[var(--surface-glass-2)] active:scale-[0.97]',
      props.className,
    ),
    children: (
      <>
        {props.children}
        {playIcon && <PlayGlyph />}
      </>
    ),
  });
}
