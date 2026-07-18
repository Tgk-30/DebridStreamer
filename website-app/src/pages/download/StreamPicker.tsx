import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AppWindow, Apple, Smartphone, Terminal } from 'lucide-react';
import BackgroundVideo from '@/components/BackgroundVideo';
import StreamRow from '@/components/StreamRow';
import type { StreamRowMeta } from '@/components/StreamRow';
import { DOWNLOAD_LINKS, GITHUB_RELEASES_LATEST, VERSION } from '@/lib/site';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];
interface PickerRow {
  icon: ReactNode;
  title: string;
  meta: StreamRowMeta[];
  size?: string;
  href: string;
}

const ROWS: PickerRow[] = [
  {
    icon: <Apple className="h-5 w-5" />,
    title: 'macOS - Apple Silicon',
    meta: [
      { label: 'Direct download', variant: 'instant' },
      { label: 'notarized', variant: 'dim' },
    ],
    size: '.dmg',
    href: DOWNLOAD_LINKS.macosArm,
  },
  {
    icon: <Apple className="h-5 w-5" />,
    title: 'macOS - Intel',
    meta: [
      { label: 'Direct download', variant: 'instant' },
      { label: 'notarized', variant: 'dim' },
    ],
    size: '.dmg',
    href: DOWNLOAD_LINKS.macosIntel,
  },
  {
    icon: <AppWindow className="h-5 w-5" />,
    title: 'Windows installer',
    meta: [
      { label: 'Direct download', variant: 'instant' },
      { label: 'signed updater', variant: 'dim' },
    ],
    size: '.msi',
    href: DOWNLOAD_LINKS.windowsMsi,
  },
  {
    icon: <Terminal className="h-5 w-5" />,
    title: 'Linux - AppImage',
    meta: [
      { label: 'Direct download', variant: 'instant' },
      { label: 'portable', variant: 'dim' },
    ],
    size: 'amd64',
    href: DOWNLOAD_LINKS.linuxAppImage,
  },
  {
    icon: <Smartphone className="h-5 w-5" />,
    title: 'iPhone · iPad · Android - PWA',
    meta: [
      { label: 'served by your server', variant: 'dim' },
      { label: 'no app store', variant: 'dim' },
    ],
    size: 'install',
    href: '/devices',
  },
];

/**
 * Download section: platform packages presented as the app's stream list.
 */
export default function StreamPicker() {
  const reduced = useReducedMotion();

  return (
    <section className="relative overflow-hidden py-[clamp(88px,12vw,152px)]">
      {/* sonar stream-rings band behind the picker */}
      <BackgroundVideo src="/debridstreamer/streamrings-loop.mp4" poster="/debridstreamer/streamrings-poster.jpg" opacity={0.2} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, var(--bg-0) 0%, color-mix(in srgb, var(--bg-0) 55%, transparent) 50%, var(--bg-0) 100%)',
        }}
      />

      <div className="relative mx-auto max-w-[880px] px-6 md:px-10">
        {/* signal-trace hairline plugging the hero into the list */}
        <motion.span
          aria-hidden="true"
          className="mx-auto -mt-[clamp(44px,6vw,76px)] mb-[clamp(44px,6vw,76px)] block h-16 w-px origin-top"
          style={{ backgroundImage: 'linear-gradient(180deg, transparent, var(--brand))' }}
          initial={{ scaleY: reduced ? 1 : 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, amount: 0.9 }}
          transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO }}
        />

        {/* Honest release summary, without simulated cache or agent status. */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO }}
          className="glass-panel flex flex-col items-start justify-between gap-2 rounded-row px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
        >
          <p className="font-mono text-[0.8125rem] tracking-[0.04em] text-ink-2">
            Choose your platform <span className="text-brand">{VERSION}</span>
          </p>
          <a
            href={GITHUB_RELEASES_LATEST}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-mono text-[0.75rem] tracking-[0.04em] text-ink-3 transition-colors hover:text-brand"
          >
            All release files
          </a>
        </motion.div>

        {/* the platform stream rows */}
        <div className="mt-4 flex flex-col gap-3">
          {ROWS.map((row, i) => (
            <motion.div
              key={row.title}
              className="relative"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 80 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: reduced ? 0.2 : 0.6, ease: EASE_EXPO, delay: i * 0.12 }}
            >
              <StreamRow
                icon={row.icon}
                title={row.title}
                meta={row.meta}
                size={row.size}
                href={row.href}
                className="active:scale-[0.98]"
              />
              {i === 0 && (
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-left rounded-full"
                  style={{ backgroundImage: 'var(--grad-stream)' }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  whileInView={{ scaleX: [0, 1, 1], opacity: [0, 1, 0] }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ duration: 0.9, ease: EASE_EXPO, delay: reduced ? 0 : 0.7, times: [0, 0.85, 1] }}
                />
              )}
            </motion.div>
          ))}
        </div>

        <motion.p
          className="mt-6 text-center font-mono text-[0.8125rem] leading-relaxed tracking-[0.04em] text-ink-3"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: reduced ? 0 : 0.5 }}
        >
          Builds are published on GitHub Releases. View the{' '}
          <a
            href={GITHUB_RELEASES_LATEST}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-line bg-[var(--surface-glass)] px-1.5 py-0.5 text-brand transition-colors hover:border-line-strong"
          >
            latest release
          </a>
          .
        </motion.p>
      </div>
    </section>
  );
}
