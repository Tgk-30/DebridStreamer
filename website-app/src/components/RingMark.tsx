import { cn } from '@/lib/utils';

interface RingMarkProps {
  size?: number;
  className?: string;
  /** disable ring rotation (e.g. favicon-like static spots) */
  static?: boolean;
}

/**
 * Ring Mark - play triangle + 3 concentric rounded-cap ring arcs.
 * Rings rotate at 12s / 20s / 28s (alternating direction); on hover of a
 * `group` parent the triangle fills with brand + glow. Pure SVG, no WebGL.
 */
export default function RingMark({ size = 32, className, static: isStatic = false }: RingMarkProps) {
  const rings = [
    { r: 9.5, dash: '58 42', dur: '12s', reverse: false },
    { r: 14, dash: '46 54', dur: '20s', reverse: true },
    { r: 18.5, dash: '68 32', dur: '28s', reverse: false },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 text-brand', className)}
    >
      {rings.map((ring) => (
        <g
          key={ring.r}
          style={
            isStatic
              ? undefined
              : {
                  transformOrigin: '24px 24px',
                  animation: `spin-slow ${ring.dur} linear infinite${ring.reverse ? ' reverse' : ''}`,
                }
          }
        >
          <circle
            cx="24"
            cy="24"
            r={ring.r}
            pathLength={100}
            strokeDasharray={ring.dash}
            stroke="currentColor"
            strokeOpacity={ring.r === 9.5 ? 0.95 : ring.r === 14 ? 0.6 : 0.38}
            strokeWidth={ring.r === 9.5 ? 2 : 1.5}
            strokeLinecap="round"
          />
        </g>
      ))}
      <path
        d="M21 18.4v11.2c0 .9.98 1.45 1.74.97l8.6-5.6a1.15 1.15 0 0 0 0-1.94l-8.6-5.6a1.13 1.13 0 0 0-1.74.97Z"
        className="fill-ink-1 transition-[fill,filter] duration-200 group-hover:fill-brand group-hover:[filter:drop-shadow(0_0_6px_var(--brand))]"
      />
    </svg>
  );
}
