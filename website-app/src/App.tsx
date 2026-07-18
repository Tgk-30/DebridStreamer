import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import Lenis from 'lenis';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { prefersReducedMotion } from '@/lib/motion';
import { scrollToTop, setLenis } from '@/lib/scroll';
import Layout from '@/components/Layout';
import Home from '@/pages/Home';
import Features from '@/pages/Features';
import Download from '@/pages/Download';
import SelfHost from '@/pages/SelfHost';
import Devices from '@/pages/Devices';
import Household from '@/pages/Household';

/** Resets scroll to top on route change (through Lenis) and re-measures pins. */
function ScrollManager() {
  const { pathname } = useLocation();
  useEffect(() => {
    scrollToTop();
    ScrollTrigger.refresh();
  }, [pathname]);
  return null;
}

export default function App() {
  // Lenis smooth scroll (lerp 0.09) synced with GSAP ScrollTrigger;
  // disabled entirely under prefers-reduced-motion.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const lenis = new Lenis({ lerp: 0.09 });
    setLenis(lenis);
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(raf);
      lenis.destroy();
      setLenis(null);
    };
  }, []);

  return (
    <BrowserRouter basename="/debridstreamer">
      <ScrollManager />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="features" element={<Features />} />
          <Route path="download" element={<Download />} />
          <Route path="self-host" element={<SelfHost />} />
          <Route path="devices" element={<Devices />} />
          <Route path="household" element={<Household />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
