import { Outlet } from 'react-router';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

/**
 * App shell (nested-route pattern - renders <Outlet/>, so App.tsx MUST nest
 * page routes inside <Route element={<Layout/>}>).
 *
 * The Navbar is a fixed floating pill; Layout owns the matching top offset
 * (--nav-offset) so every page starts below the nav. Full-bleed heroes opt
 * out inside the page with a matching negative top margin.
 */
export default function Layout() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg-0 font-body text-ink-1">
      <Navbar />
      <main className="flex-1 pt-[var(--nav-offset)]">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
