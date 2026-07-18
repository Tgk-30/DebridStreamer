import Hero from '@/pages/home/Hero';
import Showcase from '@/pages/home/Showcase';
import FeaturesBento from '@/pages/home/FeaturesBento';
import DownloadTeaser from '@/pages/home/DownloadTeaser';
import FinalCta from '@/pages/home/FinalCta';

export default function Home() {
  return (
    <>
      <Hero />
      <Showcase />
      <FeaturesBento />
      <DownloadTeaser />
      <FinalCta />
    </>
  );
}
