import { type FC, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { blip } from '../lib/sfx';

/* ═══════════════════════════════════════════════════════════════
   SCREENER — live Robinhood Chain market wall. Real Birdeye trending data
   through the protocol proxy, refreshed every 30s. Keyboard-first:
   j/k or ↑/↓ to move, enter to open the trade terminal, s to
   cycle sort. LISTED = tradeable with leverage on SCALE.
   ═══════════════════════════════════════════════════════════════ */

type SortKey = 'rank' | 'price' | 'priceChange24h' | 'volume24h' | 'marketCap' | 'liquidity';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'rank', label: '#' },
  { key: 'price', label: 'PRICE' },
  { key: 'priceChange24h', label: '24H' },
  { key: 'volume24h', label: 'VOLUME 24H' },
  { key: 'marketCap', label: 'MCAP' },
  { key: 'liquidity', label: 'LIQUIDITY' },
];

const fmtUsd = (v: number): string => {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtPrice = (v: number): string => {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toPrecision(3)}`;
};

export const Screener: FC = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<api.MarketToken[]>([]);
  const [listed, setListed] = useState<Set<string>>(new Set());
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDesc, setSortDesc] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Live market data — refresh every 30s
  useEffect(() => {
    let dead = false;
    const load = () => {
      api.getMarketTrending()
        .then((data) => {
          if (dead) return;
          setRows(data);
          setUpdatedAt(new Date());
          setState('ready');
        })
        .catch(() => { if (!dead && rows.length === 0) setState('offline'); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { dead = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which of these are listed on SCALE (leveraged trading available)
  useEffect(() => {
    api.getListedTokens(50)
      .then((toks) => setListed(new Set(toks.map((t) => t.address))))
      .catch(() => {});
  }, []);

  const sorted = useMemo(() => {
    const r = [...rows];
    if (sortKey !== 'rank') {
      r.sort((a, b) => {
        const d = (a[sortKey] as number) - (b[sortKey] as number);
        return sortDesc ? -d : d;
      });
    } else if (!sortDesc) {
      r.reverse();
    }
    return r;
  }, [rows, sortKey, sortDesc]);

  // Keyboard: j/k/↑/↓ move · enter trade · s cycle sort
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        blip('click');
        setCursor((c) => Math.min(c + 1, sorted.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        blip('click');
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && sorted[cursor]) {
        blip('confirm');
        navigate(`/trade?token=${sorted[cursor].address}`);
      } else if (e.key === 's') {
        blip('click');
        const i = SORTS.findIndex((s) => s.key === sortKey);
        setSortKey(SORTS[(i + 1) % SORTS.length].key);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sorted, cursor, sortKey, navigate]);

  // Keep cursor row in view
  useEffect(() => {
    tableRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const setSort = (k: SortKey) => {
    blip('click');
    if (k === sortKey) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  };

  return (
    <div className="fade-in scr">
      <div className="scr-head">
        <div>
          <h2>MARKET SCREENER</h2>
          <p className="scr-sub">
            Trending memecoins — live Robinhood Chain feed (GeckoTerminal) · refreshes every 30s ·{' '}
            <span className="text-primary">j/k</span> move · <span className="text-primary">↵</span> trade ·{' '}
            <span className="text-primary">s</span> sort
          </p>
        </div>
        <div className="scr-updated mono">
          {updatedAt ? <><span className="nav-live-dot" /> {updatedAt.toUTCString().slice(17, 25)} UTC</> : '—'}
        </div>
      </div>

      {state === 'offline' ? (
        <div className="rs-offline">
          <span className="rs-offline-tag">[ FEED OFFLINE ]</span>
          <p>The screener shows real market data only. Feed unreachable right now.</p>
        </div>
      ) : (
        <div className="scr-table-wrap" ref={tableRef}>
          <table className="table scr-table">
            <thead>
              <tr>
                {/* Token first — on mobile the leftmost columns are all
                    you see; a price with no symbol is useless */}
                {SORTS.map((s, i) => (
                  <Fragment key={s.key}>
                    <th
                      onClick={() => setSort(s.key)}
                      className={sortKey === s.key ? 'scr-th-active' : ''}
                      style={{ cursor: 'pointer' }}
                    >
                      {s.key === 'rank' ? '#' : s.label}
                      {sortKey === s.key && <span className="scr-sort-dir">{sortDesc ? ' ▼' : ' ▲'}</span>}
                    </th>
                    {i === 0 && <th>TOKEN</th>}
                  </Fragment>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {state === 'loading' && rows.length === 0
                ? Array.from({ length: 12 }).map((_, i) => (
                    <tr key={`sk-${i}`}>
                      <td colSpan={8}><div className="skeleton" style={{ height: 14 }} /></td>
                    </tr>
                  ))
                : sorted.map((t, i) => (
                    <tr
                      key={t.address}
                      data-row={i}
                      className={`scr-row ${i === cursor ? 'scr-row-active' : ''}`}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => navigate(`/trade?token=${t.address}`)}
                    >
                      <td className="text-dim mono">{String(i + 1).padStart(2, '0')}</td>
                      <td>
                        <span className="cell-token">{t.symbol}</span>
                        <span className="scr-name"> {t.name?.slice(0, 24)}</span>
                      </td>
                      <td className="mono">{fmtPrice(t.price)}</td>
                      <td className="mono" style={{ color: t.priceChange24h >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {t.priceChange24h >= 0 ? '+' : ''}{t.priceChange24h.toFixed(1)}%
                      </td>
                      <td className="mono">{fmtUsd(t.volume24h)}</td>
                      <td className="mono">{fmtUsd(t.marketCap)}</td>
                      <td className="mono">{fmtUsd(t.liquidity)}</td>
                      <td>
                        {listed.has(t.address)
                          ? <span className="badge badge-rising">LISTED · LEV</span>
                          : <span className="scr-unlisted">spot only</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
