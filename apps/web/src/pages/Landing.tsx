import { type FC, useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';

/* ── Animated price line for the hero ───────────────────── */
const HeroPriceLine: FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const rw = w / 2;
    const rh = h / 2;

    let points: number[] = [];
    const numPoints = 120;
    let price = rh * 0.5;

    for (let i = 0; i < numPoints; i++) {
      price += (Math.random() - 0.47) * 3;
      price = Math.max(rh * 0.15, Math.min(rh * 0.85, price));
      points.push(price);
    }

    let frame = 0;
    let raf: number;

    const draw = () => {
      ctx.clearRect(0, 0, rw, rh);

      // Add new point
      price += (Math.random() - 0.47) * 2.5;
      price = Math.max(rh * 0.15, Math.min(rh * 0.85, price));
      points.push(price);
      if (points.length > numPoints) points.shift();

      // Gradient fill
      const grad = ctx.createLinearGradient(0, 0, 0, rh);
      grad.addColorStop(0, 'rgba(240, 185, 11, 0.08)');
      grad.addColorStop(1, 'rgba(240, 185, 11, 0)');

      ctx.beginPath();
      ctx.moveTo(0, rh);
      points.forEach((p, i) => {
        const x = (i / (numPoints - 1)) * rw;
        ctx.lineTo(x, p);
      });
      ctx.lineTo(rw, rh);
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = (i / (numPoints - 1)) * rw;
        if (i === 0) ctx.moveTo(x, p);
        else ctx.lineTo(x, p);
      });
      ctx.strokeStyle = '#f0b90b';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Dot at end
      const lastX = rw;
      const lastY = points[points.length - 1];
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#f0b90b';
      ctx.fill();

      // Glow ring
      ctx.beginPath();
      ctx.arc(lastX, lastY, 6 + Math.sin(frame * 0.08) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240, 185, 11, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      frame++;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0.5,
        pointerEvents: 'none',
      }}
    />
  );
};

