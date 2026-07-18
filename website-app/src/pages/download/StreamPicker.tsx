import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { AppWindow, Apple, Check, ChevronDown, Smartphone, Terminal } from 'lucide-react';
import BackgroundVideo from '@/components/BackgroundVideo';
import StreamRow from '@/components/StreamRow';
import type { StreamRowMeta } from '@/components/StreamRow';
import { DOWNLOAD_LINKS, GITHUB_RELEASES_LATEST } from '@/lib/site';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];
const CHECKING = 'checking caches…';
const FOUND = '5 sources found - all instant ✓';

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
      { label: 'Instant', variant: 'instant' },
      { label: 'notarized', variant: 'dim' },
    ],
    size: '.dmg',
    href: DOWNLOAD_LINKS.macos,
  },
  {
    icon: <Apple className="h-5 w-5" />,
    title: 'macOS - Intel',
    meta: [
      { label: 'Instant', variant: 'instant' },
      { label: 'notarized', variant: 'dim' },
    ],
    size: '.dmg',
    href: GITHUB_RELEASES_LATEST,
  },
  {
    icon: <AppWindow className="h-5 w-5" />,
    title: 'Windows installer',
    meta: [
      { label: 'Instant', variant: 'instant' },
      { label: 'signed updater', variant: 'dim' },
    ],
    size: '.msi',
    href: DOWNLOAD_LINKS.windows,
  },
  {
    icon: <Terminal className="h-5 w-5" />,
    title: 'Linux - AppImage / .deb',
    meta: [
      { label: 'Instant', variant: 'instant' },
      { label: 'signed updater', variant: 'dim' },
    ],
    size: 'amd64',
    href: DOWNLOAD_LINKS.linux,
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

/** Types `checking caches…` once (34 chars/s), holds 800ms, then flips to the found status. */
function useSourceCheck(active: boolean, reduced: boolean) {
  const [typed, setTyped] = useState(reduced ? CHECKING : '');
  const [done, setDone] = useState(reduced);

  useEffect(() => {
    if (!active || reduced) return;
    let i = 0;
    let finishTimer = 0;
    const typeTimer = window.setInterval(() => {
      i += 1;
      setTyped(CHECKING.slice(0, i));
      if (i >= CHECKING.length) {
        window.clearInterval(typeTimer);
        finishTimer = window.setTimeout(() => setDone(true), 800);
      }
    }, 30);
    return () => {
      window.clearInterval(typeTimer);
      window.clearTimeout(finishTimer);
    };
  }, [active, reduced]);

  return { typed, done };
}

/** Decorative `sort: instant ▾` - the only option is "instant". */
function SortDropdown() {
  const [open, setOpen] = useState(false);

  return (
    <div className="group/sort relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.75rem] tracking-[0.04em] text-ink-3 transition-colors duration-150 hover:text-brand"
      >
        sort: instant
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* hover / focus tooltip (hidden while the menu is open) */}
      {!open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-20 w-56 rounded-card border border-line bg-bg-2 px-3.5 py-2.5 text-right font-mono text-[0.75rem] leading-relaxed tracking-[0.04em] text-ink-2 opacity-0 shadow-card transition-opacity duration-200 group-hover/sort:opacity-100 group-focus-within/sort:opacity-100"
        >
          Everything here is instant. That's the point.
        </span>
      )}

      {open && (
        <>
          <button aria-hidden="true" tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            aria-label="sort order"
            className="absolute right-0 top-[calc(100%+8px)] z-20 w-44 rounded-card border border-line bg-bg-2 p-1.5 shadow-card"
          >
            <button
              type="button"
              role="option"
              aria-selected="true"
              onClick={() => setOpen(false)}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 font-mono text-[0.75rem] tracking-[0.04em] text-brand transition-colors hover:bg-[var(--surface-glass-2)]"
            >
              instant
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Download §2 - The stream picker: downloads presented as the app's own
 * stream list. Source-check header types once; rows cascade from the right.
 */
export default function StreamPicker() {
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const headerInView = useInView(headerRef, { once: true, amount: 0.6 });
  const { typed, done } = useSourceCheck(headerInView, reduced ?? false);

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

        {/* mock source-check header bar */}
        <motion.div
          ref={headerRef}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: reduced ? 0.2 : 0.5, ease: EASE_EXPO }}
          className="glass-panel flex items-center justify-between gap-3 rounded-row px-4 py-3"
        >
          <div className="flex min-w-0 items-center">
            <span className="truncate font-mono text-[0.8125rem] tracking-[0.04em]">
              <span className={done ? 'text-brand' : 'text-ink-2'}>{done ? FOUND : typed}</span>
              {!done && <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-[7px] translate-y-[2px] animate-caret-blink bg-brand" />}
            </span>
          </div>
          <SortDropdown />
        </motion.div>

        {/* the platform stream rows */}
        <div ref={listRef} className="mt-4 flex flex-col gap-3">
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
          All builds live on GitHub Releases - latest is always{' '}
          <a
            href={GITHUB_RELEASES_LATEST}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-line bg-[var(--surface-glass)] px-1.5 py-0.5 text-brand transition-colors hover:border-line-strong"
          >
            releases/latest
          </a>
          .
        </motion.p>
      </div>
    </section>
  );
}
