import { AppWindow, Apple, ArrowUpRight, Terminal } from 'lucide-react';
import SectionHeading from '@/components/SectionHeading';
import { GITHUB_RELEASES_LATEST } from '@/lib/site';

const DOWNLOADS = [
  { icon: Apple, name: 'macOS', detail: 'Apple Silicon and Intel', format: 'DMG' },
  { icon: AppWindow, name: 'Windows', detail: 'Installer and automatic updates', format: 'EXE / MSI' },
  { icon: Terminal, name: 'Linux', detail: 'AppImage and Debian package', format: 'AppImage / DEB' },
];

export default function DownloadTeaser() {
  return (
    <section className="border-b border-line py-[clamp(84px,10vw,132px)]">
      <div className="mx-auto grid max-w-content gap-14 px-6 md:px-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
        <SectionHeading
          eyebrow="Download"
          title="Choose your screen."
          lede="Signed desktop installers are available now. Phones and tablets connect through the installable PWA from your server."
        />

        <div className="divide-y divide-line border-y border-line">
          {DOWNLOADS.map(({ icon: Icon, name, detail, format }) => (
            <a
              key={name}
              href={GITHUB_RELEASES_LATEST}
              target="_blank"
              rel="noreferrer"
              className="group grid grid-cols-[32px_1fr_auto] items-center gap-4 py-5 transition-colors hover:text-brand"
            >
              <Icon className="h-5 w-5 text-brand" strokeWidth={1.7} />
              <span>
                <span className="block font-display text-lg font-semibold text-ink-1">{name}</span>
                <span className="mt-1 block text-sm text-ink-3">{detail}</span>
              </span>
              <span className="flex items-center gap-3 text-sm text-ink-3">
                <span className="hidden sm:inline">{format}</span>
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
