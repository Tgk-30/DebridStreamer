import { ArrowRight, Github } from 'lucide-react';
import DeviceFrame from '@/components/DeviceFrame';
import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { GITHUB_REPO, VERSION } from '@/lib/site';

const TRUST_POINTS = ['Self-hosted', 'No telemetry', 'Open source'];

export default function Hero() {
  return (
    <section className="relative -mt-[var(--nav-offset)] overflow-hidden border-b border-line bg-bg-0 pt-[var(--nav-offset)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 78% 32%, rgba(var(--brand-rgb), 0.12), transparent 34%), radial-gradient(circle at 16% 8%, rgba(var(--accent-rgb), 0.08), transparent 28%)',
        }}
      />

      <div className="relative mx-auto grid min-h-[760px] max-w-content items-center gap-16 px-6 py-24 md:px-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
        <div className="max-w-[640px]">
          <a
            href={`${GITHUB_REPO}/releases/latest`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-ink-2 transition-colors hover:text-brand"
          >
            YAWF Stream {VERSION.replace('-web', '')}
            <ArrowRight className="h-4 w-4" />
          </a>

          <h1
            aria-label="Your Accounts. Watch Freely."
            className="mt-7 font-display text-[clamp(3.4rem,7.4vw,6.8rem)] font-semibold leading-[0.96] tracking-[-0.055em] text-ink-1"
          >
            Your Accounts.
            <span className="mt-2 block text-brand">Watch Freely.</span>
          </h1>

          <p className="mt-7 max-w-[590px] text-[clamp(1.05rem,1.5vw,1.2rem)] leading-8 text-ink-2">
            A private streaming hub for the services you already use. Browse, play, and keep watching from one calm,
            personal library.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PrimaryButton to="/download">Download YAWF Stream</PrimaryButton>
            <GhostButton to="/features" playIcon={false}>See the features</GhostButton>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-2 text-sm text-ink-3" aria-label="Product principles">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>

          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex items-center gap-2 text-sm text-ink-3 transition-colors hover:text-ink-1"
          >
            <Github className="h-4 w-4" />
            View the source on GitHub
          </a>
        </div>

        <div className="relative lg:translate-x-8">
          <DeviceFrame
            variant="desktop"
            src="/debridstreamer/discover-desktop.png"
            alt="YAWF Stream Discover screen"
            glow={false}
            reflect={false}
          />
        </div>
      </div>
    </section>
  );
}
