import Hero from '@/pages/household/Hero';
import ProfilesGrid from '@/pages/household/ProfilesGrid';
import KidsDial from '@/pages/household/KidsDial';
import RequestFlow from '@/pages/household/RequestFlow';
import ClosingCta from '@/pages/household/ClosingCta';

/**
 * Household - `/household`
 * Hero (living-room art + video) → Profiles grid → Kids & maturity
 * (interactive rating dial + parental lock) → Title requests (review flow
 * demo) → Closing CTA. No WebGL here - budget goes to the two demos.
 */
export default function Household() {
  return (
    <>
      <Hero />
      <ProfilesGrid />
      <KidsDial />
      <RequestFlow />
      <ClosingCta />
    </>
  );
}
