import { useState } from 'react';
import BrandHero from '@/pages/brand/BrandHero';
import ThemePlayground from '@/pages/brand/ThemePlayground';
import type { PlaygroundKey } from '@/pages/brand/ThemePlayground';
import TokenTables from '@/pages/brand/TokenTables';
import TypographySection from '@/pages/brand/TypographySection';
import LogoSection from '@/pages/brand/LogoSection';
import VoiceSection from '@/pages/brand/VoiceSection';
import RebrandSection from '@/pages/brand/RebrandSection';
import ClosingCta from '@/pages/brand/ClosingCta';
import { ToastHost } from '@/pages/brand/shared';
import '@/pages/brand/brand.css';

/**
 * Brand - `/brand`
 * Hero → Live theme playground → Color tokens → Typography → Logo & mark →
 * Voice → "Rebrand in one file" → CTA. The `highlight` state wires the
 * config-snippet keys to their playground controls (bi-directional glow).
 */
export default function Brand() {
  const [highlight, setHighlight] = useState<PlaygroundKey | null>(null);

  return (
    <>
      <BrandHero />
      <ThemePlayground highlight={highlight} onHighlight={setHighlight} />
      <TokenTables />
      <TypographySection />
      <LogoSection />
      <VoiceSection />
      <RebrandSection highlight={highlight} onHighlight={setHighlight} />
      <ClosingCta />
      <ToastHost />
    </>
  );
}
