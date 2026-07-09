import { type FC, type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Scramble } from '../components/fx/Scramble';
import { ReplaySim } from '../components/ReplaySim';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { SfxToggle } from '../components/SfxToggle';
import { HelpOverlay } from '../components/HelpOverlay';
import { chartPalette, onThemeChange } from '../lib/theme';
import * as api from '../lib/api';

/* ═══════════════════════════════════════════════════════════════
   FRONT — PHOSPHOR landing experience
   POST boot · live market wall · risk computer · spec plates
   ═══════════════════════════════════════════════════════════════ */

const FRONT_CA = 'f2LZJzFYi1DScywiKUanLpMuWoDKSgqvink82sxpump';

/* ── Boot / POST sequence ───────────────────────────────────── */
const BOOT_LINES: Array<{ text: string; status?: string }> = [
  { text: 'FRONT TERMINAL BIOS v2.0.7 — PHOSPHOR' },
  { text: 'MEM CHECK ................ 640K DEGEN RAM', status: 'OK' },
  { text: 'SOLANA MAINNET LINK ......', status: 'OK' },
  { text: 'LENDING POOL .............', status: 'ARMED' },
  { text: 'LIQUIDATION ENGINE .......', status: 'HOT' },
  { text: 'JUPITER ROUTER ...........', status: 'OK' },
  { text: 'MERCY MODULE .............', status: 'NOT FOUND' },
];

const BootIntro: FC<{ onDone: () => void }> = ({ onDone }) => {
  const [count, setCount] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => {
    setLeaving(true);
    setTimeout(onDone, 350);
  }, [onDone]);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= BOOT_LINES.length) {
        clearInterval(t);
        setTimeout(finish, 650);
      }
    }, 190);
    const key = () => finish();
    window.addEventListener('keydown', key);
    return () => { clearInterval(t); window.removeEventListener('keydown', key); };
  }, [finish]);

  return (
    <div className={`boot-overlay ${leaving ? 'boot-leaving' : ''}`} onClick={finish}>
      <div className="boot-box">
        {BOOT_LINES.slice(0, count).map((l, idx) => (
          <div key={idx} className="boot-line">
            <span>{l.text}</span>
            {l.status && (
              <span className={`boot-status ${l.status === 'NOT FOUND' ? 'boot-status-warn' : ''}`}>
                [{l.status}]
              </span>
            )}
          </div>
        ))}
        <div className="boot-cursor" />
      </div>
      <div className="boot-skip blink">PRESS ANY KEY TO SKIP</div>
    </div>
  );
};

/* ── Market wall — REAL SOL/USD candles, drawn phosphor-style ─ */
const WSOL = 'So11111111111111111111111111111111111111112';

interface WallCandle { o: number; c: number; h: number; l: number }

