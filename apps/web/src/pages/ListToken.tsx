import { type FC, useState } from 'react';
import * as api from '../lib/api';

const PROTOCOL_WALLET = '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

const stepStyle = {
  background: 'var(--bg-2)',
  borderRadius: 'var(--radius-lg)',
  padding: '20px 24px',
  border: '1px solid var(--border)',
} as const;

const numStyle = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: '#8b5cff',
  color: '#050408',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.78rem',
  fontWeight: 700,
  flexShrink: 0,
} as const;

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  background: 'var(--bg-1)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-0)',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  outline: 'none',
} as const;

export const ListToken: FC = () => {
  const [tokenAddress, setTokenAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(PROTOCOL_WALLET);
    } catch {
      // clipboard unavailable
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = tokenAddress.trim();
    if (!addr || addr.length < 32) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await api.listToken(addr);
      setResult({
        success: true,
        message: `${res.name || 'Token'} (${res.symbol || addr.slice(0, 6)}) listed as ${res.tierLabel || res.tier} — up to ${res.maxLeverage}x leverage`,
      });
      setTokenAddress('');
    } catch (err: any) {
      // Extract the actual error message from the API response
      let msg = 'Failed to list token';
      if (err?.body) {
        const b = err.body as any;
        if (b.details?.length) msg = b.details[0];
        else if (b.error) msg = b.error;
      } else if (err?.message) {
        msg = err.message;
      }
      setResult({ success: false, message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>List Your Token</h2>
        <p className="text-muted" style={{ fontSize: '0.93rem', margin: 0 }}>
          Redirect your pump.fun creator fees to the Front Protocol wallet, then paste your token address below. Tier, name, and logo are auto-detected.
        </p>
      </div>

      {/* Protocol Wallet */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Step 1 — Redirect Creator Rewards to This Wallet
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <code className="mono" style={{ fontSize: '0.86rem', color: 'var(--text-0)', flex: 1, wordBreak: 'break-all' }}>
            {PROTOCOL_WALLET}
          </code>
          <button className="btn btn-outline btn-sm" onClick={handleCopy} type="button">
            Copy
          </button>
        </div>
      </div>

      {/* Listing Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
            Step 2 — Paste Token Contract Address
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="Paste Solana token address..."
            style={inputStyle}
            required
          />
          <div style={{ fontSize: '0.72rem', color: '#5e5680', marginTop: 4 }}>
            Tier is auto-detected by market cap. Creator fee wallet is verified on-chain.
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || tokenAddress.trim().length < 32}
          style={{
            padding: '12px 0',
            fontSize: '0.93rem',
            fontWeight: 600,
            background: '#8b5cff',
            color: '#050408',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
            width: '100%',
          }}
        >
          {loading ? 'Verifying & Listing...' : 'List Token'}
        </button>

        {result && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: result.success ? 'rgba(0, 255, 163, 0.08)' : 'rgba(255, 61, 113, 0.08)',
            border: `1px solid ${result.success ? '#00ffa3' : '#ff3d71'}`,
            color: result.success ? '#00ffa3' : '#ff3d71',
            fontSize: '0.86rem',
          }}>
            {result.message}
          </div>
        )}
      </form>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { title: 'Redirect Creator Rewards', desc: 'On Pump.fun, redirect your token\'s creator rewards to the Front Protocol wallet above. This funds the capital pool for leveraged trading.' },
          { title: 'Paste Token Address', desc: 'Paste your token contract address above. Front auto-detects your token\'s name, symbol, logo, and risk tier based on market cap.' },
          { title: 'On-Chain Verification', desc: 'Front verifies on-chain that your creator fee wallet is redirected to the protocol. Tokens without valid fee redirects are rejected.' },
          { title: 'Live on Front', desc: 'Your token appears on the Explore page. Traders can take leveraged positions, driving volume and attention to your token.' },
        ].map((step, i) => (
          <div key={i} style={stepStyle}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={numStyle}>{i + 1}</div>
              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: '0.93rem' }}>{step.title}</h4>
                <p className="text-muted" style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.6 }}>
                  {step.desc}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
