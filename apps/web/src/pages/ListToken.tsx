import { type FC, useState } from 'react';
import * as api from '../lib/api';

const stepStyle = {
  background: 'var(--bg-2)',
  borderRadius: 0,
  padding: '20px 24px',
  border: '1px solid var(--border)',
} as const;

const numStyle = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: 'var(--primary)',
  color: '#060605',
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
  borderRadius: 0,
  color: 'var(--text-0)',
  fontSize: '0.9rem',
  fontFamily: 'inherit',
  outline: 'none',
} as const;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const guideImgStyle = {
  width: '100%',
  display: 'block',
  border: '1px solid var(--border)',
  borderRadius: 0,
} as const;

export const ListToken: FC = () => {
  const [tokenAddress, setTokenAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = tokenAddress.trim();
    if (!addr || !BASE58_RE.test(addr)) return;

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

  const stepHead = {
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  } as const;

  return (
    <div className="fade-in" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>List Your Coin</h2>
        <p className="text-muted" style={{ fontSize: '0.93rem', margin: 0 }}>
          Launch on pump.fun, paste your coin's mint address — SCALE verifies the
          pump.fun launch <b>automatically on-chain</b>. No forms, no fee-wallet setup.
          Tier, name, and logo are auto-detected, and your creator revenue share is
          paid straight to your launch wallet.
        </p>
      </div>

      {/* Step 1 — Go to pump.fun and hit Create */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 1 — Go to pump.fun and hit “Create”
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          Head to <a href="https://pump.fun" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>pump.fun</a> and
          click the <b>+ Create</b> button in the top-right corner. Any genuine
          pump.fun launch qualifies for SCALE — still on the bonding curve or
          already graduated.
        </p>
        <img
          src="/guide/pumpfun-home.jpg"
          alt="pump.fun homepage — the Create button sits in the top-right corner"
          style={guideImgStyle}
        />
      </div>

      {/* Step 2 — Fill in the coin and launch */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 2 — Name your coin and launch it
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          Pick a name, ticker, and image — these can't be changed later. Launch
          with the wallet you want paid: <b>the launch wallet is your creator
          wallet</b>, and that's where SCALE sends your revenue share. No fee
          redirects, nothing else to configure.
        </p>
        <img
          src="/guide/pumpfun-create.png"
          alt="pump.fun Create new coin form — coin name, ticker, description, and image"
          style={guideImgStyle}
        />
      </div>

      {/* Step 3 — Copy the mint address */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 3 — Copy your coin's mint address (CA)
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          Open your coin's page on pump.fun and click the address chip next to the
          market cap (it always ends in <code style={{ color: 'var(--primary)' }}>pump</code>)
          to copy the contract address. That's the mint address SCALE needs.
        </p>
        <img
          src="/guide/pumpfun-coin.png"
          alt="pump.fun coin page — the contract address chip next to the market cap copies the mint address"
          style={guideImgStyle}
        />
      </div>

      {/* Step 4 — Paste it below */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 4 — Paste the mint address below
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
          SCALE verifies the pump.fun launch automatically on-chain — name, logo,
          and risk tier are auto-detected, and the 30% revenue share is paid to
          your launch wallet. Coins that were not launched on pump.fun are
          rejected with the exact reason.
        </p>
      </div>

      {/* Listing Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
            Mint Address
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="Paste pump.fun coin mint address"
            style={inputStyle}
            required
          />
          <div style={{ fontSize: '0.72rem', color: '#67704f', marginTop: 4 }}>
            Tier is auto-detected by market cap. The pump.fun launch is verified on-chain.
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !BASE58_RE.test(tokenAddress.trim())}
          style={{
            padding: '12px 0',
            fontSize: '0.93rem',
            fontWeight: 600,
            background: 'var(--primary)',
            color: '#060605',
            border: 'none',
            borderRadius: 0,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.7 : 1,
            width: '100%',
          }}
        >
          {loading ? 'Verifying & Listing...' : 'List Coin'}
        </button>

        {result && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 0,
            background: result.success ? 'rgba(200, 255, 0, 0.08)' : 'rgba(255, 77, 77, 0.08)',
            border: `1px solid ${result.success ? '#c8ff00' : '#ff4d4d'}`,
            color: result.success ? '#c8ff00' : '#ff4d4d',
            fontSize: '0.86rem',
          }}>
            {result.message}
          </div>
        )}
      </form>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[
          { title: 'Launch on pump.fun', desc: 'Hit Create on pump.fun, pick a name and image, and launch. The wallet you launch with is your creator wallet — no extra setup, no fee redirects.' },
          { title: 'Copy the Mint Address', desc: 'On your coin\'s pump.fun page, click the address chip (ends in "pump") to copy the CA.' },
          { title: 'Auto-Verified Listing', desc: 'Paste the mint above. SCALE verifies the genuine pump.fun launch on-chain and auto-detects name, symbol, logo, and risk tier.' },
          { title: 'Earn 30% of Flat Fees', desc: 'Your coin appears on the Explorer. Traders take leveraged positions with real Jupiter swaps, and 30% of every flat fee accrues to your launch wallet — claim it from the Creator dashboard.' },
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
