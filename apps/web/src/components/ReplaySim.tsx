import { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../lib/api';
import { chartPalette, onThemeChange } from '../lib/theme';
import { blip } from '../lib/sfx';

/* ═══════════════════════════════════════════════════════════════
   REPLAY SIM — leverage against REAL market history.
   Pick a feed, drag your entry on the actual price path, and see
   exactly what the protocol would have done to you. No fake data:
   if the feed is down, the sim says so.
   ═══════════════════════════════════════════════════════════════ */

interface Feed {
  label: string;
  /** Unused on the reference feed — the API picks the top pool itself. */
  address: string;
  ref?: boolean;
}

interface Candle { t: number; o: number; h: number; l: number; c: number }

/* The protocol's own numbers, not the simulator's.

   Each tier's raw exit threshold lives in @loaded/core's TIER_CONFIGS, and the
   closer adds SAFETY_BUFFER_BPS (5%) before comparing — so `autoCloseAt` below
   is the effective figure the monitor actually fires on, and the one a trader
   needs. `maxLeverage` and `feePct` are the same values the open route
   enforces, which is why the sliders stop where they stop.

   This component sits on the landing page under a promise that it replays what
   the protocol would really have done, so anything invented here is a false
   claim about a leveraged financial product. It previously auto-closed at
   -(100/leverage) x 0.85, charged a flat 0.5%, offered 10x and 10 ETH, and
   counted only 70% of a winning trade. None of those were real. */
const TIERS = {
  bonded: { label: 'BONDED', maxLeverage: 7, feePct: 2, autoCloseAt: -10 },
  rising: { label: 'RISING', maxLeverage: 5, feePct: 3, autoCloseAt: -15 },
  degen:  { label: 'DEGEN',  maxLeverage: 3, feePct: 5, autoCloseAt: -25 },
} as const;
type TierKey = keyof typeof TIERS;

/** validatePositionOpen's bounds, in ETH. */
const MIN_COLLATERAL = 0.01;
const MAX_COLLATERAL = 1;
/** MAX_POSITION_DURATION_MS, in 1H candles. */
const MAX_HOURS = 24;


function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(3);
}

