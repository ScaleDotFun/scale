import { type FC, useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { WalletButton } from './WalletButton';
import { fetchTokenOverview, type TokenOverview } from '../lib/birdeye';
import { formatPrice } from '../lib/format';

// Top Solana meme tokens to show in ticker
const TICKER_TOKENS = [
  { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: '$WIF' },
  { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: '$BONK' },
  { address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', symbol: '$POPCAT' },
  { address: 'A98UDy7z8MfmWnTQt6cKjje7UfqV3pTLf4yEbuwL2HrH', symbol: '$MOODENG' },
  { address: 'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', symbol: '$BOME' },
  { address: '7atgF8KQo4wJrD5ATGX7t1V2zVvykPJbFfNeVf1icFv1', symbol: '$CATWIFHAT' },
  { address: 'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', symbol: '$MEW' },
  { address: '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', symbol: '$PNUT' },
  { address: '3S8qX1MsMqRbiwKg2cQyx7nis1oHMgaCuc9c4VfvVdPN', symbol: '$MOTHER' },
  { address: '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3', symbol: '$SLERF' },
];

interface TickerItem {
  symbol: string;
  price: string;
  change: string;
  up: boolean;
  key: string;
}

export const Layout: FC = () => {
  const location = useLocation();
  const isTradePage = location.pathname === '/trade';
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const tickerLoaded = useRef(false);

  // Fetch real prices for ticker tokens
  useEffect(() => {
    if (tickerLoaded.current) return;
    tickerLoaded.current = true;

    const loadTicker = async () => {
      const results = await Promise.allSettled(
        TICKER_TOKENS.map(t => fetchTokenOverview(t.address))
      );

      const items: TickerItem[] = [];
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) {
          const d = result.value;
          items.push({
            symbol: TICKER_TOKENS[i].symbol,
            price: formatPrice(d.price),
            change: (d.priceChange24h ?? 0).toFixed(1),
            up: (d.priceChange24h ?? 0) >= 0,
            key: TICKER_TOKENS[i].address,
          });
        }
      });

      if (items.length > 0) setTickerItems(items);
    };

    loadTicker();

    // Refresh every 60s
    const interval = setInterval(() => {
      tickerLoaded.current = false;
      loadTicker();
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {/* ── Horizontal Top Nav ──────────────────── */}
      <nav className="top-nav">
        <NavLink to="/" className="top-nav-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span>FRONT</span>
        </NavLink>

        <div className="top-nav-tabs">
          <NavLink to="/trade" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Trade
          </NavLink>
          <NavLink to="/explore" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Explorer
          </NavLink>
          <NavLink to="/portfolio" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Holdings
          </NavLink>
          <NavLink to="/locks" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Locks
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Stats
          </NavLink>
          <NavLink to="/docs" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Docs
          </NavLink>
          <NavLink to="/creator" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Creators
          </NavLink>
          <NavLink to="/list" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            List Token
          </NavLink>
        </div>

        <div className="top-nav-right">
          <WalletButton />
        </div>
      </nav>

      {/* ── Ticker Bar ─────────────────────────── */}
      <div className="ticker-bar">
        {tickerItems.length > 0 ? (
          <div style={{
            display: 'flex',
            animation: 'ticker-scroll 40s linear infinite',
            willChange: 'transform',
          }}>
            {['-a', '-b'].map(suffix =>
              tickerItems.map(t => (
                <div className="ticker-item" key={t.key + suffix}>
                  <span className="ticker-name">{t.symbol}</span>
                  <span className="ticker-price">${t.price}</span>
                  <span className={`ticker-change ${t.up ? 'ticker-change-up' : 'ticker-change-down'}`}>
                    {t.up ? '+' : ''}{t.change}%
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
                <span className="ticker-name" style={{ width: 40, height: 10, background: '#111', borderRadius: 3, display: 'inline-block' }} />
                <span className="ticker-price" style={{ width: 50, height: 10, background: '#0a0a0a', borderRadius: 3, display: 'inline-block' }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ────────────────────────────── */}
      <div className={isTradePage ? 'main-content' : 'main-content'}>
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

