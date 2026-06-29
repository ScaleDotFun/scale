import { type FC, useState } from 'react';
import { useBurns } from '../hooks/useBurns';
import { useStats } from '../hooks/useStats';
import { formatSol, formatTimeAgo, formatCountdown, formatNumber, solscanTxUrl } from '../lib/format';

export const Burns: FC = () => {
  const { burns, locks, totalBurned, totalLocked, loading } = useBurns();
  const { totalBurnedSol, totalLockedSol, totalCreatorPayoutsSol } = useStats();
  const [activeTab, setActiveTab] = useState<'burns' | 'locks'>('burns');

  const burnRate = burns.length > 1
    ? (totalBurned / burns.length) / 1e9
    : 0;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats Row */}
      <div className="page-grid page-grid-4">
        <div className="card">
          <div className="stat">
            <span className="stat-label">Total Burned</span>
            <span className="stat-value mono text-yellow">{formatNumber(totalBurnedSol)} SOL</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat-label">Total Locked</span>
            <span className="stat-value mono">{formatNumber(totalLockedSol)} SOL</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat-label">Avg Burn / Trade</span>
            <span className="stat-value mono text-green">{burnRate.toFixed(3)} SOL</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat-label">Creator Payouts</span>
            <span className="stat-value mono text-blue">{formatNumber(totalCreatorPayoutsSol)} SOL</span>
          </div>
        </div>
      </div>

      {/* Feed */}
      <div className="card" style={{ padding: 0 }}>
        <div className="tabs" style={{ padding: '0 16px' }}>
          <button
            className={`tab ${activeTab === 'burns' ? 'active' : ''}`}
            onClick={() => setActiveTab('burns')}
          >
            $FRONT Burns ({burns.length})
          </button>
          <button
            className={`tab ${activeTab === 'locks' ? 'active' : ''}`}
            onClick={() => setActiveTab('locks')}
          >
            $FRONT Locks ({locks.length})
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 16 }}>
            <div className="skeleton skeleton-text" style={{ width: '60%', marginBottom: 8 }} />
            <div className="skeleton skeleton-text" style={{ width: '80%', marginBottom: 8 }} />
            <div className="skeleton skeleton-text" style={{ width: '50%' }} />
          </div>
        ) : activeTab === 'burns' ? (
          burns.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No burns yet</div>
              <div className="empty-state-text">Burns will appear here as trades are executed</div>
            </div>
          ) : (
            <div className="table-wrapper" style={{ maxHeight: 500 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Amount (SOL)</th>
                    <th>$FRONT Burned</th>
                    <th className="text-right">Time</th>
                    <th className="text-right">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {burns.map((burn) => (
                    <tr key={burn.id}>
                      <td className="font-semibold text-primary">{burn.position?.tokenSymbol ?? '--'}</td>
                      <td className="mono text-yellow">{formatSol(BigInt(burn.solAmount || '0'), 4)}</td>
                      <td className="mono text-muted">{formatNumber(Number(burn.tokenAmount || 0))}</td>
                      <td className="text-right text-muted">{formatTimeAgo(burn.burnedAt)}</td>
                      <td className="text-right">
                        <a href={solscanTxUrl(burn.txSignature)} target="_blank" rel="noreferrer" className="text-xs">
                          {burn.txSignature.slice(0, 8)}...
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          locks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No locks yet</div>
              <div className="empty-state-text">Profit locks will appear here</div>
            </div>
          ) : (
            <div className="table-wrapper" style={{ maxHeight: 500 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Amount (SOL)</th>
                    <th>Status</th>
                    <th className="text-right">Time</th>
                    <th className="text-right">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {locks.map((lock) => {
                    return (
                      <tr key={lock.id}>
                        <td className="mono">{formatSol(BigInt(lock.solAmount || '0'), 4)}</td>
                        <td>
                          {lock.isUnlocked ? (
                            <span className="badge badge-bonded">Unlocked</span>
                          ) : (
                            <span className="text-muted text-xs">
                              {lock.timeRemainingMs > 0 ? `Unlocks in ${formatCountdown(lock.timeRemainingMs)}` : 'Ready to claim'}
                            </span>
                          )}
                        </td>
                        <td className="text-right text-muted">{formatTimeAgo(lock.lockedAt)}</td>
                        <td className="text-right">
                          <a href={solscanTxUrl(lock.buyTx)} target="_blank" rel="noreferrer" className="text-xs">
                            {lock.buyTx.slice(0, 8)}...
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
};
