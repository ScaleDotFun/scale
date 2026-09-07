import { type FC, useState } from 'react';
import * as api from '../lib/api';
import { isValidAddress } from '../lib/format';
import { useStats } from '../hooks/useStats';

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

const calloutStyle = {
  background: 'var(--bg-1)',
  border: '1px solid var(--border)',
  padding: '12px 14px',
  fontSize: '0.8rem',
  lineHeight: 1.65,
} as const;

const codeStyle = {
  color: 'var(--primary)',
  wordBreak: 'break-all',
} as const;

export const ListToken: FC = () => {
  const [tokenAddress, setTokenAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { stats } = useStats();
  const poolWallet = stats?.poolWalletAddress ?? null;

  const copyPool = () => {
    if (!poolWallet) return;
    navigator.clipboard.writeText(poolWallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = tokenAddress.trim();
    if (!isValidAddress(addr)) return;

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
          The deal is simple: point your coin's PONS <b>creator fee</b> at the LOADED
          pool, and your coin gets leverage trading. LOADED verifies the recipient
          <b> on-chain, automatically</b> — no forms, no DMs. In return you earn{' '}
          <b>30% of every flat fee</b> traded on your coin, forever.
        </p>
      </div>

      {/* How the PONS fee works */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          What you're actually giving up
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          PONS takes <b>1% of every trade</b> on your bonding curve and splits it{' '}
          <b>70% to the creator, 30% to the protocol</b>. The 70% creator slice is
          paid to whatever address is set as the curve's creator fee recipient —
          that's the only thing you change. The PONS protocol's 30% is untouched,
          and your token contract, supply, and curve stay exactly as launched.
        </p>
        <div style={calloutStyle}>
          <span className="text-muted">
            You hand over the 70% creator slice and take back <b>30% of every LOADED
            flat fee</b> on leveraged trades of your coin. Leverage multiplies the
            volume that fee is charged on, which is why the trade is usually
            lopsided in your favor.
          </span>
        </div>
      </div>

      {/* Step 1 — Launch on PONS */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 1 — Launch your coin on PONS
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
          Create your coin on PONS as usual — name, ticker, image, launch. Any
          genuine PONS launch on Robinhood Chain qualifies for LOADED, whether
          it's still on the bonding curve or has already graduated to Uniswap V4.
          Nothing here has to be decided at launch time; the fee recipient can be
          changed later.
        </p>
      </div>

      {/* Step 2 — Point the creator fee at the pool */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 2 — Set your creator fee recipient to the LOADED pool
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 12px' }}>
          From the wallet that deployed the coin, call{' '}
          <code style={codeStyle}>setCreatorFeeRecipient(address)</code> on your
          coin's PONS bonding-curve contract with the pool address below — either
          from your coin's creator settings on PONS, or straight from the contract
          write tab on the explorer. Only the deployer can set it.
        </p>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          background: 'var(--bg-1)', border: '1px solid var(--primary)', padding: '10px 14px',
        }}>
          <span className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', flexShrink: 0 }}>
            Pool wallet
          </span>
          <code style={{ fontSize: '0.78rem', color: 'var(--primary)', wordBreak: 'break-all', flex: 1 }}>
            {poolWallet ?? 'loading…'}
          </code>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={copyPool}
            disabled={!poolWallet}
            style={{ flexShrink: 0 }}
          >
            {copied ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
        <div style={calloutStyle}>
          <span className="text-muted">
            Copy the address character for character and check it after pasting.
            Creator fees paid to a wrong address are gone — LOADED cannot recover
            them, and the listing check will simply fail.
          </span>
        </div>
      </div>

      {/* Step 3 — Copy the contract address */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 3 — Copy your coin's contract address (CA)
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
          Open your coin's page on PONS and copy the contract address chip — a
          40-character Robinhood Chain address starting with{' '}
          <code style={codeStyle}>0x</code>. That's the token address, not the
          curve address; LOADED resolves the curve from it.
        </p>
      </div>

      {/* Step 4 — Paste it below */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={stepHead}>
          Step 4 — Paste the contract address below
        </span>
        <p className="text-muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
          LOADED reads your coin's creator fee recipient straight from the chain.
          If it's the pool wallet, you're listed instantly — name, logo, and risk
          tier auto-detected. If not, you get the exact reason and what to fix.
          Re-routing the fee away later delists the coin automatically, so the
          deal stays honest both ways.
        </p>
      </div>

      {/* Listing Form */}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-1)', marginBottom: 6, display: 'block' }}>
            Contract Address
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            style={inputStyle}
            required
          />
          <div style={{ fontSize: '0.72rem', color: '#67704f', marginTop: 4 }}>
            Tier is auto-detected by market cap. The PONS launch is verified on-chain.
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !isValidAddress(tokenAddress)}
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
          { title: 'Launch on PONS', desc: 'Create your coin on PONS — name, ticker, image, launch. Bonding curve or already graduated, both qualify.' },
          { title: 'Route the Creator Fee to the Pool', desc: 'Call setCreatorFeeRecipient with the LOADED pool address on your curve. PONS charges 1% per trade split 70% creator / 30% protocol — the 70% creator slice is what you route.' },
          { title: 'Paste the Contract Address', desc: 'Copy the 0x… CA from your coin\'s PONS page, paste it above, and LOADED lists it instantly with tier, name, and logo auto-detected.' },
          { title: 'Earn 30% of Flat Fees', desc: 'Traders take leveraged positions on your coin with real on-chain swaps, and 30% of every flat fee accrues to your launch wallet — usually worth far more than the creator fee you routed.' },
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