/* ── Interactive Leverage Calculator ───────────────────── */
const LeverageDemo: FC = () => {
  const [collateral, setCollateral] = useState(0.5);
  const [leverage, setLeverage] = useState(5);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const positionSize = collateral * leverage;
  const protocolFills = collateral * (leverage - 1);
  const fee = positionSize * 0.005;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6 }}
      style={{
        background: '#0a0a0a',
        border: '1px solid #1a1a1a',
        borderRadius: 12,
        padding: 32,
        maxWidth: 520,
        width: '100%',
      }}
    >
      <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>
        Try It — Leverage Calculator
      </div>

      {/* Collateral slider */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#888' }}>Your Collateral</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
            {collateral.toFixed(2)} SOL
          </span>
        </div>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={collateral}
          onChange={(e) => setCollateral(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#f0b90b' }}
        />
      </div>

      {/* Leverage slider */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#888' }}>Leverage</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#f0b90b', fontFamily: 'var(--font-mono)' }}>
            {leverage}x
          </span>
        </div>
        <input
          type="range"
          min="2"
          max="10"
          step="1"
          value={leverage}
          onChange={(e) => setLeverage(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: '#f0b90b' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#444', marginTop: 4 }}>
          <span>2x</span><span>5x</span><span>10x</span>
        </div>
      </div>

      {/* Visual breakdown */}
      <div style={{ display: 'flex', gap: 2, height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 16 }}>
        <motion.div
          animate={{ width: `${(collateral / positionSize) * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          style={{
            background: '#f0b90b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: '#000',
            minWidth: 40,
          }}
        >
          YOU
        </motion.div>
        <motion.div
          animate={{ width: `${(protocolFills / positionSize) * 100}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          style={{
            background: '#1a5c2e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: '#00c853',
            minWidth: 60,
          }}
        >
          PROTOCOL
        </motion.div>
      </div>

      {/* Numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={{ background: '#111', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
            {positionSize.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>POSITION SOL</div>
        </div>
        <div style={{ background: '#111', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#00c853', fontFamily: 'var(--font-mono)' }}>
            {protocolFills.toFixed(2)}
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>PROTOCOL FILLS</div>
        </div>
        <div style={{ background: '#111', borderRadius: 8, padding: '12px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#f0b90b', fontFamily: 'var(--font-mono)' }}>
            {fee.toFixed(3)}
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>FEE SOL</div>
        </div>
      </div>
    </motion.div>
  );
};

/* ── Animated Protocol Flow ──────────────────────────── */
const ProtocolFlow: FC = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const steps = [
    { icon: 'M12 2v6m0 0l3-3m-3 3L9 5', label: 'Deposit SOL', sub: 'Put up collateral', color: '#f0b90b' },
    { icon: 'M4 12h16m-8-8v16', label: 'Protocol Fills', sub: 'Remaining position', color: '#00c853' },
    { icon: 'M22 12l-4-4v3H8v2h10v3l4-4z', label: 'Jupiter Swap', sub: 'Real on-chain buy', color: '#26c6da' },
    { icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', label: 'Auto-Managed', sub: 'Risk engine monitors', color: '#ab47bc' },
    { icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8v12', label: 'Take Profit', sub: 'You keep 70%', color: '#f0b90b' },
  ];

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 0, flexWrap: 'wrap' }}>
      {steps.map((step, i) => (
        <motion.div
          key={step.label}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: i * 0.12, duration: 0.5 }}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: 120,
            textAlign: 'center',
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: `${step.color}15`,
              border: `1px solid ${step.color}30`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={step.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={step.icon} />
              </svg>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{step.label}</div>
            <div style={{ fontSize: 10, color: '#555' }}>{step.sub}</div>
          </div>

          {/* Arrow connector */}
          {i < steps.length - 1 && (
            <motion.div
              initial={{ opacity: 0, scaleX: 0 }}
              animate={isInView ? { opacity: 1, scaleX: 1 } : {}}
              transition={{ delay: i * 0.12 + 0.3, duration: 0.3 }}
              style={{ color: '#333', fontSize: 18, margin: '0 -4px', marginBottom: 20 }}
            >
              &rarr;
            </motion.div>
          )}
        </motion.div>
      ))}
    </div>
  );
};

/* ── P&L Scenario Cards ──────────────────────────────── */
const ScenarioCards: FC = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const scenarios = [
    {
      title: 'Token pumps +20%',
      collateral: '0.5 SOL',
      leverage: '5x',
      position: '2.5 SOL',
      result: '+1.0 SOL',
      resultColor: '#00c853',
      note: 'You get 0.7 SOL, 0.3 SOL locks into $FRONT',
      bg: '#00c85308',
      border: '#00c85320',
    },
    {
      title: 'Token dumps -8%',
      collateral: '0.5 SOL',
      leverage: '5x',
      position: '2.5 SOL',
      result: '-0.2 SOL',
      resultColor: '#ff3b3b',
      note: 'Auto-closed before hitting -10% threshold',
      bg: '#ff3b3b08',
      border: '#ff3b3b20',
    },
    {
      title: 'Token crashes -20%',
      collateral: '0.5 SOL',
      leverage: '5x',
      position: '2.5 SOL',
      result: '-0.375 SOL',
      resultColor: '#ff3b3b',
      note: 'Already closed at -15%. Protocol capital safe.',
      bg: '#ff3b3b08',
      border: '#ff3b3b20',
    },
  ];

  return (
    <div ref={ref} className="landing-scenarios-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 900 }}>
      {scenarios.map((s, i) => (
        <motion.div
          key={s.title}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: i * 0.1, duration: 0.5 }}
          style={{
            background: s.bg,
            border: `1px solid ${s.border}`,
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>{s.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555' }}>Collateral</span>
              <span style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{s.collateral}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555' }}>Leverage</span>
              <span style={{ color: '#f0b90b', fontFamily: 'var(--font-mono)' }}>{s.leverage}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555' }}>Position</span>
              <span style={{ color: '#888', fontFamily: 'var(--font-mono)' }}>{s.position}</span>
            </div>
            <div style={{ height: 1, background: '#1a1a1a', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#555' }}>P&L</span>
              <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.resultColor, fontSize: 15 }}>{s.result}</span>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 10, lineHeight: 1.5 }}>{s.note}</div>
        </motion.div>
      ))}
    </div>
  );
};

/* ── Creator Flow Visual ─────────────────────────────── */
const CreatorFlow: FC = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <div ref={ref} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      {/* Pump.fun box */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={isInView ? { opacity: 1, x: 0 } : {}}
        transition={{ duration: 0.5 }}
        style={{
          background: '#0a0a0a',
          border: '1px solid #1a1a1a',
          borderRadius: 10,
          padding: '20px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 20, marginBottom: 6 }}>pump.fun</div>
        <div style={{ fontSize: 11, color: '#555' }}>Your token lives here</div>
        <div style={{
          marginTop: 12,
          padding: '6px 12px',
          background: '#111',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: '#888',
        }}>
          Creator Rewards: 0.02 SOL/hr
        </div>
      </motion.div>

      {/* Arrow */}
      <motion.div
        initial={{ opacity: 0, scaleX: 0 }}
        animate={isInView ? { opacity: 1, scaleX: 1 } : {}}
        transition={{ delay: 0.3, duration: 0.4 }}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
      >
        <div style={{ fontSize: 10, color: '#f0b90b', fontWeight: 600 }}>REDIRECT</div>
        <svg width="60" height="16" viewBox="0 0 60 16">
          <line x1="0" y1="8" x2="50" y2="8" stroke="#f0b90b" strokeWidth="1.5" strokeDasharray="4 3" />
          <polygon points="50,4 58,8 50,12" fill="#f0b90b" />
        </svg>
        <div style={{ fontSize: 9, color: '#555' }}>Automatic</div>
      </motion.div>

      {/* Front Protocol box */}
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={isInView ? { opacity: 1, x: 0 } : {}}
        transition={{ delay: 0.3, duration: 0.5 }}
        style={{
          background: '#0d0d0d',
          border: '1px solid #f0b90b30',
          borderRadius: 10,
          padding: '20px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 700, color: '#f0b90b', marginBottom: 6 }}>Front Protocol</div>
        <div style={{ fontSize: 11, color: '#555' }}>Token auto-listed</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <div style={{ padding: '6px 12px', background: '#111', borderRadius: 6, fontSize: 11, color: '#00c853', fontFamily: 'var(--font-mono)' }}>
            Leveraged Trading
          </div>
          <div style={{ padding: '6px 12px', background: '#111', borderRadius: 6, fontSize: 11, color: '#f0b90b', fontFamily: 'var(--font-mono)' }}>
            30% Revenue
          </div>
        </div>
      </motion.div>
    </div>
  );
};

/* ── Animated Counter ────────────────────────────────── */
const AnimCounter: FC<{ end: number; suffix: string; label: string }> = ({ end, suffix, label }) => {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (!isInView) return;
    const duration = 1200;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * end));
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [isInView, end]);

  return (
    <div ref={ref} style={{ textAlign: 'center', padding: 20 }}>
      <div style={{ fontSize: 'clamp(1.8rem, 3vw, 2.5rem)', fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono)' }}>
        {val}{suffix}
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
    </div>
  );
};


/* ── Live Activity Feed ────────────────────────── */
const ACTIVITY_ITEMS = [
  { text: 'Front Protocol', detail: 'Leverage trade any memecoin on Solana', color: '#f0b90b' },
  { text: 'Up to 10x', detail: 'Leverage on bonded tokens', color: '#00c853' },
  { text: 'Auto Wallets', detail: 'No wallet connection needed', color: '#2196f3' },
  { text: 'Real Jupiter Swaps', detail: 'On-chain execution', color: '#f0b90b' },
  { text: 'Creator Revenue', detail: '30% of fees to token creators', color: '#00c853' },
  { text: 'Profit Locks', detail: '30% profits locked in $FRONT', color: '#2196f3' },
  { text: 'SOL Burns', detail: '20% of revenue burned forever', color: '#ff3b3b' },
  { text: 'Custodial Wallets', detail: 'Every user gets a Solana wallet', color: '#f0b90b' },
];

const LiveFeed: FC = () => {
  return (
    <section style={{
      padding: '16px 0',
      borderTop: '1px solid #111',
      borderBottom: '1px solid #111',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        gap: 40,
        animation: 'scroll-left 40s linear infinite',
        width: 'max-content',
      }}>
        {[...ACTIVITY_ITEMS, ...ACTIVITY_ITEMS, ...ACTIVITY_ITEMS].map((item, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            fontSize: 12,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: item.color, display: 'inline-block',
            }} />
            <span style={{ color: item.color, fontWeight: 700 }}>{item.text}</span>
            <span style={{ color: '#555' }}>{item.detail}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes scroll-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.33%); }
        }
      `}</style>
    </section>
  );
};

/* ── Mini Sparkline ──────────────────────────────────── */
const Sparkline: FC<{ data: number[]; color: string; width?: number; height?: number }> = ({
  data, color, width = 100, height = 32,
}) => {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height * 0.8 - height * 0.1}`
  ).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#sg-${color.replace('#', '')})`}
      />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
};

/* ── Trending Token Cards ────────────────────────────── */
const FEATURE_CARDS = [
  { title: 'Bonded Tokens', desc: 'Up to 10x leverage', detail: 'Highest liquidity, lowest risk' },
  { title: 'Rising Tokens', desc: 'Up to 5x leverage', detail: 'Growing liquidity, moderate risk' },
  { title: 'Degen Tokens', desc: 'Up to 3x leverage', detail: 'New launches, higher risk' },
  { title: 'Auto Wallets', desc: 'No wallet needed', detail: 'Fresh Solana wallet per account' },
  { title: 'Jupiter Swaps', desc: 'Real on-chain trades', detail: 'Aggregated best price execution' },
  { title: 'Creator Revenue', desc: '30% fee share', detail: 'Token creators earn from leverage trades' },
];

const TrendingTokens: FC = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <div ref={ref} style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 12,
    }} className="landing-features-grid">
      {FEATURE_CARDS.map((card, i) => (
        <motion.div
          key={card.title}
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: i * 0.08, duration: 0.4 }}
          style={{
            background: '#0a0a0a',
            border: '1px solid #1a1a1a',
            borderRadius: 10,
            padding: 16,
            transition: 'border-color 0.2s',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
                {card.title}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                {card.detail}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#f0b90b',
                fontFamily: 'var(--font-mono)',
              }}>
                {card.desc}
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};


/* ── Comparison Table ────────────────────────────────── */
const ComparisonTable: FC = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  const rows = [
    { feature: 'Capital efficiency', normal: false, front: true },
    { feature: 'Leveraged positions', normal: false, front: true },
    { feature: 'Real on-chain execution', normal: true, front: true },
    { feature: 'No synthetic/perps', normal: false, front: true },
    { feature: 'Creator revenue sharing', normal: false, front: true },
    { feature: 'Auto risk management', normal: false, front: true },
    { feature: 'No KYC to trade', normal: true, front: true },
    { feature: 'Auto-liquidation safety', normal: false, front: true },
  ];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
      style={{
        background: '#0a0a0a',
        border: '1px solid #1a1a1a',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px 120px',
        padding: '14px 20px',
        borderBottom: '1px solid #1a1a1a',
        background: '#080808',
      }}>
        <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Feature</span>
        <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Normal</span>
        <span style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', fontWeight: 700 }}>Front</span>
      </div>
      {rows.map((r, i) => (
        <motion.div
          key={r.feature}
          initial={{ opacity: 0, x: -10 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ delay: 0.3 + i * 0.05, duration: 0.3 }}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 120px 120px',
            padding: '12px 20px',
            borderBottom: i < rows.length - 1 ? '1px solid #111' : 'none',
          }}
        >
          <span style={{ fontSize: 13, color: '#ccc' }}>{r.feature}</span>
          <div style={{ textAlign: 'center' }}>
            {r.normal ? (
              <span style={{ color: '#00c853' }}>&#10003;</span>
            ) : (
              <span style={{ color: '#ff3b3b' }}>&#10007;</span>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#00c853', fontWeight: 700 }}>&#10003;</span>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
};

/* ── FAQ Accordion ───────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: 'How does leveraged memecoin trading work?',
    a: 'You deposit SOL as collateral. The protocol lends you additional capital to open a larger position. Your trade is executed as a real on-chain Jupiter swap — not a synthetic perpetual. When the price moves, your P&L is based on the full leveraged position.',
  },
  {
    q: 'How does the protocol manage risk?',
    a: 'Every position has strict auto-close thresholds. If the price drops to a point where it would eat into the protocol\'s capital, the position is automatically liquidated with a safety buffer. The protocol always recovers its principal plus fees before any scenario can create a loss.',
  },
  {
    q: 'How do I get my token listed?',
    a: 'No application needed. Simply redirect your Pump.fun creator reward allocation to the Front Protocol wallet address. Our on-chain scanner detects this automatically and lists your token. It\'s permissionless and verifiable.',
  },
  {
    q: 'What happens to profits from trades?',
    a: '70% of profits go to you as SOL. 30% is used to auto-buy $FRONT tokens which are locked for 7 days. This creates sustainable demand for the $FRONT token while rewarding traders.',
  },
  {
    q: 'Is this a perpetual exchange?',
    a: 'No. Front executes real spot buys on Jupiter. When you open a leveraged position, actual tokens are purchased on-chain. This means you get real price exposure with real liquidity, not a synthetic derivative.',
  },
];

const FAQItem: FC<{ item: typeof FAQ_ITEMS[0]; index: number }> = ({ item, index }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 10 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ delay: index * 0.08, duration: 0.3 }}
      style={{
        borderBottom: '1px solid #1a1a1a',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '18px 0',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, color: '#fff', fontWeight: 500 }}>{item.q}</span>
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2 }}
          style={{ fontSize: 18, color: '#f0b90b', fontWeight: 300, flexShrink: 0, marginLeft: 16 }}
        >
          +
        </motion.span>
      </button>
      <motion.div
        initial={false}
        animate={{
          height: open ? 'auto' : 0,
          opacity: open ? 1 : 0,
        }}
        transition={{ duration: 0.25 }}
        style={{ overflow: 'hidden' }}
      >
        <p style={{
          fontSize: 13,
          color: '#777',
          lineHeight: 1.7,
          paddingBottom: 18,
          margin: 0,
        }}>
          {item.a}
        </p>
      </motion.div>
    </motion.div>
  );
};

const FAQ: FC = () => (
  <div style={{
    background: '#0a0a0a',
    border: '1px solid #1a1a1a',
    borderRadius: 12,
    padding: '0 24px',
  }}>
    {FAQ_ITEMS.map((item, i) => (
      <FAQItem key={i} item={item} index={i} />
    ))}
  </div>
);


/* ═══════════════════════════════════════════════════════ */
/*  LANDING PAGE                                          */
/* ═══════════════════════════════════════════════════════ */
export const Landing: FC = () => {
  return (
    <div style={{ background: '#000', minHeight: '100vh', overflow: 'hidden' }}>
      {/* ── Nav ─────────────────────────────── */}
      <nav className="landing-nav" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        height: 56,
        borderBottom: '1px solid #111',
        position: 'relative',
        zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f0b90b" strokeWidth="2.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>FRONT</span>
        </div>
        <div className="landing-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <a href="#how-it-works" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>How It Works</a>
          <a href="#leverage" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>Leverage</a>
          <a href="#creators" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>Creators</a>
          <Link to="/docs" style={{ fontSize: 13, color: '#666', textDecoration: 'none' }}>Docs</Link>
        </div>
        <Link
          to="/trade"
          style={{
            padding: '8px 20px',
            background: '#f0b90b',
            color: '#000',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Launch App
        </Link>
      </nav>

      {/* ── Hero ────────────────────────────── */}
      <section className="landing-hero" style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '80px 24px 60px',
        minHeight: 420,
      }}>
        <HeroPriceLine />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{ position: 'relative', zIndex: 1 }}
        >
          <div style={{
            display: 'inline-flex',
            padding: '4px 14px',
            background: '#f0b90b15',
            border: '1px solid #f0b90b30',
            borderRadius: 20,
            fontSize: 11,
            color: '#f0b90b',
            fontWeight: 600,
            marginBottom: 20,
            letterSpacing: '0.04em',
          }}>
            SOLANA LEVERAGED MEMECOINS
          </div>
        </motion.div>

        <motion.h1
          style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.8rem)',
            fontWeight: 800,
            color: '#fff',
            lineHeight: 1.08,
            maxWidth: 650,
            marginBottom: 16,
            position: 'relative',
            zIndex: 1,
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          Trade Memecoins
          <br />
          <span style={{ color: '#f0b90b' }}>With Leverage</span>
        </motion.h1>

        <motion.p
          style={{
            fontSize: 14,
            color: '#666',
            maxWidth: 440,
            lineHeight: 1.7,
            marginBottom: 28,
            position: 'relative',
            zIndex: 1,
          }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          Put up collateral, the protocol fills the rest.
          Up to 10x on any listed Pump.fun token.
        </motion.p>

        <motion.div
          style={{ display: 'flex', gap: 12, position: 'relative', zIndex: 1 }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Link
            to="/trade"
            style={{
              padding: '12px 32px',
              background: '#f0b90b',
              color: '#000',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Start Trading
          </Link>
          <Link
            to="/docs"
            style={{
              padding: '12px 32px',
              background: 'transparent',
              color: '#fff',
              border: '1px solid #222',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Read Docs
          </Link>
        </motion.div>
      </section>

      {/* ── Stats ───────────────────────────── */}
      <section className="landing-stats-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        maxWidth: 800,
        margin: '0 auto',
        borderTop: '1px solid #111',
        borderBottom: '1px solid #111',
      }}>
        <AnimCounter end={10} suffix="x" label="Max Leverage" />
        <AnimCounter end={0} suffix=".5%" label="Trading Fee" />
        <AnimCounter end={30} suffix="%" label="Creator Share" />
        <AnimCounter end={24} suffix="h" label="Max Duration" />
      </section>

      {/* ── How It Works (Flow) ─────────────── */}
      <section id="how-it-works" style={{ padding: '80px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Protocol Flow</div>
          <h2 style={{ fontSize: '1.5rem', color: '#fff', fontWeight: 700 }}>How It Works</h2>
        </div>
        <ProtocolFlow />
      </section>

      {/* ── Leverage Demo ──────────────────── */}
      <section id="leverage" style={{ padding: '60px 24px 80px', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', gap: 48, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
          <div style={{ flex: '1 1 300px', maxWidth: 380 }}>
            <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Interactive</div>
            <h2 style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 700, marginBottom: 12 }}>
              See How Leverage Works
            </h2>
            <p style={{ fontSize: 13, color: '#666', lineHeight: 1.7, marginBottom: 16 }}>
              Drag the sliders to see your position size change in real time.
              The protocol fills the difference between your collateral and total position.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#f0b90b' }} />
                <span style={{ fontSize: 12, color: '#888' }}>Gold = your collateral</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00c853' }} />
                <span style={{ fontSize: 12, color: '#888' }}>Green = protocol capital</span>
              </div>
            </div>
          </div>
          <LeverageDemo />
        </div>
      </section>

      {/* ── P&L Scenarios ──────────────────── */}
      <section style={{ padding: '60px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Scenarios</div>
          <h2 style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 700 }}>What Happens When...</h2>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ScenarioCards />
        </div>
      </section>

      {/* ── For Creators ───────────────────── */}
      <section id="creators" style={{ padding: '60px 24px 80px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>For Token Creators</div>
          <h2 style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 700, marginBottom: 8 }}>
            Get Listed. Earn Revenue.
          </h2>
          <p style={{ fontSize: 13, color: '#666', maxWidth: 460, margin: '0 auto' }}>
            Redirect your Pump.fun creator rewards to the protocol wallet.
            Your token is listed automatically. No forms. No KYC.
          </p>
        </div>
        <CreatorFlow />
      </section>

      {/* ── Live Activity Feed ─────────────── */}
      <LiveFeed />

      {/* ── Trending Tokens ────────────────── */}
      <section style={{ padding: '60px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Trending Now</div>
          <h2 style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 700 }}>Hot Tokens on Front</h2>
        </div>
        <TrendingTokens />
      </section>

      {/* ── Comparison ─────────────────────── */}
      <section style={{ padding: '60px 24px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Why Front</div>
          <h2 style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 700 }}>Front vs Normal Trading</h2>
        </div>
        <ComparisonTable />
      </section>

      {/* ── FAQ ────────────────────────────── */}
      <section style={{ padding: '60px 24px', maxWidth: 700, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: '#f0b90b', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>FAQ</div>
          <h2 style={{ fontSize: '1.4rem', color: '#fff', fontWeight: 700 }}>Common Questions</h2>
        </div>
        <FAQ />
      </section>

      {/* ── Bottom CTA ─────────────────────── */}
      <section style={{
        padding: '60px 24px',
        textAlign: 'center',
        borderTop: '1px solid #111',
      }}>
        <h2 style={{ fontSize: '1.3rem', color: '#fff', fontWeight: 700, marginBottom: 16 }}>
          Ready to trade with leverage?
        </h2>
        <Link
          to="/trade"
          style={{
            display: 'inline-block',
            padding: '14px 40px',
            background: '#f0b90b',
            color: '#000',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Launch App
        </Link>
      </section>

      {/* ── Footer ─────────────────────────── */}
      <footer className="landing-footer" style={{
        padding: '20px 32px',
        borderTop: '1px solid #111',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, color: '#333' }}>Front Protocol</span>
        <div style={{ display: 'flex', gap: 20 }}>
          <Link to="/docs" style={{ fontSize: 11, color: '#333', textDecoration: 'none' }}>Docs</Link>
          <Link to="/stats" style={{ fontSize: 11, color: '#333', textDecoration: 'none' }}>Stats</Link>
          <Link to="/list" style={{ fontSize: 11, color: '#333', textDecoration: 'none' }}>List Token</Link>
        </div>
      </footer>
    </div>
  );
};
