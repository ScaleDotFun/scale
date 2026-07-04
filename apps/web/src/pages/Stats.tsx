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
          Real-time overview of the Front Protocol
        </p>
      </div>

      {error && (
        <div className="alert alert-error" style={{ padding: '12px 16px', borderRadius: 8 }}>
          Failed to load stats: {String(error)}
        </div>
      )}

      {/* Main Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="stat-card">
          <div className="stat-card-label">Capital Pool</div>
          <div className="stat-card-value" style={{ color: 'var(--primary)' }}>
            {formatNumber(poolSizeSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">Available for lending</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">$FRONT Burned</div>
          <div className="stat-card-value" style={{ color: 'var(--yellow)' }}>
            {formatNumber(totalBurnedSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">20% of fee revenue</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">Insurance Fund</div>
          <div className="stat-card-value">
            — <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">Edge case coverage</div>
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
          <div className="stat-card-label">Total Volume</div>
          <div className="stat-card-value">
            — <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">Traded through protocol</div>
        </div>

        <div className="stat-card">
          <div className="stat-card-label">$FRONT Locked</div>
          <div className="stat-card-value">
            {formatNumber(totalLockedSol)} <span style={{ fontSize: '0.79rem' }}>SOL</span>
          </div>
          <div className="stat-card-sub">30% of profits auto-locked</div>
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
                <span className="text-secondary">Auto-buy $FRONT (locked 7d)</span>
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
                <span className="text-secondary">Buy & burn $FRONT</span>
                <span className="mono text-yellow">20%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Protocol Guarantees */}
      <div className="card" style={{ padding: 20, borderColor: 'rgba(139, 92, 255, 0.15)' }}>
        <h3 style={{ marginBottom: 12 }}>Protocol Guarantees</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.86rem', color: 'var(--text-1)' }}>
          <div>• <strong>Auto-liquidation safety</strong> — positions auto-close before protocol capital is at risk, with a 5% safety buffer</div>
          <div>• <strong>No manual listing required</strong> — token listing is automatic and verifiable on-chain when creator rewards are redirected</div>
          <div>• <strong>Insurance fund</strong> — covers edge cases from extreme slippage during liquidation</div>
          <div>• <strong>On-chain verifiable</strong> — all fee sharing configs are immutable and transparent</div>
        </div>
      </div>
    </div>
  );
};
