import Hero from '@/pages/self-host/Hero';
import HubSection from '@/pages/self-host/HubSection';
import DeployTabs from '@/pages/self-host/DeployTabs';
import TrustDiagram from '@/pages/self-host/TrustDiagram';
import Handoff from '@/pages/self-host/Handoff';
import ClosingCta from '@/pages/self-host/ClosingCta';

/**
 * Self-host - `/self-host`
 * Hero (nebula video) → Server Core 3D + what the server owns →
 * Deploy paths (tabs) → Security model (trust diagram) →
 * Desktop handoff (QR) → Closing CTA.
 * One WebGL scene (Server Core); everything else is DOM/SVG.
 */
export default function SelfHost() {
  return (
    <>
      <Hero />
      <HubSection />
      <DeployTabs />
      <TrustDiagram />
      <Handoff />
      <ClosingCta />
    </>
  );
}
