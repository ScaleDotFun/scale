import { type FC, useState, useEffect } from 'react';
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

export const ListToken: FC = () => {
  const [tokenAddress, setTokenAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  // Live pool wallet from on-chain stats — null until the EVM pool
  // wallet is configured; never show a stale hardcoded address
  const [protocolWallet, setProtocolWallet] = useState<string | null>(null);
  useEffect(() => {
    api.getProtocolStats()
      .then((s) => setProtocolWallet(s.poolWalletAddress ?? null))
      .catch(() => setProtocolWallet(null));
  }, []);

  const handleCopy = async () => {
    try {
      if (protocolWallet) await navigator.clipboard.writeText(protocolWallet);
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

  const shotFrame = {
    border: '1px solid var(--border)',
    background: 'var(--bg-1)',
    padding: 6,
  } as const;
  const shotImg = { width: '100%', display: 'block' } as const;
  const stepHead = {
    fontSize: '0.78rem',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  } as const;

  return (
    <div className="fade-in" style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>List Your Token</h2>
        <p className="text-muted" style={{ fontSize: '0.93rem', margin: 0 }}>
          Launch on Noxa, point the fee wallet at the SCALE pool, paste your address —
          the fee redirect is verified <b>instantly on-chain</b> against Noxa's own FeeRouter contract.
          No fees routed, no listing. Tier, name, and logo are auto-detected.
        </p>
      </div>

      {/* Step 1 — Launch on Noxa */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 1 — Launch on Noxa (fun.noxa.fi/robinhood/launch)
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          Uniswap + WETH is the default config — one transaction, liquidity locked, 0.0005 ETH launch fee.
        </p>
        <div style={shotFrame}>
          <img src="/guide/noxa-launch.png" alt="Noxa launch form on fun.noxa.fi — DEX and pair token selection, logo, name and symbol fields" style={shotImg} loading="lazy" />
        </div>
      </div>

      {/* Step 2 — Fee wallet */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 2 — Set CUSTOM FEE WALLET to the SCALE pool
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          In <b>ADVANCED SETTINGS</b> on the launch form, paste the pool wallet below into{' '}
          <b>CUSTOM FEE WALLET</b> — that's the address that "will receive trading fees".
          Already launched? Open your token on Noxa → <b>Manage</b> and set the fee receiver there
          (same on-chain effect).
        </p>
        <div style={shotFrame}>
          <img src="/guide/noxa-feewallet.png" alt="Noxa advanced settings — CUSTOM FEE WALLET input where the SCALE pool wallet address goes" style={shotImg} loading="lazy" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '10px 12px', border: '1px solid var(--border-hover)', background: 'var(--bg-2)' }}>
          <span className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
            Pool wallet
          </span>
          <code className="mono" style={{ fontSize: '0.86rem', color: 'var(--primary)', flex: 1, wordBreak: 'break-all' }}>
            {protocolWallet ?? 'Not configured yet — listing opens at launch'}
          </code>
          {protocolWallet && (
            <button className="btn btn-outline btn-sm" onClick={handleCopy} type="button">
              Copy
            </button>
          )}
        </div>
      </div>

      {/* Step 3 — Listing Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
            Step 3 — Paste Token Contract Address
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="Paste Robinhood Chain token address (0x…)"
            style={inputStyle}
            required
          />
          <div style={{ fontSize: '0.72rem', color: '#67704f', marginTop: 4 }}>
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
            background: 'var(--primary)',
            color: '#060605',
            border: 'none',
            borderRadius: 0,
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
          { title: 'Route Your Noxa Fees', desc: 'On Noxa, set the fee wallet (at launch, or later via Manage) to the SCALE pool wallet above. Those trading fees fund the capital pool for leveraged trading.' },
          { title: 'Paste Token Address', desc: 'Paste your token contract address above. SCALE auto-detects your token\'s name, symbol, logo, and risk tier based on market cap.' },
          { title: 'On-Chain Verification', desc: 'SCALE reads Noxa\'s FeeRouter contract on Robinhood Chain and verifies your fees genuinely route to the pool — instantly. Faked or missing redirects are rejected with the exact reason; a redirect removed later gets the listing deactivated within minutes.' },
          { title: 'Live on SCALE', desc: 'Your token appears on the Explorer. Traders take leveraged positions with real Uniswap V3 swaps, driving volume and attention to your token.' },
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
