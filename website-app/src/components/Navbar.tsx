import { useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Github, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GITHUB_REPO } from '@/lib/site';
import RingMark from '@/components/RingMark';
import ThemePicker from '@/components/ThemePicker';
import { PrimaryButton } from '@/components/Buttons';

const EASE_EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/download', label: 'Download' },
  { to: '/self-host', label: 'Self-host' },
  { to: '/devices', label: 'Devices' },
  { to: '/household', label: 'Household' },
];

/**
 * Navbar - fixed floating pill (Layout owns the top offset for pages).
 * Contracts on scroll > 40px; active route gets a brand underline dot.
 */
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const reduced = useReducedMotion();
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const menuButton = menuButtonRef.current;
    const background = [headerRef.current, document.querySelector('main'), document.querySelector('footer')].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    background.forEach((element) => element.toggleAttribute('inert', true));

    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[data-menu-close]')?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !menuRef.current) return;

      const focusable = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      background.forEach((element) => element.toggleAttribute('inert', false));
      document.body.style.overflow = previousOverflow;
      menuButton?.focus();
    };
  }, [menuOpen]);

  return (
    <>
      <motion.header
        ref={headerRef}
        initial={reduced ? { opacity: 0 } : { y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: reduced ? 0.15 : 0.5, ease: EASE_EXPO, delay: reduced ? 0 : 0.2 }}
        className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
      >
        <nav
          className={cn(
            'flex w-full max-w-[1120px] items-center gap-3 rounded-chip border border-line backdrop-blur-[18px]',
            'transition-[padding,background-color,box-shadow] duration-300 ease-expo',
            scrolled ? 'bg-[var(--surface-glass-2)] px-5 py-2 shadow-card' : 'bg-[var(--surface-glass)] px-5 py-3',
          )}
          aria-label="Main navigation"
        >
          <Link to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="YAWF Stream - home">
            <RingMark size={30} />
            <span className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-ink-1">
              YAWF <span className="text-brand">Stream</span>
            </span>
          </Link>

          <div className="mx-auto hidden items-center gap-1 lg:flex">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'relative rounded-full px-3.5 py-2 font-body text-[0.9rem] transition-colors duration-150',
                    isActive ? 'text-ink-1' : 'text-ink-2 hover:text-ink-1',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {link.label}
                    {isActive && (
                      <span className="absolute -bottom-[2px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand shadow-glow-brand" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <ThemePicker />
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              aria-label="YAWF Stream on GitHub"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-[var(--surface-glass)] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-brand"
            >
              <Github className="h-4 w-4" />
            </a>
            <PrimaryButton to="/download" playIcon={false} magnetic={false} className="hidden px-[18px] py-[10px] text-[0.85rem] md:inline-flex">
              Get the app
            </PrimaryButton>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation-dialog"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-[var(--surface-glass)] text-ink-1 lg:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </nav>
      </motion.header>

      {/* Mobile navigation dialog. */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            ref={menuRef}
            id="mobile-navigation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            initial={reduced ? { opacity: 0 } : { clipPath: 'circle(0% at calc(100% - 48px) 44px)' }}
            animate={reduced ? { opacity: 1 } : { clipPath: 'circle(150% at calc(100% - 48px) 44px)' }}
            exit={reduced ? { opacity: 0 } : { clipPath: 'circle(0% at calc(100% - 48px) 44px)' }}
            transition={{ duration: reduced ? 0.15 : 0.45, ease: EASE_EXPO }}
            className="fixed inset-0 z-[60] flex flex-col justify-center bg-[rgba(var(--bg-0-rgb),0.95)] px-8 backdrop-blur-xl lg:hidden"
          >
            <button
              type="button"
              data-menu-close
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute right-6 top-6 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-[var(--surface-glass)] text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <X className="h-5 w-5" />
            </button>
            <nav aria-label="Mobile navigation" className="flex flex-col gap-2">
              {[...LINKS, { to: '/brand', label: 'Brand' }].map((link, i) => (
                <motion.div
                  key={link.to}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.12 + i * 0.06 }}
                >
                  <NavLink
                    to={link.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      cn('display-m block py-2 font-display', isActive ? 'text-brand' : 'text-ink-1')
                    }
                  >
                    {link.label}
                  </NavLink>
                </motion.div>
              ))}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE_EXPO, delay: 0.12 + 6 * 0.06 }}
                className="mt-6"
              >
                <PrimaryButton to="/download" onClick={() => setMenuOpen(false)}>Get the app</PrimaryButton>
              </motion.div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
