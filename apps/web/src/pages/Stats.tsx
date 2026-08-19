import { type FC } from 'react';
import { useStats } from '../hooks/useStats';
import { formatNumber, formatSol } from '../lib/format';

export const Stats: FC = () => {
  const {
    stats,
    poolSizeSol,
    totalBurnedSol,
    totalLockedSol,
    totalCreatorPayoutsSol,
    loading,
    error,
  } = useStats();

  if (loading) {
    return (
      <div className="fade-in" style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h2 style={{ marginBottom: 4 }}>Protocol Stats</h2>
        <p style={{ fontSize: '0.86rem' }}>
          Real-time overview of the Scale Protocol
        </p>
      </div>

      {error && (
        <div className="alert alert-error" style={{ padding: '12px 16px', borderRadius: 0 }}>
          Failed to load stats: {String(error)}
        </div>
      )}

      {/* Main Stats Grid — every number here is real; pool + locked
          supply are read straight from the chain */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="stat-card">
          <div className="stat-card-label">
            Capital Pool {stats?.poolSourceOnchain && <span style={{ color: 'var(--green)' }}>· on-chain</span>}
          </div>
          <div className="stat-card-value" style={{ color: 'var(--primary)' }}>
            {formatNumber(poolSizeSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">
            {stats?.poolWalletAddress ? (
              <a
                className="link-dim"
                href={`https://solscan.io/account/${stats.poolWalletAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                Live wallet balance — verify on Solscan ↗
              </a>
            ) : (
              'Available for lending'
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">
            $SCALE Locked Supply {stats?.frontLockedPct != null && <span style={{ color: 'var(--green)' }}>· on-chain</span>}
          </div>
          <div className="stat-card-value" style={{ color: 'var(--primary)' }}>
            {stats?.frontLockedPct != null ? `${stats.frontLockedPct.toFixed(2)}%` : '—'}
          </div>
          <div className="stat-card-sub">
            {stats?.frontLockedTokens != null
              ? `${formatNumber(stats.frontLockedTokens)} of ${formatNumber(stats.frontTotalSupply ?? 0)} $SCALE`
              : 'Awaiting on-chain read'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">$SCALE Burned</div>
          <div className="stat-card-value" style={{ color: 'var(--yellow)' }}>
            {formatNumber(totalBurnedSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">20% of fee revenue</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Profit Locks</div>
          <div className="stat-card-value">
            {formatNumber(totalLockedSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">30% of trade profits auto-locked 7d</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Listed Tokens</div>
          <div className="stat-card-value">{stats?.totalListedTokens ?? 0}</div>
          <div className="stat-card-sub">Auto-discovered on-chain</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Active Positions</div>
          <div className="stat-card-value">{stats?.activePositions ?? 0}</div>
          <div className="stat-card-sub">Currently open</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Total Trades</div>
          <div className="stat-card-value">{(stats?.totalTradesExecuted ?? 0).toLocaleString()}</div>
          <div className="stat-card-sub">All time</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Creator Payouts</div>
          <div className="stat-card-value">
            {formatNumber(totalCreatorPayoutsSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">30% of fees, claimed by creators</div>
        </div>
      </div>

      {/* How Revenue Flows */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 16 }}>Revenue Flow</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <h4 style={{ color: 'var(--primary)', marginBottom: 8, fontSize: '0.93rem' }}>
              When Trades Profit
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.86rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">User gets (SOL)</span>
                <span className="mono text-green">70%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Auto-buy $SCALE (locked 7d)</span>
                <span className="mono" style={{ color: 'var(--primary)' }}>30%</span>
              </div>
            </div>
          </div>

          <div>
            <h4 style={{ color: 'var(--cyan)', marginBottom: 8, fontSize: '0.93rem' }}>
              Flat Fee Revenue Split
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.86rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Back to pool</span>
                <span className="mono">50%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Token creator</span>
                <span className="mono">30%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="text-secondary">Buy & burn $SCALE</span>
                <span className="mono text-yellow">20%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Protocol Guarantees */}
      <div className="card" style={{ padding: 20, borderColor: 'rgba(255, 179, 0, 0.15)' }}>
        <h3 style={{ marginBottom: 12 }}>Protocol Guarantees</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.86rem', color: 'var(--text-1)' }}>
          <div>• <strong>Auto-liquidation safety</strong> — positions auto-close before protocol capital is at risk, with a 5% safety buffer</div>
          <div>• <strong>No manual listing required</strong> — token listing is automatic and verifiable on-chain when creator rewards are redirected</div>
          <div>• <strong>On-chain verifiable</strong> — the pool wallet and locked supply shown above are read live from the chain, not a database</div>
        </div>
      </div>
    </div>
  );
};
