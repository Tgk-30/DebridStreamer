import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import RingMark from '@/components/RingMark';
import { PrimaryButton } from '@/components/Buttons';

const LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/devices', label: 'Devices' },
  { to: '/household', label: 'Household' },
  { to: '/self-host', label: 'Self-host' },
];

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-[rgba(var(--bg-0-rgb),0.94)] backdrop-blur-md">
      <nav className="mx-auto flex h-[72px] max-w-content items-center gap-6 px-6 md:px-10" aria-label="Main navigation">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="YAWF Stream home">
          <RingMark size={28} static />
          <span className="font-display text-[1.05rem] font-semibold tracking-[-0.02em] text-ink-1">
            YAWF <span className="text-brand">Stream</span>
          </span>
        </Link>

        <div className="ml-auto hidden items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-bg-2 text-ink-1' : 'text-ink-2 hover:text-ink-1',
                )
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-3">
          <PrimaryButton
            to="/download"
            playIcon={false}
            magnetic={false}
            className="hidden px-[18px] py-[11px] text-sm md:inline-flex"
          >
            Download
          </PrimaryButton>
          <button
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink-1 lg:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {menuOpen && (
        <div className="fixed inset-x-0 top-[73px] min-h-[calc(100dvh-73px)] border-b border-line bg-bg-0 px-6 py-8 lg:hidden">
          <nav aria-label="Mobile navigation" className="mx-auto flex max-w-content flex-col">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn('border-b border-line py-5 font-display text-2xl font-semibold', isActive ? 'text-brand' : 'text-ink-1')
                }
              >
                {link.label}
              </NavLink>
            ))}
            <PrimaryButton to="/download" className="mt-8 w-full" magnetic={false}>
              Download YAWF Stream
            </PrimaryButton>
          </nav>
        </div>
      )}
    </header>
  );
}
