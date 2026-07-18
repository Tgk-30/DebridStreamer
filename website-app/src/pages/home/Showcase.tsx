import { CalendarDays, Play, Users } from 'lucide-react';
import DeviceFrame from '@/components/DeviceFrame';
import SectionHeading from '@/components/SectionHeading';

const STEPS = [
  {
    icon: Play,
    title: 'Find something and press play',
    text: 'Search one catalog, compare available sources, and start a cached stream without jumping between apps.',
  },
  {
    icon: Users,
    title: 'Keep every profile personal',
    text: 'Watchlists, history, resume points, colors, and viewing limits stay separate for every person in the house.',
  },
  {
    icon: CalendarDays,
    title: 'Know what is coming next',
    text: 'Follow upcoming episodes and movie releases in a calendar that is easy to scan on any screen.',
  },
];

export default function Showcase() {
  return (
    <section id="showcase" className="border-b border-line py-[clamp(84px,10vw,132px)]">
      <div className="mx-auto grid max-w-content items-center gap-14 px-6 md:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-20">
        <div>
          <DeviceFrame
            variant="tablet"
            src="/debridstreamer/discover-tablet.png"
            alt="YAWF Stream library on a tablet"
            glow={false}
            reflect={false}
          />
        </div>

        <div>
          <SectionHeading
            eyebrow="The product"
            title="One place for the way you watch."
            lede="YAWF Stream keeps the experience focused on your library, not on settings, badges, or technical noise."
          />

          <div className="mt-10 divide-y divide-line border-y border-line">
            {STEPS.map(({ icon: Icon, title, text }) => (
              <div key={title} className="grid grid-cols-[36px_1fr] gap-4 py-6">
                <Icon className="mt-1 h-5 w-5 text-brand" strokeWidth={1.7} />
                <div>
                  <h3 className="font-display text-lg font-semibold text-ink-1">{title}</h3>
                  <p className="mt-2 text-[0.95rem] leading-7 text-ink-2">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