const MarketWall: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const candlesRef = useRef<WallCandle[]>([]);
  const [feedInfo, setFeedInfo] = useState<{ price: number; up: boolean } | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => onThemeChange(() => setThemeTick((v) => v + 1)), []);

  // Real 15-minute SOL/USD candles, last 24h, refreshed every 60s
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const data = await api.getMarketPriceHistory(WSOL, '15m', now - 24 * 3600, now);
        if (dead || data.length === 0) return;
        candlesRef.current = data.map((d) => ({ o: d.open, c: d.close, h: d.high, l: d.low }));
        const last = data[data.length - 1];
        const first = data[0];
        setFeedInfo({ price: last.close, up: last.close >= first.open });
      } catch { /* keep whatever we have; NO FEED tag stays honest */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);

    let raf = 0;

    const draw = () => {
      const P = chartPalette();
      ctx.clearRect(0, 0, w, h);

      // Phosphor grid
      ctx.strokeStyle = `rgba(${P.primaryRgb}, 0.045)`;
      ctx.lineWidth = 1;
      const gx = 64;
      for (let x = 0.5; x < w; x += gx) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0.5; y < h; y += gx) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const candles = candlesRef.current;
      if (candles.length > 1) {
        // Normalize real prices into the mid-band of the hero
        let min = Infinity; let max = -Infinity;
        for (const c of candles) { min = Math.min(min, c.l); max = Math.max(max, c.h); }
        const span = max - min || 1;
        const yOf = (p: number) => h * 0.82 - ((p - min) / span) * h * 0.6;

        const cw = w / candles.length;
        const bw = Math.max(2, cw * 0.5);
        candles.forEach((cd, i) => {
          const x = i * cw + cw / 2;
          const up = cd.c >= cd.o;
          const col = up ? 'rgba(61, 255, 158, 0.20)' : 'rgba(255, 77, 77, 0.18)';
          ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(x, yOf(cd.h)); ctx.lineTo(x, yOf(cd.l)); ctx.stroke();
          ctx.fillStyle = col;
          const yO = yOf(cd.o); const yC = yOf(cd.c);
          ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1.5, Math.abs(yC - yO)));
        });

        // Last-price line
        const lastY = yOf(candles[candles.length - 1].c);
        ctx.strokeStyle = `rgba(${P.primaryRgb}, 0.28)`;
        ctx.setLineDash([4, 5]);
        ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(w, lastY); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Cursor crosshair
      if (mouse.x > 0 && mouse.y > 0) {
        ctx.strokeStyle = `rgba(${P.primaryRgb}, 0.18)`;
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(mouse.x + 0.5, 0); ctx.lineTo(mouse.x + 0.5, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, mouse.y + 0.5); ctx.lineTo(w, mouse.y + 0.5); ctx.stroke();
        ctx.setLineDash([]);
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
    };
  }, [themeTick]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="lp-canvas"
        style={{ cursor: 'crosshair' }}
        onClick={() => document.getElementById('sim')?.scrollIntoView({ behavior: 'smooth' })}
        title="Click to replay this market with leverage"
      />
      <div className="lp-feed-tag mono">
        {feedInfo ? (
          <>
            <span className="lp-feed-dot" /> LIVE FEED · SOL/USD ·{' '}
            <b style={{ color: feedInfo.up ? 'var(--green)' : 'var(--red)' }}>
              ${feedInfo.price.toFixed(2)}
            </b>{' '}
            · 24H×15M
          </>
        ) : (
          <>NO FEED</>
        )}
      </div>
    </>
  );
};

/* ── Typewriter line ────────────────────────────────────────── */
const Typewriter: FC<{ text: string; delay?: number; className?: string }> = ({ text, delay = 0, className = '' }) => {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setN(text.length); return; }
    let t: ReturnType<typeof setInterval>;
    const d = setTimeout(() => {
      t = setInterval(() => {
        setN((v) => {
          if (v >= text.length) { clearInterval(t); return v; }
          return v + 1;
        });
      }, 14);
    }, delay);
    return () => { clearTimeout(d); clearInterval(t); };
  }, [text, delay]);
  return <p className={className}>{text.slice(0, n)}{n < text.length && <span className="lp-caret">▮</span>}</p>;
};

/* ── Live protocol stat ─────────────────────────────────────── */
const lam = (v?: string) => (v ? Number(v) / 1e9 : 0);

