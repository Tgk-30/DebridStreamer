import { Github } from 'lucide-react';
import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { GITHUB_REPO } from '@/lib/site';

export default function FinalCta() {
  return (
    <section className="bg-bg-1 py-[clamp(84px,10vw,132px)]">
      <div className="mx-auto max-w-[880px] px-6 text-center md:px-10">
        <p className="eyebrow">Ready when you are</p>
        <h2 className="mt-5 font-display text-[clamp(2.6rem,5vw,4.7rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-ink-1">
          Your server. Your streams. Your rules.
        </h2>
        <p className="mx-auto mt-6 max-w-[620px] text-lg leading-8 text-ink-2">
          Start with the desktop app, connect the accounts you already use, and keep your viewing experience private.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <PrimaryButton to="/download">Download YAWF Stream</PrimaryButton>
          <GhostButton href={GITHUB_REPO} playIcon={false}>
            <Github className="h-4 w-4" />
            GitHub
          </GhostButton>
        </div>
      </div>
    </section>
  );
}
