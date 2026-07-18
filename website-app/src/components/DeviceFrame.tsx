import { cn } from '@/lib/utils';

interface DeviceFrameProps {
  variant?: 'desktop' | 'tablet' | 'phone';
  src: string;
  alt?: string;
  className?: string;
  glow?: boolean;
  reflect?: boolean;
}

export default function DeviceFrame({ variant = 'desktop', src, alt = '', className }: DeviceFrameProps) {
  return (
    <div className={cn('relative', className)}>
      <div
        className={cn(
          'relative overflow-hidden border border-line-strong bg-bg-2 shadow-[0_24px_70px_-36px_rgba(0,0,0,0.9)]',
          variant === 'desktop' && 'rounded-[18px]',
          variant === 'tablet' && 'rounded-[26px] p-2',
          variant === 'phone' && 'rounded-[30px] p-2',
        )}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          className={cn(
            'block w-full object-cover',
            variant === 'desktop' && 'rounded-[17px]',
            variant === 'tablet' && 'rounded-[19px]',
            variant === 'phone' && 'rounded-[22px]',
          )}
        />
      </div>
    </div>
  );
}
