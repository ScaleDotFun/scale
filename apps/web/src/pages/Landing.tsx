import { type FC, type ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

/* ═══════════════════════════════════════════════════════════════
   FRONT — AURORA TERMINAL landing experience
   Boot intro · particle field · glitch hero · magnetic CTAs
   ═══════════════════════════════════════════════════════════════ */

/* ── Boot intro overlay ─────────────────────────────────────── */
const BOOT_LINES = [
  '> init front_protocol v2.0',
  '> connecting solana mainnet ... ok',
  '> loading lending pool ... ok',
  '> arming liquidation engine ... ok',
  '> welcome, degen.',
];

const BootIntro: FC<{ onDone: () => void }> = ({ onDone }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setLines(BOOT_LINES.slice(0, i));
      if (i >= BOOT_LINES.length) {
        clearInterval(t);
        setTimeout(() => setLeaving(true), 350);
        setTimeout(onDone, 750);
      }
    }, 230);
    return () => clearInterval(t);
  }, [onDone]);

  return (
    <div
      className={`boot-overlay ${leaving ? 'boot-leaving' : ''}`}
      onClick={() => { setLeaving(true); setTimeout(onDone, 300); }}
    >
      <div className="boot-box">
        {lines.map((l, idx) => (
          <div key={idx} className="boot-line">{l}</div>
        ))}
        <div className="boot-cursor" />
      </div>
      <div className="boot-skip">click to skip</div>
    </div>
  );
};

/* ── Aurora particle field ──────────────────────────────────── */
const ParticleField: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

    const COLORS = ['#8b5cff', '#22e1ff', '#ff4ecd'];
    interface P { x: number; y: number; vx: number; vy: number; r: number; c: string }
    const N = Math.min(110, Math.floor((w * h) / 16000)) || 60;
    const ps: P[] = Array.from({ length: N }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.6 + 0.5,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    }));

    const mouse = { x: -9999, y: -9999 };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseout', onLeave);

    let raf = 0;
    const LINK = 110;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      for (const p of ps) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const f = ((120 - d) / 120) * 0.6;
          p.vx += (dx / d) * f * 0.25;
          p.vy += (dy / d) * f * 0.25;
        }
        p.vx *= 0.98; p.vy *= 0.98;
        p.vx += (Math.random() - 0.5) * 0.012;
        p.vy += (Math.random() - 0.5) * 0.012;
        p.x += p.vx; p.y += p.vy;
        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      ctx.lineWidth = 0.5;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i]; const b = ps[j];
          const dx = a.x - b.x; const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const alpha = (1 - Math.sqrt(d2) / LINK) * 0.14;
            ctx.strokeStyle = `rgba(139, 92, 255, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      for (const p of ps) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseout', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-canvas" />;
};

/* ── Count-up number ────────────────────────────────────────── */
const CountUp: FC<{ to: number; decimals?: number; suffix?: string; prefix?: string }> = ({ to, decimals = 0, suffix = '', prefix = '' }) => {
  const [v, setV] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || started.current) return;
      started.current = true;
      const t0 = performance.now();
      const dur = 1100;
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        setV(to * eased);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);

  return <span ref={ref}>{prefix}{v.toFixed(decimals)}{suffix}</span>;
};

/* ── Magnetic wrapper ───────────────────────────────────────── */
const Magnetic: FC<{ children: ReactNode; className?: string }> = ({ children, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
  }, []);

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = 'translate(0px, 0px)';
  }, []);

  return (
    <div ref={ref} className={`magnetic ${className}`} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  );
};

/* ── 3D tilt card ───────────────────────────────────────────── */
const TiltCard: FC<{ children: ReactNode; className?: string }> = ({ children, className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(800px) rotateY(${px * 10}deg) rotateX(${-py * 10}deg) translateY(-4px)`;
    el.style.setProperty('--mx', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--my', `${(py + 0.5) * 100}%`);
  }, []);

  const onLeave = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg) translateY(0px)';
  }, []);

  return (
    <div ref={ref} className={`tilt-card ${className}`} onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="tilt-glare" />
      {children}
    </div>
  );
};

