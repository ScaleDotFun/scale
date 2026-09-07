import { type FC, useState } from 'react';
import { useBurns } from '../hooks/useBurns';
import { useStats } from '../hooks/useStats';
import { formatEth, formatTimeAgo, formatCountdown, formatNumber, explorerTxUrl, weiToEth } from '../lib/format';

export const Burns: FC = () => {
  const { burns, lockStats, totalBurned, totalLocked, loading } = useBurns();
  const { totalBurnedEth, totalLockedEth, totalCreatorPayoutsEth } = useStats();
  const [activeTab, setActiveTab] = useState<'burns' | 'locks'>('burns');

  const burnRate = burns.length > 1
    ? weiToEth(totalBurned / burns.length)
    : 0;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats Row */}
      <div className="page-grid page-grid-4">
        <div className="card">
          <div className="stat">
            <span className="stat-label">Total Burned</span>
            <span className="stat-value mono text-yellow">{formatNumber(totalBurnedEth)} ETH</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat-label">Total Locked</span>
            <span className="stat-value mono">{formatNumber(totalLockedEth)} ETH</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat-label">Avg Burn / Trade</span>
            <span className="stat-value mono text-green">{burnRate.toFixed(4)} ETH</span>
          </div>
        </div>
        <div className="card">
          <div className="stat">
            <span className="stat-label">Creator Payouts</span>
            <span className="stat-value mono text-blue">{formatNumber(totalCreatorPayoutsEth)} ETH</span>
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
            Burns
          </button>
          <button
            className={`tab ${activeTab === 'locks' ? 'active' : ''}`}
            onClick={() => setActiveTab('locks')}
          >
            Locks
          </button>
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="spinner" />
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
                    <th>Amount (ETH)</th>
                    <th>$LOADED Burned</th>
                    <th className="text-right">Time</th>
                    <th className="text-right">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {burns.map((burn) => (
                    <tr key={burn.id}>
                      <td className="font-semibold text-primary">{burn.position?.tokenSymbol ?? '--'}</td>
                      <td className="mono text-yellow">{formatEth(BigInt(burn.ethAmount || '0'), 4)}</td>
                      <td className="mono text-muted">{formatNumber(Number(burn.tokenAmount || 0))}</td>
                      <td className="text-right text-muted">{formatTimeAgo(burn.burnedAt)}</td>
                      <td className="text-right">
                        <a href={explorerTxUrl(burn.txHash)} target="_blank" rel="noreferrer" className="text-xs">
                          {burn.txHash.slice(0, 8)}...
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          !lockStats || lockStats.activeLockCount === 0 ? (
            <div className="empty-state">
              <div className="empty-state-title">No active locks</div>
              <div className="empty-state-text">Profit locks will appear here as traders earn profits</div>
            </div>
          ) : (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="page-grid page-grid-3">
                <div className="stat">
                  <span className="stat-label">Active Locks</span>
                  <span className="stat-value mono">{lockStats.activeLockCount}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Locked ETH</span>
                  <span className="stat-value mono">{formatEth(BigInt(lockStats.totalLocked.ethAmount || '0'), 4)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Unlocked ETH</span>
                  <span className="stat-value mono text-green">{formatEth(BigInt(lockStats.totalUnlocked.ethAmount || '0'), 4)}</span>
                </div>
              </div>
              {lockStats.upcoming7d.count > 0 && (
                <div style={{ fontSize: '0.86rem', color: '#a3ad8d' }}>
                  {lockStats.upcoming7d.count} lock{lockStats.upcoming7d.count > 1 ? 's' : ''} unlocking in the next 7 days ({formatEth(BigInt(lockStats.upcoming7d.ethAmount || '0'), 4)} ETH)
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
};
