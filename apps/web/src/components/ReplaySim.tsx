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

const WSOL = 'So11111111111111111111111111111111111111112';

interface Feed {
  label: string;
  address: string;
}

interface Candle { t: number; o: number; h: number; l: number; c: number }

const HOURS = 24 * 7;

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(3);
}

export const ReplaySim: FC = () => {
  const [feeds, setFeeds] = useState<Feed[]>([{ label: 'SOL/USD', address: WSOL }]);
  const [feedIdx, setFeedIdx] = useState(0);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');

  const [collateral, setCollateral] = useState(1);
  const [leverage, setLeverage] = useState(5);
  const [entryIdx, setEntryIdx] = useState(40);

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
        setFeeds([{ label: 'SOL/USD', address: WSOL }, ...extra]);
      })
      .catch(() => { /* SOL feed alone is fine */ });
  }, []);

  // Load real price history for the selected feed
  useEffect(() => {
    let dead = false;
    setState('loading');
    const now = Math.floor(Date.now() / 1000);
    api.getMarketPriceHistory(feeds[feedIdx].address, '1H', now - HOURS * 3600, now)
      .then((data) => {
        if (dead) return;
        const cs = data
          .filter((d) => d.close > 0)
          .map((d) => ({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close }));
        if (cs.length < 10) { setState('offline'); return; }
        setCandles(cs);
        setEntryIdx(Math.floor(cs.length * 0.25));
        setState('ready');
      })
      .catch(() => { if (!dead) setState('offline'); });
    return () => { dead = true; };
  }, [feeds, feedIdx]);

  // ── Replay the protocol against the real path ──────────────
  const result = useMemo(() => {
    if (candles.length < 2) return null;
    const idx = Math.min(Math.max(entryIdx, 0), candles.length - 2);
    const entry = candles[idx].c;
    const liqPct = -(100 / leverage) * 0.85;
    const liqPrice = entry * (1 + liqPct / 100);
    const position = collateral * leverage;
    const fee = position * 0.005;

    let liquidatedAt: number | null = null;
    for (let i = idx + 1; i < candles.length; i++) {
      if (candles[i].l <= liqPrice) { liquidatedAt = i; break; }
    }

    const exitIdx = liquidatedAt ?? candles.length - 1;
    const exit = liquidatedAt != null ? liqPrice : candles[exitIdx].c;
    const gross = position * (exit / entry - 1);
    const userPnl = liquidatedAt != null ? -collateral : gross > 0 ? gross * 0.7 : gross;
    const hoursHeld = exitIdx - idx;
    const movePct = (exit / entry - 1) * 100;

    return { idx, entry, liqPrice, liqPct, position, fee, liquidatedAt, exitIdx, userPnl, hoursHeld, movePct };
  }, [candles, entryIdx, leverage, collateral]);

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
          <button className="btn btn-outline btn-sm" onClick={() => setFeedIdx((v) => v)}>RETRY FEED</button>
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
                  <span>COLLATERAL</span>
                  <span className="pg-val mono">{collateral.toFixed(1)} SOL</span>
                </div>
                <input type="range" min="0.1" max="10" step="0.1" value={collateral}
                  onChange={(e) => setCollateral(parseFloat(e.target.value))} className="pg-slider" />
              </div>
              <div className="pg-field">
                <div className="pg-row">
                  <span>LEVERAGE</span>
                  <span className="pg-val pg-lev mono">{leverage}X</span>
                </div>
                <input type="range" min="2" max="10" step="1" value={leverage}
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
                    <b className="mono">{result.position.toFixed(2)} SOL</b>
                  </div>
                  <div className="pg-stat">
                    <span>LIQ AT</span>
                    <b className="mono" style={{ color: 'var(--red)' }}>{result.liqPct.toFixed(1)}%</b>
                  </div>
                </div>
              )}
            </div>

            {result && (
              <div className={`pg-result rs-result ${result.liquidatedAt != null ? 'pg-rekt' : result.userPnl >= 0 ? 'pg-win' : 'pg-loss'}`}>
                {result.liquidatedAt != null ? (
                  <>
                    <span className="pg-result-label">■ LIQUIDATED AFTER {result.hoursHeld}H ■</span>
                    <span className="pg-result-num mono">-{collateral.toFixed(2)} SOL</span>
                    <span className="pg-result-sub">
                      price hit {fmtPrice(result.liqPrice)} on real history · pool stays whole
                    </span>
                  </>
                ) : (
                  <>
                    <span className="pg-result-label">
                      {result.userPnl >= 0 ? `SURVIVED ${result.hoursHeld}H — PROFIT (70%)` : `HELD ${result.hoursHeld}H — DRAWDOWN`}
                    </span>
                    <span className="pg-result-num mono">{result.userPnl >= 0 ? '+' : ''}{result.userPnl.toFixed(2)} SOL</span>
                    <span className="pg-result-sub">
                      real move {result.movePct >= 0 ? '+' : ''}{result.movePct.toFixed(1)}% ·
                      {result.userPnl >= 0 ? ' 30% auto-buys $FRONT · locked 7 days' : ' above liquidation — you lived'}
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
