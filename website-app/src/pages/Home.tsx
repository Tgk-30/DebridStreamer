import Hero from '@/pages/home/Hero';
import ProofStrip from '@/pages/home/ProofStrip';
import Showcase from '@/pages/home/Showcase';
import FeaturesBento from '@/pages/home/FeaturesBento';
import DownloadTeaser from '@/pages/home/DownloadTeaser';
import SelfHostTeaser from '@/pages/home/SelfHostTeaser';
import HouseholdTeaser from '@/pages/home/HouseholdTeaser';
import FinalCta from '@/pages/home/FinalCta';

/**
 * Home - `/`
 * Hero (Ring Gate 3D + video) → Proof strip → Product showcase (pinned) →
 * Features bento → Download teaser → Self-host teaser → Household teaser →
 * Final CTA. Pin budget: 120vh (hero) + 200vh (showcase).
 */
export default function Home() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <Showcase />
      <FeaturesBento />
      <DownloadTeaser />
      <SelfHostTeaser />
      <HouseholdTeaser />
      <FinalCta />
    </>
  );
}
