import { useApp } from './state/store';
import { useNow, useTracking, useWsStatus } from './state/data';
import { go, useRoute } from './router';
import { SESSION_LABEL, marketSession, nyParts } from './lib/market';
import Home from './pages/Home';
import { HoldingsPage, WatchPage } from './pages/Lists';
import Detail from './pages/Detail';
import SettingsPage from './pages/Settings';

const I = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  pf: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  cog: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
};

const TABS = [
  { path: '/', label: 'ホーム', icon: I.home },
  { path: '/holdings', label: '保有', icon: I.pf },
  { path: '/watch', label: 'ウォッチ', icon: I.eye },
  { path: '/settings', label: '設定', icon: I.cog },
];

function TopBar() {
  const now = useNow(1000);
  const session = marketSession(now);
  const ws = useWsStatus();
  const demo = useApp((s) => s.settings.demoMode || !s.settings.finnhubKey || !s.settings.twelveDataKey);
  const ny = nyParts(now);
  const hh = String(Math.floor(ny.minutes / 60)).padStart(2, '0');
  const mm = String(ny.minutes % 60).padStart(2, '0');
  return (
    <header className="topbar">
      <div className="brand"><span className="logo">◆</span>SIGNAL<b>/US</b></div>
      <div className="tb-right">
        <span className={`sess sess-${session}`}><i />{SESSION_LABEL[session]}</span>
        <span className="mono ny">NY {hh}:{mm}</span>
        {!demo && <span className={`ws ws-${ws}`} title={`WebSocket: ${ws}`}>WS</span>}
      </div>
    </header>
  );
}

export default function App() {
  const route = useRoute();
  const holdings = useApp((s) => s.holdings);
  const watch = useApp((s) => s.watchlist);
  const demo = useApp((s) => s.settings.demoMode || !s.settings.finnhubKey || !s.settings.twelveDataKey);
  const detail = route.match(/^\/s\/([A-Z0-9.\-]+)/)?.[1];
  const symbols = Array.from(new Set([...holdings.map((h) => h.symbol), ...watch.map((w) => w.symbol)])).sort();
  useTracking(symbols, detail);

  const tab = detail ? '' : route;
  return (
    <div className="app">
      <TopBar />
      {demo && (
        <button className="demo-banner" onClick={() => go('/settings')}>
          DEMO MODE — 架空データです。売買判断には使えません。<u>API キーを設定</u>
        </button>
      )}
      <main key={route}>
        {detail ? <Detail symbol={detail} />
          : route === '/holdings' ? <HoldingsPage />
          : route === '/watch' ? <WatchPage />
          : route === '/settings' ? <SettingsPage />
          : <Home />}
      </main>
      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.path} className={tab === t.path ? 'on' : ''} onClick={() => go(t.path)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
