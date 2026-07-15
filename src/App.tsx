import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, useParams, useLocation, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { Icon } from './ui';
import Trips from './pages/Trips';
import Setup from './pages/Setup';
import Schedule from './pages/Schedule';
import Itinerary from './pages/Itinerary';
import Missions from './pages/Missions';
import Live from './pages/Live';
import Gallery from './pages/Gallery';

const TABS = [
  { key: 'live', label: '지금', icon: 'near_me', path: (id: string) => `/trip/${id}/live` },
  { key: 'itinerary', label: '일정', icon: 'event_note', path: (id: string) => `/trip/${id}` },
  { key: 'missions', label: '미션', icon: 'flag', path: (id: string) => `/trip/${id}/missions`, gameOnly: true },
  { key: 'gallery', label: '갤러리', icon: 'photo_library', path: (id: string) => `/trip/${id}/gallery` },
  { key: 'setup', label: '구성', icon: 'groups', path: (id: string) => `/trip/${id}/setup` },
];

function BottomTabs() {
  const { id } = useParams();
  const loc = useLocation();
  const trip = useLiveQuery(() => (id ? db.trips.get(Number(id)) : undefined), [id]);
  if (!id) return null;
  const tabs = TABS.filter((t) => !t.gameOnly || trip?.mode === 'game');
  const active = loc.pathname.endsWith('/live')
    ? 'live'
    : loc.pathname.endsWith('/missions')
      ? 'missions'
      : loc.pathname.endsWith('/gallery')
        ? 'gallery'
        : loc.pathname.endsWith('/setup')
          ? 'setup'
          : 'itinerary';
  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[520px] bg-surface border-t border-outline-variant/30 z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around items-center h-16">
        {tabs.map((t) => (
          <Link
            key={t.key}
            to={t.path(id)}
            className={`flex flex-col items-center justify-center gap-0.5 w-full h-full ${
              active === t.key ? 'text-primary-container' : 'text-tertiary'
            }`}
          >
            <Icon name={t.icon} fill={active === t.key} />
            <span className="text-[11px] font-medium">{t.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

function TripLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BottomTabs />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Trips />} />
        <Route path="/trip/:id" element={<TripLayout><Itinerary /></TripLayout>} />
        <Route path="/trip/:id/setup" element={<TripLayout><Setup /></TripLayout>} />
        <Route path="/trip/:id/schedule" element={<TripLayout><Schedule /></TripLayout>} />
        <Route path="/trip/:id/missions" element={<TripLayout><Missions /></TripLayout>} />
        <Route path="/trip/:id/live" element={<TripLayout><Live /></TripLayout>} />
        <Route path="/trip/:id/gallery" element={<TripLayout><Gallery /></TripLayout>} />
      </Routes>
    </BrowserRouter>
  );
}
