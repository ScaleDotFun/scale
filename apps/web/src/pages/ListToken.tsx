import { type FC } from 'react';

const PROTOCOL_WALLET = 'FRoNTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

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
  background: 'var(--blue)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.78rem',
  fontWeight: 700,
  flexShrink: 0,
} as const;

export const ListToken: FC = () => {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(PROTOCOL_WALLET);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="fade-in" style={{ maxWidth: 680, display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>List Your Token</h2>
        <p className="text-muted" style={{ fontSize: '0.93rem', margin: 0 }}>
          Listing is automatic and permissionless. No accounts, no forms — just on-chain verification.
        </p>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={stepStyle}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={numStyle}>1</div>
            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.93rem' }}>Redirect Creator Rewards</h4>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.6 }}>
                On Pump.fun, redirect your token&apos;s creator rewards to the Front Protocol wallet.
                This is what funds the capital pool that enables leveraged trading on your coin.
              </p>
            </div>
          </div>
        </div>

        <div style={stepStyle}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={numStyle}>2</div>
            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.93rem' }}>Automatic Detection</h4>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.6 }}>
                The protocol monitors on-chain transactions. Once your creator rewards are detected
                flowing to the protocol wallet, your token is automatically listed.
              </p>
            </div>
          </div>
        </div>

        <div style={stepStyle}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={numStyle}>3</div>
            <div>
              <h4 style={{ margin: '0 0 6px', fontSize: '0.93rem' }}>Live on front.fun</h4>
              <p className="text-muted" style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.6 }}>
                Your token appears on the trading page. Traders can now take leveraged positions
                on your coin, driving more volume and attention.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Protocol Wallet */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <span className="text-muted" style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Protocol Wallet
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

      {/* Info */}
      <div className="card" style={{ padding: '16px 20px', borderColor: 'var(--blue)', borderWidth: 1 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: '0.93rem', color: 'var(--blue)' }}>How it works</h4>
        <ul className="text-muted" style={{ margin: 0, paddingLeft: 20, fontSize: '0.86rem', lineHeight: 1.8 }}>
          <li>Your creator rewards fund the protocol&apos;s capital pool</li>
          <li>The pool enables leveraged trading on your token</li>
          <li>Bonded tokens get higher max leverage (7x vs 5x)</li>
          <li>Listing persists as long as rewards are redirected</li>
          <li>No accounts, no KYC, no manual approval — fully on-chain</li>
        </ul>
      </div>
    </div>
  );
};
