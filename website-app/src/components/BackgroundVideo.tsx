import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { prefersReducedMotion, prefersSaveData } from '@/lib/motion';

interface BackgroundVideoProps {
  /** e.g. /hero-streams-loop.mp4 */
  src: string;
  /** e.g. /hero-streams-poster.jpg */
  poster: string;
  /** 0.35–0.5 per design §7 */
  opacity?: number;
  className?: string;
  /** mix-blend-mode: screen on dark sections */
  blend?: boolean;
  /** extra class for the video element itself */
  videoClassName?: string;
}

/**
 * Ambient looping background video layer.
 * - IntersectionObserver-paused when offscreen
 * - prefers-reduced-motion / Save-Data → poster only (never autoplays)
 * - poster + --bg-0 gradient fallback always rendered underneath
 */
export default function BackgroundVideo({
  src,
  poster,
  opacity = 0.45,
  className,
  blend = true,
  videoClassName,
}: BackgroundVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [enabled] = useState(() => !prefersReducedMotion() && !prefersSaveData());

  useEffect(() => {
    if (!enabled) return;
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { rootMargin: '80px' },
    );
    io.observe(wrap);
    return () => io.disconnect();
  }, [enabled]);

  return (
    <div
      ref={wrapRef}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      style={{
        backgroundImage: `url(${poster})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundColor: 'var(--bg-0)',
      }}
    >
      {enabled && (
        <video
          ref={videoRef}
          className={cn('h-full w-full object-cover', videoClassName)}
          style={{ opacity, mixBlendMode: blend ? 'screen' : 'normal' }}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
    </div>
  );
}
