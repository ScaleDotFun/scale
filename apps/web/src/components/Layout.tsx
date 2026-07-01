import { type FC, useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { WalletButton } from './WalletButton';
import { fetchTokenOverview, type TokenOverview } from '../lib/birdeye';
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

export const Layout: FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isTradePage = location.pathname === '/trade';
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [tickerHidden, setTickerHidden] = useState(false);
  const tickerLoaded = useRef(false);

  // Fetch listed tokens from API, then enrich with Birdeye prices
  useEffect(() => {
    if (tickerLoaded.current) return;
    tickerLoaded.current = true;

    const loadTicker = async () => {
      try {
        // Fetch listed tokens from the protocol API
        const listedTokens = await api.getListedTokens(15);

        if (!listedTokens || listedTokens.length === 0) {
          setTickerHidden(true);
          return;
        }

        setTickerHidden(false);

        // Fetch Birdeye price data for each listed token
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
            // Token listed but no Birdeye data — still show it
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
          <img src="/front-logo.png" alt="Front" width="22" height="22" style={{ borderRadius: 4 }} />
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
          <NavLink to="/account" className={({ isActive }) => `top-nav-tab ${isActive ? 'active' : ''}`}>
            Account
          </NavLink>
        </div>

        <div className="top-nav-right">
          <WalletButton />
        </div>
      </nav>

      {/* ── Ticker Bar ─────────────────────────── */}
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
      )}

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