const LiveStats: FC = () => {
  const [stats, setStats] = useState<api.ProtocolStatsResponse | null>(null);

  useEffect(() => {
    api.getProtocolStats().then(setStats).catch(() => {});
  }, []);

  const items = [
    { k: 'MAX LEVERAGE', v: '10.0X' },
    {
      k: 'LENDING POOL',
      v: stats ? `${lam(stats.poolSizeLamports).toFixed(2)}◎` : '—',
    },
    {
      k: 'SOL BURNED',
      v: stats ? `${lam(stats.totalBurnedLamports).toFixed(2)}◎` : '—',
    },
    {
      k: 'TRADES EXECUTED',
      v: stats ? String(stats.totalTradesExecuted).padStart(4, '0') : '—',
    },
    {
      k: 'LISTED TOKENS',
      v: stats ? String(stats.activeListedTokens).padStart(3, '0') : '—',
    },
  ];

  return (
    <div className="lp-stats">
      {items.map((s, i) => (
        <div className="lp-stat" key={s.k}>
          <b className="mono"><Scramble text={s.v} delay={900 + i * 120} speed={36} /></b>
          <span>{s.k}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Section reveal helper ──────────────────────────────────── */
const Reveal: FC<{ children: ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 26 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
  >
    {children}
  </motion.div>
);

/* ── Page ───────────────────────────────────────────────────── */
export const Landing: FC = () => {
  const [booted, setBooted] = useState(() => {
    try { return sessionStorage.getItem('front_booted') === '1'; } catch { return true; }
  });

  const onBootDone = useCallback(() => {
    try { sessionStorage.setItem('front_booted', '1'); } catch { /* ignore */ }
    setBooted(true);
  }, []);

  return (
    <div className="lp">
      {!booted && <BootIntro onDone={onBootDone} />}
      <HelpOverlay />

      {/* Nav */}
      <nav className="lp-nav">
        <div className="lp-logo">
          <img src="/front-logo.png" alt="" width="22" height="22" />
          <span className="lp-logo-text">FRONT_</span>
        </div>
        <div className="lp-nav-links">
          <a href="#sim">SIMULATOR</a>
          <a href="#how">PROCEDURE</a>
          <a href="#tiers">TIERS</a>
          <Link to="/docs">MANUAL</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ThemeSwitcher />
          <SfxToggle />
          <Link to="/trade" className="lp-cta-sm">ENTER TERMINAL</Link>
        </div>
      </nav>

      {/* Hero */}
      <header className="lp-hero">
        <MarketWall />
        <div className="lp-hero-inner">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="lp-badge"
          >
            <span className="lp-badge-dot" /> LIVE ON SOLANA MAINNET — TERMINAL v2.0
          </motion.div>

          <h1 className="lp-h1">
            <Scramble text="LEVERAGE THE" delay={250} speed={34} className="lp-h1-line lp-h1-dim" as="div" />
            <Scramble text="MEMECONOMY" delay={650} speed={44} className="lp-h1-line lp-h1-amber" as="div" />
          </h1>

          <Typewriter
            className="lp-sub"
            delay={1300}
            text="Up to 10x on any Pump.fun token. You post collateral, the pool fronts the rest, everything executes on-chain. No order books. No wallet extension. No mercy."
          />

          <motion.div
            className="lp-cta-row"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.9 }}
          >
            <Link to="/trade" className="lp-cta-main">
              [ START TRADING <span className="lp-cta-arrow">→</span> ]
            </Link>
            <a href="#sim" className="lp-cta-ghost">[ RUN SIMULATOR ]</a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.2 }}
          >
            <LiveStats />
          </motion.div>
        </div>
      </header>

      {/* Tape marquee */}
      <div className="lp-marquee">
        <div className="lp-marquee-track">
          {[0, 1].map((k) => (
            <div className="lp-marquee-seg" key={k} aria-hidden={k === 1}>
              <span>NO CEX</span><i>◆</i><span>PURE ON-CHAIN</span><i>◆</i><span>10X LEVERAGE</span><i>◆</i>
              <span>REAL JUPITER SWAPS</span><i>◆</i><span>CREATORS GET PAID</span><i>◆</i><span>THE POOL NEVER LOSES</span><i>◆</i>
            </div>
          ))}
        </div>
      </div>

      {/* Simulator */}
      <section className="lp-section" id="sim">
        <Reveal>
          <div className="sec-label">SEC.01 — REPLAY SIMULATION</div>
          <h2 className="lp-h2">REPLAY THE <span className="lp-amber">LEVERAGE</span></h2>
          <p className="lp-section-sub">
            Real market history, exact protocol math. Drag your entry anywhere on the last 7 days
            and see whether you'd have printed — or been liquidated.
          </p>
        </Reveal>
        <Reveal delay={0.1}><ReplaySim /></Reveal>
      </section>

      {/* Procedure */}
      <section className="lp-section" id="how">
        <Reveal>
          <div className="sec-label">SEC.02 — OPERATING PROCEDURE</div>
          <h2 className="lp-h2">THREE STEPS TO <span className="lp-amber">SEND IT</span></h2>
        </Reveal>
        <div className="lp-steps">
          {[
            { n: '01', t: 'DEPOSIT', d: 'Sign in with email. A custodial Solana wallet is generated — no extension, no seed-phrase anxiety. Fund it with SOL.' },
            { n: '02', t: 'PICK & SIZE', d: 'Choose any listed Pump.fun token. Set collateral and dial leverage 2–10x. The lending pool fronts the rest — instantly.' },
            { n: '03', t: 'RIDE OR DIE', d: 'Position executes as a real Jupiter swap. Take profit, stop loss, or 24h auto-close. Profits split 70/30 with $FRONT buybacks.' },
          ].map((c, i) => (
            <Reveal delay={i * 0.1} key={c.n}>
              <div className="lp-step">
                <span className="lp-step-n mono">{c.n}</span>
                <div className="lp-step-body">
                  <h3 className="lp-step-t"><Scramble text={c.t} hover speed={22} /></h3>
                  <p className="lp-step-d">{c.d}</p>
                </div>
                <span className="lp-step-arrow">→</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Tiers — spec plate */}
      <section className="lp-section" id="tiers">
        <Reveal>
          <div className="sec-label">SEC.03 — RISK CLASSIFICATION</div>
          <h2 className="lp-h2">RISK <span className="lp-amber">TIERS</span></h2>
          <p className="lp-section-sub">Bigger token, bigger leverage. The protocol prices risk automatically.</p>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="lp-tier-table">
            <div className="lp-tier-row lp-tier-row-head">
              <span>CLASS</span><span>MAX LEV</span><span>LIQ. AT</span><span>DESCRIPTION</span>
            </div>
            {[
              { name: 'BONDED', lev: '10X', liq: '-15%', desc: 'Graduated to Raydium. Deep liquidity, maximum send.', cls: 'lp-tier-bonded' },
              { name: 'RISING', lev: '5X', liq: '-12%', desc: '$100K+ market cap and climbing. Balanced degen.', cls: 'lp-tier-rising' },
              { name: 'DEGEN', lev: '3X', liq: '-10%', desc: 'Fresh off the curve. Tight leash, pure adrenaline.', cls: 'lp-tier-degen' },
            ].map((t) => (
              <div className={`lp-tier-row ${t.cls}`} key={t.name}>
                <span className="lp-tier-name">■ {t.name}</span>
                <span className="lp-tier-lev mono">{t.lev}</span>
                <span className="lp-tier-liq mono">{t.liq}</span>
                <span className="lp-tier-desc">{t.desc}</span>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Flywheel */}
      <section className="lp-section">
        <Reveal>
          <div className="sec-label">SEC.04 — FEE ROUTING</div>
          <h2 className="lp-h2">THE <span className="lp-amber">FLYWHEEL</span></h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="lp-fly">
            {[
              { k: '50%', v: 'OF FEES REFILL THE LENDING POOL', c: 'var(--green)' },
              { k: '30%', v: 'PAID TO THE TOKEN CREATOR', c: 'var(--primary)' },
              { k: '20%', v: 'BUYS & BURNS $FRONT', c: 'var(--magenta)' },
            ].map((f) => (
              <div className="lp-fly-item" key={f.k}>
                <span className="lp-fly-k mono" style={{ color: f.c }}>{f.k}</span>
                <span className="lp-fly-v">{f.v}</span>
                <div className="lp-fly-bar">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: f.k }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                    style={{ background: f.c, height: '100%' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <Reveal>
          <h2 className="lp-final-h">
            <Scramble text="READY TO FRONT?" hover speed={30} />
            <span className="lp-caret blink">▮</span>
          </h2>
          <Link to="/trade" className="lp-cta-main lp-cta-big">
            [ LAUNCH TERMINAL <span className="lp-cta-arrow">→</span> ]
          </Link>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-left">
          <span className="lp-logo-text">FRONT_</span>
          <span className="lp-footer-dim">BUILT FOR DEGENS. THE POOL NEVER LOSES.</span>
          <a
            className="lp-footer-ca mono"
            href={`https://pump.fun/coin/${FRONT_CA}`}
            target="_blank"
            rel="noopener noreferrer"
            title={FRONT_CA}
          >
            CA: {FRONT_CA.slice(0, 6)}…{FRONT_CA.slice(-6)}
          </a>
        </div>
        <div className="lp-footer-links">
          <a href="https://twitter.com/FrontDotFun" target="_blank" rel="noreferrer">TWITTER</a>
          <a href="https://t.me/FrontProtocol" target="_blank" rel="noreferrer">TELEGRAM</a>
          <a href="https://github.com/FrontDotFun/front" target="_blank" rel="noreferrer">GITHUB</a>
          <Link to="/docs">MANUAL</Link>
        </div>
      </footer>
    </div>
  );
};
