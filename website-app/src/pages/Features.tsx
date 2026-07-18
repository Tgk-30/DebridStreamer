import { Fragment, useEffect } from 'react';
import type { ComponentType } from 'react';
import FeaturesHero from '@/pages/features/Hero';
import ChapterNav, { scrollToChapter } from '@/pages/features/ChapterNav';
import { CHAPTERS, Chapter } from '@/pages/features/shared';
import DiscoverDemo from '@/pages/features/DiscoverDemo';
import PrivacyDemo from '@/pages/features/PrivacyDemo';
import ProfilesDemo from '@/pages/features/ProfilesDemo';
import PlaybackDemo from '@/pages/features/PlaybackDemo';
import PlayerDemo from '@/pages/features/PlayerDemo';
import SeriesDemo from '@/pages/features/SeriesDemo';
import SubtitlesDemo from '@/pages/features/SubtitlesDemo';
import ContinueDemo from '@/pages/features/ContinueDemo';
import ClosingCta from '@/pages/features/ClosingCta';

const DEMOS: Record<string, ComponentType> = {
  discover: DiscoverDemo,
  privacy: PrivacyDemo,
  profiles: ProfilesDemo,
  playback: PlaybackDemo,
  player: PlayerDemo,
  series: SeriesDemo,
  subtitles: SubtitlesDemo,
  continue: ContinueDemo,
};

/**
 * Features - the core product features as scroll-driven cinematic chapters with
 * interactive demos + the Provider Constellation 3D scene (Playback).
 */
export default function Features() {
  /* honor deep links (/features#player) once the page has laid out */
  useEffect(() => {
    const id = window.location.hash.replace('#', '');
    if (!id || !CHAPTERS.some((c) => c.id === id)) return;
    const t = window.setTimeout(() => scrollToChapter(id), 450);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      <FeaturesHero />

      <div className="relative">
        <ChapterNav />

        <div className="mx-auto max-w-content px-6 pb-[clamp(88px,12vw,152px)] pt-14 md:px-10">
          {CHAPTERS.map((c, i) => {
            const Demo = DEMOS[c.id];
            return (
              <Fragment key={c.id}>
                {i > 0 && (
                  <div className="flex h-24 items-center" aria-hidden="true">
                    <div className="signal-divider w-full" />
                  </div>
                )}
                <Chapter index={i + 1} {...c}>
                  <Demo />
                </Chapter>
              </Fragment>
            );
          })}
        </div>
      </div>

      <ClosingCta />
    </>
  );
}
