import { Link } from 'react-router';
import { GITHUB_DOCKER, GITHUB_ISSUES, GITHUB_RELEASES, GITHUB_REPO } from '@/lib/site';
import RingMark from '@/components/RingMark';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { label: 'Features', to: '/features' },
      { label: 'Download', to: '/download' },
      { label: 'Devices', to: '/devices' },
      { label: 'Household', to: '/household' },
    ],
  },
  {
    heading: 'Self-host',
    links: [
      { label: 'Guide', to: '/self-host' },
      { label: 'Docker', to: GITHUB_DOCKER, external: true },
      { label: 'Releases', to: GITHUB_RELEASES, external: true },
    ],
  },
  {
    heading: 'Project',
    links: [
      { label: 'Source', to: GITHUB_REPO, external: true },
      { label: 'Issues', to: GITHUB_ISSUES, external: true },
    ],
  },
];

function FooterLink({ label, to, external }: { label: string; to: string; external?: boolean }) {
  const classes = 'text-sm text-ink-2 transition-colors hover:text-ink-1';
  return external ? (
    <a href={to} target="_blank" rel="noreferrer" className={classes}>
      {label}
    </a>
  ) : (
    <Link to={to} className={classes}>
      {label}
    </Link>
  );
}

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-bg-0">
      <div className="mx-auto max-w-content px-6 py-14 md:px-10">
        <div className="grid gap-12 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5" aria-label="YAWF Stream home">
              <RingMark size={30} static />
              <span className="font-display text-lg font-semibold text-ink-1">
                YAWF <span className="text-brand">Stream</span>
              </span>
            </Link>
            <p className="mt-4 max-w-[300px] text-sm leading-6 text-ink-2">
              A private streaming hub for the services you already use.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="text-sm font-semibold text-ink-1">{column.heading}</p>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <FooterLink {...link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-sm text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© YAWF Stream</p>
          <p>MIT licensed and self-hosted</p>
        </div>
      </div>
    </footer>
  );
}
