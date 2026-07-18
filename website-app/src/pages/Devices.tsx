import Hero from '@/pages/devices/Hero';
import Constellation from '@/pages/devices/Constellation';
import InstallFlows from '@/pages/devices/InstallFlows';
import ScreensGallery from '@/pages/devices/ScreensGallery';
import HandoffStrip from '@/pages/devices/HandoffStrip';
import ClosingCta from '@/pages/devices/ClosingCta';

/**
 * Devices - `/devices`
 * "Every screen in the house." Hero → device constellation (interactive SVG
 * diagram) → install flows per platform → real-screens gallery → QR handoff → CTA.
 * No WebGL - the constellation is DOM/SVG and the gallery tilt is transform-only.
 */
export default function Devices() {
  return (
    <>
      <Hero />
      <Constellation />
      <InstallFlows />
      <ScreensGallery />
      <HandoffStrip />
      <ClosingCta />
    </>
  );
}
