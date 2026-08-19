import { type FC, useState, useEffect, useCallback } from 'react';
import { formatSol, formatTimeAgo, formatCountdown } from '../lib/format';
import { getRecentLocks, getAuthToken, type ProfitLockEntry } from '../lib/api';

// Use ProfitLockEntry from lib/api.ts as LockItem
type LockItem = ProfitLockEntry;

export const Locks: FC = () => {
  const [locks, setLocks] = useState<LockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);

  const fetchLocks = useCallback(async () => {
    try {
      setError(null);
      const token = getAuthToken();
      if (!token) {
        setLocks([]);
        setLoading(false);
        return;
      }

      const response = await getRecentLocks();
      setLocks(response.locks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load locks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocks();
    // Refresh countdown timers every 30s
    const interval = setInterval(fetchLocks, 30_000);
    return () => clearInterval(interval);
  }, [fetchLocks]);

  const activeLocks = locks.filter((l) => !l.isUnlocked);
  const claimable = locks.filter((l) => l.isUnlocked || l.isExpired);

  const totalLocked = activeLocks.reduce(
    (sum, l) => sum + BigInt(l.tokenAmount),
    0n,
  );
  const totalClaimable = claimable.reduce(
    (sum, l) => sum + BigInt(l.tokenAmount),
    0n,
  );

  const handleClaim = async (lockId: number) => {
    setClaiming(lockId);
    try {
      const token = getAuthToken();
      const BASE_URL = import.meta.env.VITE_API_URL
        ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
        : '/api';
      const res = await fetch(`${BASE_URL}/locks/${lockId}/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error('Claim failed');
      }

      // Refresh locks list
      await fetchLocks();
    } catch (err) {
      console.error('Claim error:', err);
    } finally {
      setClaiming(null);
    }
  };

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
        <h2 style={{ marginBottom: 4 }}>$SCALE Locks</h2>
        <p style={{ fontSize: '0.86rem' }}>
          30% of your trading profits auto-buy $SCALE and lock for 7 days. Claim here once unlocked.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" style={{ padding: '12px 16px', borderRadius: 0 }}>
          {error}
        </div>
      )}

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div className="stat-card">
          <div className="stat-card-label">Locked</div>
          <div className="stat-card-value">{formatSol(totalLocked)} <span style={{ fontSize: '0.79rem', color: 'var(--primary)' }}>$SCALE</span></div>
          <div className="stat-card-sub">{activeLocks.length} active lock{activeLocks.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card" style={{ borderColor: claimable.length > 0 ? 'rgba(52, 211, 153, 0.2)' : undefined }}>
          <div className="stat-card-label">Claimable</div>
          <div className="stat-card-value" style={{ color: claimable.length > 0 ? 'var(--green)' : undefined }}>
            {formatSol(totalClaimable)} <span style={{ fontSize: '0.79rem', color: 'var(--primary)' }}>$SCALE</span>
          </div>
          <div className="stat-card-sub">{claimable.length} ready to claim</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Total Locks</div>
          <div className="stat-card-value">{locks.length}</div>
          <div className="stat-card-sub">All time</div>
        </div>
      </div>

      {/* Claimable Locks */}
      {claimable.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 10, color: 'var(--green)' }}>
            Ready to Claim
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {claimable.map((lock) => (
              <div key={lock.id} className="lock-card lock-card-claimable">
                <div className="lock-card-info">
                  <div className="lock-card-amount">
                    {formatSol(BigInt(lock.tokenAmount))} $SCALE
                  </div>
                  <div className="lock-card-detail">
                    From {lock.position?.tokenSymbol ?? 'token'} trade #{lock.position?.id ?? '?'} · Locked {formatTimeAgo(lock.lockedAt)}
                  </div>
                </div>
                <button
                  className="btn btn-success"
                  onClick={() => handleClaim(lock.id)}
                  disabled={claiming === lock.id}
                >
                  {claiming === lock.id ? 'Claiming...' : 'Claim $SCALE'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Locks */}
      <div>
        <h3 style={{ marginBottom: 10 }}>
          Active Locks
        </h3>
        {activeLocks.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div className="empty-state-text">No active locks. Make profitable trades to earn $SCALE!</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeLocks.map((lock) => {
              const timeLeft = lock.timeRemainingMs;
              return (
                <div key={lock.id} className="lock-card">
                  <div className="lock-card-info">
                    <div className="lock-card-amount">
                      {formatSol(BigInt(lock.tokenAmount))} $SCALE
                    </div>
                    <div className="lock-card-detail">
                      From {lock.position?.tokenSymbol ?? 'token'} trade #{lock.position?.id ?? '?'} · Locked {formatTimeAgo(lock.lockedAt)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="lock-card-timer">{formatCountdown(timeLeft)}</div>
                    <div className="lock-card-detail">until unlock</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