export const ReplaySim: FC = () => {
  const [feeds, setFeeds] = useState<Feed[]>([{ label: 'TOP POOL', address: '', ref: true }]);
  const [feedIdx, setFeedIdx] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  // RETRY FEED used to call setFeedIdx((v) => v), which React treats as no
  // change — the button re-rendered and fetched nothing. A transient feed
  // failure was therefore permanent until a full page reload.
  const [reloadTick, setReloadTick] = useState(0);

  const [tier, setTier] = useState<TierKey>('bonded');
  const [collateral, setCollateral] = useState(0.25);
  const [leverage, setLeverage] = useState(5);
  const [entryIdx, setEntryIdx] = useState(40);

  const tierCfg = TIERS[tier];
  // Dialling down a tier has to pull leverage with it — the open route rejects
  // 7x on a degen coin, so offering it here would be offering a rejected trade.
  useEffect(() => {
    setLeverage((l) => Math.min(l, tierCfg.maxLeverage));
  }, [tierCfg.maxLeverage]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const wasLiquidatedRef = useRef(false);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => onThemeChange(() => setThemeTick((v) => v + 1)), []);

  // Load listed tokens as additional feeds (real protocol tokens)
  useEffect(() => {
    api.getListedTokens(8)
      .then((toks) => {
        const extra = toks
          .filter((t) => t.symbol)
          .map((t) => ({ label: `${t.symbol}/USD`, address: t.address }));
        setFeeds((prev) => [prev[0], ...extra]);
      })
      .catch(() => { /* ETH feed alone is fine */ });
  }, []);

  // Load real price history for the selected feed
  useEffect(() => {
    let dead = false;
    setState('loading');
    const feed = feeds[feedIdx];
    const load: Promise<{ label?: string; candles: api.OHLCVCandle[] }> = feed.ref
      ? api.getReferenceHistory('1H')
      : api.getMarketPriceHistory(feed.address, '1H').then((candles) => ({ candles }));
    load
      .then((data) => {
        if (dead) return;
        // Reference feed reports what it really is — relabel the tab
        if (feed.ref && data.label && data.label !== feed.label) {
          setFeeds((prev) => prev.map((f, i) => (i === 0 ? { ...f, label: data.label! } : f)));
        }
        const cs = data.candles
          .filter((d) => d.close > 0)
          .map((d) => ({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close }));
        if (cs.length < 10) { setState('offline'); return; }
        setCandles(cs);
        setEntryIdx(Math.floor(cs.length * 0.25));
        setState('ready');
      })
      .catch(() => { if (!dead) setState('offline'); });
    return () => { dead = true; };
  }, [feeds, feedIdx, reloadTick]);

  // ── Replay the protocol against the real path ──────────────
  const result = useMemo(() => {
    if (candles.length < 2) return null;
    const idx = Math.min(Math.max(entryIdx, 0), candles.length - 2);
    const entry = candles[idx].c;
    const position = collateral * leverage;
    const protocolCapital = position - collateral;
    // Charged on the whole position, at the tier rate, out of the user's return.
    const fee = position * (tierCfg.feePct / 100);

    // shouldAutoClose compares LEVERAGED PnL against the tier threshold, so the
    // price move that triggers it is the threshold divided by leverage.
    const liqPct = tierCfg.autoCloseAt;
    const liqPrice = entry * (1 + liqPct / (100 * leverage));

    // A position also dies of old age at 24h, whatever the price is doing.
    const timeoutIdx = Math.min(idx + MAX_HOURS, candles.length - 1);
    let liquidatedAt: number | null = null;
    for (let i = idx + 1; i <= timeoutIdx; i++) {
      if (candles[i].l <= liqPrice) { liquidatedAt = i; break; }
    }

    const exitIdx = liquidatedAt ?? timeoutIdx;
    const exit = liquidatedAt != null ? liqPrice : candles[exitIdx].c;
    const timedOut = liquidatedAt == null && exitIdx === idx + MAX_HOURS;

    // Settlement, in the order the closer actually does it: the sale proceeds
    // repay the pool first, the flat fee comes off, and what is left is yours.
    const exitValue = position * (exit / entry);
    const profit = exitValue - position;
    let userReturn: number;
    let userLock = 0;
    if (profit > 0) {
      // 70% of profit lands as ETH, 30% buys $LOADED locked for 7 days —
      // deferred, but still the user's. Counting only the 70% understated
      // every winning trade by nearly a third.
      userLock = profit * 0.3;
      userReturn = collateral + profit * 0.7 - fee;
    } else {
      userReturn = Math.max(0, exitValue - protocolCapital - fee);
    }
    const userPnl = userReturn + userLock - collateral;
    const hoursHeld = exitIdx - idx;
    const movePct = (exit / entry - 1) * 100;

    return {
      idx, entry, liqPrice, liqPct, position, fee, liquidatedAt, timedOut,
      exitIdx, userPnl, userLock, userReturn, hoursHeld, movePct,
    };
  }, [candles, entryIdx, leverage, collateral, tierCfg]);

  // Crossing into liquidation on real history: shake the tube, sound the alarm
  useEffect(() => {
    const isRekt = result?.liquidatedAt != null;
    if (isRekt && !wasLiquidatedRef.current) {
      blip('alarm');
      const el = rootRef.current;
      if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.classList.remove('rekt-shake');
        void el.offsetWidth;
        el.classList.add('rekt-shake');
        setTimeout(() => el.classList.remove('rekt-shake'), 450);
      }
    }
    wasLiquidatedRef.current = isRekt;
  }, [result?.liquidatedAt]);

  // ── Draw ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2 || !result) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const P = chartPalette();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 8, r: 64, t: 14, b: 22 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;

    let min = Infinity;
    let max = -Infinity;
    for (const c of candles) { min = Math.min(min, c.l); max = Math.max(max, c.h); }
    // Include liq price in range so the line is visible
    min = Math.min(min, result.liqPrice * 0.995);
    const span = max - min || 1;

    const X = (i: number) => pad.l + (i / (candles.length - 1)) * cw;
    const Y = (p: number) => pad.t + (1 - (p - min) / span) * ch;

    // Grid
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (g / 4) * ch + 0.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cw, y); ctx.stroke();
      const price = max - (g / 4) * span;
      ctx.fillStyle = P.text;
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillText(fmtPrice(price), pad.l + cw + 6, y + 3);
    }

    // Date labels
    const d0 = new Date(candles[0].t * 1000);
    const d1 = new Date(candles[candles.length - 1].t * 1000);
    const fmtD = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    ctx.fillStyle = P.text;
    ctx.fillText(fmtD(d0), pad.l, h - 8);
    ctx.fillText(fmtD(d1), pad.l + cw - 30, h - 8);

    // Price path before entry — dim
    ctx.strokeStyle = `rgba(${P.primaryRgb}, 0.35)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= result.idx; i++) {
      const x = X(i); const y = Y(candles[i].c);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Price path after entry — outcome-tinted
    const outcomeColor = result.liquidatedAt != null ? P.red : result.userPnl >= 0 ? P.green : P.yellow;
    ctx.strokeStyle = outcomeColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = outcomeColor;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = result.idx; i <= result.exitIdx; i++) {
      const x = X(i); const y = Y(candles[i].c);
      i === result.idx ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    if (result.liquidatedAt != null) ctx.lineTo(X(result.exitIdx), Y(result.liqPrice));
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Remaining path after liquidation — ghost
    if (result.liquidatedAt != null && result.exitIdx < candles.length - 1) {
      ctx.strokeStyle = `rgba(${P.primaryRgb}, 0.15)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = result.exitIdx; i < candles.length; i++) {
        const x = X(i); const y = Y(candles[i].c);
        i === result.exitIdx ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Liquidation level
    ctx.strokeStyle = P.red;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    const ly = Y(result.liqPrice);
    ctx.beginPath(); ctx.moveTo(X(result.idx), ly); ctx.lineTo(pad.l + cw, ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = P.red;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`LIQ ${fmtPrice(result.liqPrice)}`, X(result.idx) + 4, ly - 4);

    // Entry marker
    const ex = X(result.idx);
    ctx.strokeStyle = P.primary;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(ex, pad.t); ctx.lineTo(ex, pad.t + ch); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = P.primary;
    ctx.beginPath(); ctx.arc(ex, Y(result.entry), 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillText('ENTRY', Math.min(ex + 5, w - 90), pad.t + 10);
    ctx.fillText('◄ DRAG ►', Math.min(ex + 5, w - 90), pad.t + 21);

    // Liquidation X
    if (result.liquidatedAt != null) {
      const lx = X(result.exitIdx);
      ctx.fillStyle = P.red;
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.fillText('✕ REKT', lx - 18, Y(result.liqPrice) + 16);
    }
  }, [candles, result, themeTick]);

  // ── Drag entry ──────────────────────────────────────────────
  const idxFromEvent = useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return null;
    const r = canvas.getBoundingClientRect();
    const frac = (e.clientX - r.left - 8) / (r.width - 72);
    return Math.round(Math.min(Math.max(frac, 0), 0.95) * (candles.length - 1));
  }, [candles.length]);

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const i = idxFromEvent(e);
    if (i != null) setEntryIdx(i);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const i = idxFromEvent(e);
    if (i != null) setEntryIdx(i);
  };
  const onPointerUp = () => { draggingRef.current = false; };

  return (
    <div className="pg" ref={rootRef}>
      <div className="pg-head">
        <span className="pg-title">REPLAY SIM — REAL MARKET DATA</span>
        <div className="rs-feeds">
          {feeds.map((f, i) => (
            <button
              key={f.address}
              className={`rs-feed ${i === feedIdx ? 'rs-feed-active' : ''}`}
              onClick={() => { blip('click'); setFeedIdx(i); }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {state === 'offline' ? (
        <div className="rs-offline">
          <span className="rs-offline-tag">[ FEED OFFLINE ]</span>
          <p>The simulator replays real price history — no feed, no sim. No fake charts here.</p>
          <button className="btn btn-outline btn-sm" onClick={() => setReloadTick((v) => v + 1)}>RETRY FEED</button>
        </div>
      ) : (
        <>
          <div className="rs-chart-wrap">
            {state === 'loading' && <div className="rs-loading">LOADING 7D FEED<span className="blink">▮</span></div>}
            <canvas
              ref={canvasRef}
              className="rs-canvas"
              style={{ opacity: state === 'loading' ? 0.2 : 1, touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>

          <div className="rs-grid">
            <div className="pg-controls rs-controls">
              <div className="pg-field">
                <div className="pg-row">
                  <span>TIER</span>
                  <span className="pg-val mono">{tierCfg.feePct}% FEE / {tierCfg.maxLeverage}X MAX</span>
                </div>
                <div className="rs-tier-row">
                  {(Object.keys(TIERS) as TierKey[]).map((k) => (
                    <button
                      key={k}
                      className={`rs-tier-btn${tier === k ? ' rs-tier-active' : ''}`}
                      onClick={() => setTier(k)}
                    >
                      {TIERS[k].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pg-field">
                <div className="pg-row">
                  <span>COLLATERAL</span>
                  <span className="pg-val mono">{collateral.toFixed(2)} ETH</span>
                </div>
                <input type="range" min={MIN_COLLATERAL} max={MAX_COLLATERAL} step="0.01" value={collateral}
                  onChange={(e) => setCollateral(parseFloat(e.target.value))} className="pg-slider" />
              </div>
              <div className="pg-field">
                <div className="pg-row">
                  <span>LEVERAGE</span>
                  <span className="pg-val pg-lev mono">{leverage}X</span>
                </div>
                <input type="range" min="2" max={tierCfg.maxLeverage} step="1" value={leverage}
                  onChange={(e) => setLeverage(parseInt(e.target.value))} className="pg-slider" />
              </div>
              {result && (
                <div className="pg-stats rs-stats">
                  <div className="pg-stat">
                    <span>ENTRY</span>
                    <b className="mono">${fmtPrice(result.entry)}</b>
                  </div>
                  <div className="pg-stat">
                    <span>POSITION</span>
                    <b className="mono">{result.position.toFixed(2)} ETH</b>
                  </div>
                  <div className="pg-stat">
                    <span>AUTO-CLOSE</span>
                    <b className="mono" style={{ color: 'var(--red)' }}>{result.liqPct}% @ {fmtPrice(result.liqPrice)}</b>
                  </div>
                </div>
              )}
            </div>

            {result && (
              <div className={`pg-result rs-result ${result.liquidatedAt != null ? 'pg-rekt' : result.userPnl >= 0 ? 'pg-win' : 'pg-loss'}`}>
                {result.liquidatedAt != null ? (
                  <>
                    <span className="pg-result-label">■ AUTO-CLOSED AFTER {result.hoursHeld}H ■</span>
                    <span className="pg-result-num mono">{result.userPnl.toFixed(4)} ETH</span>
                    <span className="pg-result-sub">
                      price hit {fmtPrice(result.liqPrice)} on real history · you keep{' '}
                      {result.userReturn.toFixed(4)} of your {collateral.toFixed(2)} ETH
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pg-result-label">
                      {result.timedOut
                        ? 'CLOSED AT THE 24H LIMIT'
                        : result.userPnl >= 0
                          ? `SURVIVED ${result.hoursHeld}H — PROFIT`
                          : `HELD ${result.hoursHeld}H — DRAWDOWN`}
                    </span>
                    <span className="pg-result-num mono">{result.userPnl >= 0 ? '+' : ''}{result.userPnl.toFixed(4)} ETH</span>
                    <span className="pg-result-sub">
                      real move {result.movePct >= 0 ? '+' : ''}{result.movePct.toFixed(1)}% · {tierCfg.feePct}% fee ={' '}
                      {result.fee.toFixed(4)} ETH
                      {result.userLock > 0
                        ? ` · ${result.userLock.toFixed(4)} ETH of it auto-buys $LOADED, locked 7 days`
                        : ''}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
