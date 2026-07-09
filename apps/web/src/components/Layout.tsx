import { type FC, useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { WalletButton } from './WalletButton';
import { CommandPalette } from './CommandPalette';
import { ThemeSwitcher } from './ThemeSwitcher';
import { SfxToggle } from './SfxToggle';
import { HelpOverlay } from './HelpOverlay';
import { blip } from '../lib/sfx';
import { fetchTokenOverview } from '../lib/birdeye';
import { formatPrice } from '../lib/format';
import * as api from '../lib/api';

interface TickerItem {
  symbol: string;
  address: string;
  price: string;
  change: string;
  up: boolean;
  key: string;
}

const NAV_TABS = [
  { to: '/trade', label: 'Trade', key: '1' },
  { to: '/explore', label: 'Explorer', key: '2' },
  { to: '/screener', label: 'Screener', key: '3' },
  { to: '/list', label: 'List Token', key: '4' },
  { to: '/portfolio', label: 'Holdings', key: '5' },
  { to: '/locks', label: 'Locks', key: '6' },
  { to: '/stats', label: 'Stats', key: '7' },
  { to: '/docs', label: 'Docs', key: '8' },
  { to: '/account', label: 'Account', key: '9' },
];

/** Live UTC clock — the terminal heartbeat */
const UtcClock: FC = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  return (
    <span className="top-nav-clock">
      <span className="nav-live-dot" />
      <span>SOL·MAINNET</span>
      <b>{hh}:{mm}:{ss} UTC</b>
    </span>
  );
};

export const Layout: FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isTradePage = location.pathname === '/trade';
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [tickerHidden, setTickerHidden] = useState(false);
  const tickerLoaded = useRef(false);

  // Number-key page jumps (1-8) when not typing in a field
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const tab = NAV_TABS.find((t) => t.key === e.key);
      if (tab) { blip('click'); navigate(tab.to); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  // Fetch listed tokens from API, then enrich with Birdeye prices
  useEffect(() => {
    if (tickerLoaded.current) return;
    tickerLoaded.current = true;

    const loadTicker = async () => {
      try {
        const listedTokens = await api.getListedTokens(15);

        if (!listedTokens || listedTokens.length === 0) {
          setTickerHidden(true);
          return;
        }

        setTickerHidden(false);

        const results = await Promise.allSettled(
          listedTokens.map(t => fetchTokenOverview(t.address))
        );

        const items: TickerItem[] = [];
        results.forEach((result, i) => {
          const token = listedTokens[i];
          if (result.status === 'fulfilled' && result.value) {
            const d = result.value;
            items.push({
              symbol: `$${token.symbol || d.symbol}`,
              address: token.address,
              price: formatPrice(d.price),
              change: (d.priceChange24h ?? 0).toFixed(1),
              up: (d.priceChange24h ?? 0) >= 0,
              key: token.address,
            });
          } else {
            items.push({
              symbol: `$${token.symbol || '???'}`,
              address: token.address,
              price: token.priceUsd ? formatPrice(token.priceUsd) : '--',
              change: token.priceChange24hPct != null ? token.priceChange24hPct.toFixed(1) : '0.0',
              up: (token.priceChange24hPct ?? 0) >= 0,
              key: token.address,
            });
          }
        });

        if (items.length > 0) setTickerItems(items);
        else setTickerHidden(true);
      } catch {
        setTickerHidden(true);
      }
    };

    loadTicker();

    const interval = setInterval(() => {
      tickerLoaded.current = false;
      loadTicker();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <CommandPalette />
      <HelpOverlay />

      {/* ── Terminal Status Bar ─────────────────── */}
      <nav className="top-nav">
        <NavLink to="/" className="top-nav-logo">
          <img src="/front-logo.png" alt="Front" width="20" height="20" />
          <span>FRONT_</span>
        </NavLink>

        <div className="top-nav-tabs">
          {NAV_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}
            >
              <span className="tab-key">{tab.key}</span>
              {tab.label}
            </NavLink>
          ))}
        </div>

        <div className="top-nav-right">
          <ThemeSwitcher />
          <SfxToggle />
          <UtcClock />
          <WalletButton />
        </div>
      </nav>

      {/* ── LED Ticker Tape ────────────────────── */}
      {!tickerHidden && (
        <div className="ticker-bar">
          {tickerItems.length > 0 ? (
            <div style={{
              display: 'flex',
              animation: 'ticker-scroll 40s linear infinite',
              willChange: 'transform',
            }}>
              {['-a', '-b'].map(suffix =>
                tickerItems.map(t => (
                  <div
                    className="ticker-item"
                    key={t.key + suffix}
                    onClick={() => navigate(`/trade?token=${t.address}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="ticker-name">{t.symbol}</span>
                    <span className="ticker-price">${t.price}</span>
                    <span className={`ticker-change ${t.up ? 'ticker-change-up' : 'ticker-change-down'}`}>
                      {t.up ? '▲' : '▼'}{t.change}%
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div style={{
              display: 'flex',
              animation: 'ticker-scroll 40s linear infinite',
              willChange: 'transform',
              opacity: 0.3,
            }}>
              {Array.from({ length: 20 }).map((_, i) => (
                <div className="ticker-item" key={`skel-${i}`}>
                  <span className="ticker-name" style={{ width: 40, height: 10, background: 'var(--bg-3)', display: 'inline-block' }} />
                  <span className="ticker-price" style={{ width: 50, height: 10, background: 'var(--bg-2)', display: 'inline-block' }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Content ────────────────────────────── */}
      <div className="main-content">
        {isTradePage ? (
          <Outlet />
        ) : (
          <div className="page-content">
            <Outlet />
          </div>
        )}
      </div>
    </>
  );
};