/* ── Leverage playground ────────────────────────────────────── */
const Playground: FC = () => {
  const [collateral, setCollateral] = useState(1);
  const [leverage, setLeverage] = useState(5);
  const [move, setMove] = useState(25);

  const position = collateral * leverage;
  const borrowed = collateral * (leverage - 1);
  const fee = position * 0.005;
  const liqPct = -(100 / leverage) * 0.85;
  const grossPnl = position * (move / 100);
  const liquidated = move <= liqPct;
  const userPnl = liquidated ? -collateral : grossPnl * 0.7;

  return (
    <div className="pg">
      <div className="pg-head">
        <span className="pg-title">SIMULATOR</span>
        <span className="pg-sub">drag everything — this is the exact protocol math</span>
      </div>

      <div className="pg-grid">
        <div className="pg-controls">
          <div className="pg-field">
            <div className="pg-row">
              <span>Collateral</span>
              <span className="pg-val mono">{collateral.toFixed(1)} SOL</span>
            </div>
            <input type="range" min="0.1" max="10" step="0.1" value={collateral}
              onChange={(e) => setCollateral(parseFloat(e.target.value))} className="pg-slider" />
          </div>

          <div className="pg-field">
            <div className="pg-row">
              <span>Leverage</span>
              <span className="pg-val pg-lev mono">{leverage}x</span>
            </div>
            <input type="range" min="2" max="10" step="1" value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))} className="pg-slider" />
          </div>

          <div className="pg-field">
            <div className="pg-row">
              <span>Token moves</span>
              <span className="pg-val mono" style={{ color: move >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {move >= 0 ? '+' : ''}{move}%
              </span>
            </div>
            <input type="range" min="-60" max="120" step="1" value={move}
              onChange={(e) => setMove(parseInt(e.target.value))} className="pg-slider pg-slider-move" />
          </div>
        </div>

        <div className="pg-out">
          <div className="pg-bar">
            <motion.div
              className="pg-bar-you"
              animate={{ width: `${(collateral / position) * 100}%` }}
              transition={{ type: 'spring', stiffness: 180, damping: 24 }}
            >YOU</motion.div>
            <motion.div
              className="pg-bar-pool"
              animate={{ width: `${(borrowed / position) * 100}%` }}
              transition={{ type: 'spring', stiffness: 180, damping: 24 }}
            >POOL</motion.div>
          </div>

          <div className="pg-stats">
            <div className="pg-stat">
              <span>Position size</span>
              <b className="mono">{position.toFixed(2)} SOL</b>
            </div>
            <div className="pg-stat">
              <span>Entry fee (0.5%)</span>
              <b className="mono">{fee.toFixed(3)} SOL</b>
            </div>
            <div className="pg-stat">
              <span>Liquidation at</span>
              <b className="mono" style={{ color: 'var(--red)' }}>{liqPct.toFixed(1)}%</b>
            </div>
          </div>

          <div className={`pg-result ${liquidated ? 'pg-rekt' : userPnl >= 0 ? 'pg-win' : 'pg-loss'}`}>
            {liquidated ? (
              <>
                <span className="pg-result-label">LIQUIDATED</span>
                <span className="pg-result-num mono">-{collateral.toFixed(2)} SOL</span>
                <span className="pg-result-sub">position auto-closed · pool stays whole</span>
              </>
            ) : (
              <>
                <span className="pg-result-label">{userPnl >= 0 ? 'YOUR PROFIT (70%)' : 'YOUR PNL'}</span>
                <span className="pg-result-num mono">{userPnl >= 0 ? '+' : ''}{userPnl.toFixed(2)} SOL</span>
                <span className="pg-result-sub">
                  {userPnl >= 0 ? '30% auto-buys $FRONT · locked 7 days' : 'still above liquidation — hold or exit'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Section reveal helper ──────────────────────────────────── */
const Reveal: FC<{ children: ReactNode; delay?: number }> = ({ children, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 34 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-60px' }}
    transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
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

      <div className="lp-aurora" />
      <ParticleField />

      {/* Nav */}
      <nav className="lp-nav">
        <div className="lp-logo">
          <img src="/front-logo.png" alt="" width="26" height="26" style={{ borderRadius: 6 }} />
          <span className="lp-logo-text">FRONT</span>
        </div>
        <div className="lp-nav-links">
          <a href="#sim">Simulator</a>
          <a href="#how">How It Works</a>
          <a href="#tiers">Tiers</a>
          <Link to="/docs">Docs</Link>
        </div>
        <Magnetic>
          <Link to="/trade" className="lp-cta-sm">Launch App</Link>
        </Magnetic>
      </nav>

      {/* Hero */}
      <header className="lp-hero">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}
          className="lp-badge"
        >
          <span className="lp-badge-dot" /> LIVE ON SOLANA MAINNET
        </motion.div>

        <motion.h1
          className="lp-h1"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <span className="lp-h1-line chrome-text">LEVERAGE THE</span>
          <span className="lp-h1-line lp-h1-holo glitch" data-text="MEMECONOMY">MEMECONOMY</span>
        </motion.h1>

        <motion.p
          className="lp-sub"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.45 }}
        >
          Up to 10x on any Pump.fun token. You post collateral, the pool fills the rest,
          everything executes on-chain. No order books. No wallet extension. No mercy.
        </motion.p>

        <motion.div
          className="lp-cta-row"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6 }}
        >
          <Magnetic>
            <Link to="/trade" className="lp-cta-main">
              START TRADING <span className="lp-cta-arrow">→</span>
            </Link>
          </Magnetic>
          <a href="#sim" className="lp-cta-ghost">Try the simulator</a>
        </motion.div>

        <motion.div
          className="lp-stats"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <div className="lp-stat"><b className="mono"><CountUp to={10} suffix="x" /></b><span>max leverage</span></div>
          <div className="lp-stat"><b className="mono"><CountUp to={0.5} decimals={1} suffix="%" /></b><span>flat fee</span></div>
          <div className="lp-stat"><b className="mono"><CountUp to={30} suffix="%" /></b><span>to creators</span></div>
          <div className="lp-stat"><b className="mono"><CountUp to={24} suffix="h" /></b><span>max duration</span></div>
        </motion.div>
      </header>

      {/* Marquee */}
      <div className="lp-marquee">
        <div className="lp-marquee-track">
          {[0, 1].map((k) => (
            <div className="lp-marquee-seg" key={k} aria-hidden={k === 1}>
              <span>NO CEX</span><i>✦</i><span>PURE ON-CHAIN</span><i>✦</i><span>10X LEVERAGE</span><i>✦</i>
              <span>REAL JUPITER SWAPS</span><i>✦</i><span>CREATORS GET PAID</span><i>✦</i><span>POOL NEVER LOSES</span><i>✦</i>
            </div>
          ))}
        </div>
      </div>

      {/* Simulator */}
      <section className="lp-section" id="sim">
        <Reveal>
          <h2 className="lp-h2"><span className="holo-text">FEEL</span> THE LEVERAGE</h2>
          <p className="lp-section-sub">This is the exact math the protocol runs on every position.</p>
        </Reveal>
        <Reveal delay={0.1}><Playground /></Reveal>
      </section>

      {/* How it works */}
      <section className="lp-section" id="how">
        <Reveal>
          <h2 className="lp-h2">THREE STEPS TO <span className="holo-text">SEND IT</span></h2>
        </Reveal>
        <div className="lp-cards3">
          {[
            { n: '01', t: 'DEPOSIT', d: 'Sign in with email. A custodial Solana wallet is created for you — no extension, no seed phrase anxiety. Fund it with SOL.' },
            { n: '02', t: 'PICK & SIZE', d: 'Choose any listed Pump.fun token. Set collateral and leverage 2–10x. The lending pool fronts the rest — instantly.' },
            { n: '03', t: 'RIDE OR DIE', d: 'Position executes as a real Jupiter swap. Take profit, stop loss, or 24h auto-close. Profits split 70/30 with $FRONT buybacks.' },
          ].map((c, i) => (
            <Reveal delay={i * 0.12} key={c.n}>
              <TiltCard className="lp-step">
                <span className="lp-step-n mono">{c.n}</span>
                <h3 className="lp-step-t">{c.t}</h3>
                <p className="lp-step-d">{c.d}</p>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section className="lp-section" id="tiers">
        <Reveal>
          <h2 className="lp-h2">RISK <span className="holo-text">TIERS</span></h2>
          <p className="lp-section-sub">Bigger token, bigger leverage. The protocol prices risk automatically.</p>
        </Reveal>
        <div className="lp-cards3">
          {[
            { name: 'BONDED', lev: '10x', liq: '-15%', desc: 'Graduated to Raydium. Deep liquidity, maximum send.', cls: 'tier-bonded' },
            { name: 'RISING', lev: '5x', liq: '-12%', desc: '$100K+ market cap and climbing. Balanced degen.', cls: 'tier-rising' },
            { name: 'DEGEN', lev: '3x', liq: '-10%', desc: 'Fresh off the curve. Tight leash, pure adrenaline.', cls: 'tier-degen' },
          ].map((t, i) => (
            <Reveal delay={i * 0.12} key={t.name}>
              <TiltCard className={`lp-tier ${t.cls}`}>
                <div className="lp-tier-name">{t.name}</div>
                <div className="lp-tier-lev mono">{t.lev}</div>
                <div className="lp-tier-liq">liquidation {t.liq}</div>
                <p className="lp-tier-desc">{t.desc}</p>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Flywheel */}
      <section className="lp-section">
        <Reveal>
          <h2 className="lp-h2">THE <span className="holo-text">FLYWHEEL</span></h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="lp-fly">
            {[
              { k: '50%', v: 'of fees refill the lending pool', c: 'var(--cyan)' },
              { k: '30%', v: 'paid to the token creator', c: 'var(--primary)' },
              { k: '20%', v: 'buys & burns $FRONT', c: 'var(--magenta)' },
            ].map((f) => (
              <div className="lp-fly-item" key={f.k}>
                <span className="lp-fly-k mono" style={{ color: f.c }}>{f.k}</span>
                <span className="lp-fly-v">{f.v}</span>
                <div className="lp-fly-bar"><div style={{ width: f.k, background: f.c }} /></div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Final CTA */}
      <section className="lp-final">
        <Reveal>
          <h2 className="lp-final-h">
            <span className="holo-text">READY TO FRONT?</span>
          </h2>
          <Magnetic className="lp-final-mag">
            <Link to="/trade" className="lp-cta-main lp-cta-big">LAUNCH TERMINAL <span className="lp-cta-arrow">→</span></Link>
          </Magnetic>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-left">
          <span className="lp-logo-text">FRONT</span>
          <span className="lp-footer-dim">built for degens, by degens</span>
        </div>
        <div className="lp-footer-links">
          <a href="https://twitter.com/FrontDotFun" target="_blank" rel="noreferrer">Twitter</a>
          <a href="https://t.me/FrontProtocol" target="_blank" rel="noreferrer">Telegram</a>
          <a href="https://github.com/FrontDotFun/front" target="_blank" rel="noreferrer">GitHub</a>
          <Link to="/docs">Docs</Link>
        </div>
      </footer>
    </div>
  );
};
