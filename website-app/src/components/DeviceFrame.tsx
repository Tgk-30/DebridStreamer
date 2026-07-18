import { cn } from '@/lib/utils';

interface DeviceFrameProps {
  variant?: 'desktop' | 'tablet' | 'phone';
  src: string;
  alt?: string;
  className?: string;
  /** brand underlight glow (default true) */
  glow?: boolean;
  /** floor reflection (desktop default true) */
  reflect?: boolean;
}

/**
 * DeviceFrame - screenshots staged in CSS device bezels.
 * desktop: restrained browser chrome · tablet/phone: rounded bezels.
 * Brand underlight + masked floor reflection.
 */
export default function DeviceFrame({
  variant = 'desktop',
  src,
  alt = '',
  className,
  glow = true,
  reflect,
}: DeviceFrameProps) {
  const showReflect = reflect ?? variant === 'desktop';

  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'relative overflow-hidden border border-line bg-bg-2 shadow-card',
          variant === 'desktop' && 'rounded-stage',
          variant === 'tablet' && 'rounded-[40px] p-2.5',
          variant === 'phone' && 'rounded-[44px] p-2',
        )}
        style={
          showReflect
            ? { WebkitBoxReflect: 'below 16px linear-gradient(transparent 62%, rgba(0, 0, 0, 0.2))' }
            : undefined
        }
      >
        {variant === 'desktop' && (
          <div className="flex h-10 items-center gap-2 border-b border-line px-4">
            <span className="w-10" />
            <span className="mx-auto flex h-6 w-1/2 items-center justify-center rounded-md bg-bg-0 font-mono text-[0.6875rem] tracking-[0.04em] text-ink-3">
              debridstreamer.local
            </span>
            <span className="w-10" />
          </div>
        )}
        {variant === 'phone' && (
          <div className="absolute left-1/2 top-3.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-bg-0" />
        )}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          className={cn(
            'block w-full object-cover',
            variant === 'desktop' && 'rounded-b-[calc(var(--r-stage)-1px)]',
            variant === 'tablet' && 'rounded-[30px]',
            variant === 'phone' && 'rounded-[36px]',
          )}
        />
      </div>

      {glow && (
        <div
          aria-hidden="true"
          className="absolute -bottom-8 left-1/2 -z-10 h-20 w-3/4 -translate-x-1/2 rounded-full blur-2xl"
          style={{ background: 'radial-gradient(closest-side, rgba(var(--brand-rgb), 0.28), transparent)' }}
        />
      )}
    </div>
  );
}
