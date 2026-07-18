import { Captions, Download, MonitorPlay, ShieldCheck, Users, Zap } from 'lucide-react';
import SectionHeading from '@/components/SectionHeading';

const FEATURES = [
  {
    icon: Zap,
    title: 'Fast source selection',
    text: 'See cached sources clearly and choose the quality that fits your screen.',
  },
  {
    icon: MonitorPlay,
    title: 'Built-in playback',
    text: 'Play MKV, HEVC, and 4K in the app, or hand off to VLC and IINA.',
  },
  {
    icon: Users,
    title: 'Household profiles',
    text: 'Give everyone a separate library, history, resume state, and optional lock.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    text: 'Your debrid keys and viewing data stay on infrastructure you control.',
  },
  {
    icon: Captions,
    title: 'Subtitle control',
    text: 'Search OpenSubtitles and adjust size, timing, placement, and appearance.',
  },
  {
    icon: Download,
    title: 'Desktop and mobile',
    text: 'Use native desktop apps and install the PWA on phones and tablets.',
  },
];

export default function FeaturesBento() {
  return (
    <section className="bg-bg-1 py-[clamp(84px,10vw,132px)]">
      <div className="mx-auto max-w-content px-6 md:px-10">
        <SectionHeading
          eyebrow="What matters"
          title="Useful features, without the clutter."
          lede="The controls stay out of the way until you need them. The library and what you are watching stay front and center."
          link={{ to: '/features', label: 'Explore all features' }}
        />

        <div className="mt-14 grid gap-x-10 gap-y-0 border-y border-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <article key={title} className="border-b border-line py-8 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 lg:[&:nth-last-child(-n+3)]:border-b-0">
              <Icon className="h-5 w-5 text-brand" strokeWidth={1.7} />
              <h3 className="mt-5 font-display text-xl font-semibold text-ink-1">{title}</h3>
              <p className="mt-3 max-w-[340px] text-[0.95rem] leading-7 text-ink-2">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
