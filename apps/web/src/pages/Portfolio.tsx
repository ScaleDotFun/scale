import { type FC, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { usePositions } from '../hooks/usePositions';
import { useBurns } from '../hooks/useBurns';
import { StatValue } from '../components/StatValue';
import { PositionTable } from '../components/PositionTable';
import { TradeHistory } from '../components/TradeHistory';
import { formatSol, formatTimeAgo, formatAddress } from '../lib/format';

export const Portfolio: FC = () => {
  const { isAuthenticated, user } = useAuth();
  const {
    activePositions,
    tradeHistory,
    stats,
    loading,
    isClosing,
    closePosition,
  } = usePositions();
  const { locks, loading: locksLoading } = useBurns();
  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'locks'>('positions');
  const [copied, setCopied] = useState(false);

  if (!isAuthenticated) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h2>Portfolio</h2>
        <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="1.5" style={{ opacity: 0.4 }}>
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
            </svg>
          </div>
          <div style={{ fontSize: '0.93rem', fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
            Sign in to get started
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-2)', maxWidth: 360, margin: '0 auto', lineHeight: 1.6 }}>
            Create an account to track your active positions, trade history, P&L stats, and locked $FRONT tokens. Each account gets a fresh deposit wallet.
          </div>
        </div>
      </div>
    );
  }

  const handleCopyAddress = async () => {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const totalPnlSol = stats.totalPnl / 1e9;
  const pnlColor = totalPnlSol >= 0 ? 'green' as const : 'red' as const;

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Portfolio</h2>

      {/* Deposit Wallet */}
      {user && (
        <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span className="text-muted" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Deposit Wallet</span>
              <span className="mono" style={{ fontSize: 13 }}>{formatAddress(user.walletAddress, 8)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono text-muted" style={{ fontSize: 12 }}>—</span>
              <button className="btn btn-ghost btn-sm" onClick={handleCopyAddress} type="button">
                {copied ? 'Copied' : 'Copy Address'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="stat-value-group" style={{ marginBottom: 24 }}>
        <StatValue
          label="Total P&L"
          value={loading ? '...' : `${totalPnlSol >= 0 ? '+' : ''}${totalPnlSol.toFixed(4)} SOL`}
          color={loading ? undefined : pnlColor}
        />
        <StatValue
          label="Win Rate"
          value={loading ? '...' : `${stats.winRate.toFixed(1)}%`}
        />
        <StatValue
          label="Trades"
          value={loading ? '...' : String(stats.totalTrades)}
        />
        <StatValue
          label="Locked $FRONT"
          value={locksLoading ? '...' : `${locks.filter((l) => !l.isUnlocked).length} active`}
        />
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'positions' ? 'active' : ''}`}
          onClick={() => setActiveTab('positions')}
          type="button"
        >
          Active Positions {activePositions.length > 0 ? `(${activePositions.length})` : ''}
        </button>
        <button
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
          type="button"
        >
          Trade History
        </button>
        <button
          className={`tab ${activeTab === 'locks' ? 'active' : ''}`}
          onClick={() => setActiveTab('locks')}
          type="button"
        >
          Locked Tokens
        </button>
      </div>

      {activeTab === 'positions' && (
        <PositionTable
          positions={activePositions}
          loading={loading}
          isClosing={isClosing}
          onClose={closePosition}
        />
      )}

      {activeTab === 'history' && (
        <TradeHistory
          trades={tradeHistory}
          loading={loading}
        />
      )}

      {activeTab === 'locks' && (
        <div>
          {locksLoading ? (
            <div className="empty-state"><span className="spinner" /></div>
          ) : locks.length === 0 ? (
            <div className="empty-state">No locked tokens</div>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Unlock Date</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {locks.map((lock) => (
                    <tr key={lock.id}>
                      <td>{formatSol(lock.solAmount || '0', 4)}</td>
                      <td>{formatTimeAgo(lock.unlocksAt)}</td>
                      <td>
                        <span className={lock.isUnlocked ? 'text-green' : 'text-yellow'}
                          style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                          {lock.isUnlocked ? 'Unlocked' : 'Locked'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
