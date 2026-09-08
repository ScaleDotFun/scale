import { type FC, useState, useEffect, useCallback } from 'react';
import { formatEth, formatTimeAgo, formatCountdown, explorerTxUrl } from '../lib/format';
import { getRecentLocks, getAuthToken, type ProfitLockEntry } from '../lib/api';

// Use ProfitLockEntry from lib/api.ts as LockItem
type LockItem = ProfitLockEntry;

export const Locks: FC = () => {
  const [locks, setLocks] = useState<LockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Classification follows what the backend flags actually mean.
  //   isUnlocked  — the $LOADED has ALREADY been transferred to the user's
  //                 wallet by the release sweep. Spent history, not a balance.
  //   isExpired   — the 7 days are up. Computed independently of isUnlocked,
  //                 so a matured-but-unreleased lock satisfies both.
  // Treating isUnlocked as "claimable" listed delivered tokens as a pending
  // balance forever, and the overlap double-counted matured locks in two
  // stat cards at once.
  //   tokenAmount 0 — booked but not yet bought (deferred until $LOADED is live).
  const pendingBuy = locks.filter((l) => !l.isUnlocked && BigInt(l.tokenAmount) === 0n);
  const activeLocks = locks.filter(
    (l) => !l.isUnlocked && !l.isExpired && BigInt(l.tokenAmount) > 0n,
  );
  const releasing = locks.filter(
    (l) => !l.isUnlocked && l.isExpired && BigInt(l.tokenAmount) > 0n,
  );
  const delivered = locks.filter((l) => l.isUnlocked);

  const sumTokens = (rows: typeof locks) => rows.reduce((sum, l) => sum + BigInt(l.tokenAmount), 0n);
  const totalLocked = sumTokens(activeLocks);
  const totalReleasing = sumTokens(releasing);
  const totalDelivered = sumTokens(delivered);
  const totalPendingEth = pendingBuy.reduce((sum, l) => sum + BigInt(l.ethAmount), 0n);

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
        <h2 style={{ marginBottom: 4 }}>$LOADED Locks</h2>
        <p style={{ fontSize: '0.86rem' }}>
          30% of your trading profits auto-buy $LOADED and lock for 7 days. Release is automatic —
          the tokens are sent to your wallet when the lock matures. Nothing to claim.
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
          <div className="stat-card-value">{formatEth(totalLocked)} <span style={{ fontSize: '0.79rem', color: 'var(--primary)' }}>$LOADED</span></div>
          <div className="stat-card-sub">{activeLocks.length} active lock{activeLocks.length !== 1 ? 's' : ''}</div>
        </div>
        <div className="stat-card" style={{ borderColor: releasing.length > 0 ? 'rgba(52, 211, 153, 0.2)' : undefined }}>
          <div className="stat-card-label">Releasing</div>
          <div className="stat-card-value" style={{ color: releasing.length > 0 ? 'var(--green)' : undefined }}>
            {formatEth(totalReleasing)} <span style={{ fontSize: '0.79rem', color: 'var(--primary)' }}>$LOADED</span>
          </div>
          <div className="stat-card-sub">{releasing.length} matured, sending automatically</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Delivered</div>
          <div className="stat-card-value">{formatEth(totalDelivered)} <span style={{ fontSize: '0.79rem', color: 'var(--primary)' }}>$LOADED</span></div>
          <div className="stat-card-sub">{delivered.length} sent to your wallet</div>
        </div>
      </div>

      {/* Pending buy — booked as owed, not yet converted */}
      {pendingBuy.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 10 }}>Awaiting $LOADED launch</h3>
          <div className="lock-card">
            <div className="lock-card-info">
              <div className="lock-card-amount">{formatEth(totalPendingEth)} ETH</div>
              <div className="lock-card-detail">
                Your locked profit share from {pendingBuy.length} trade{pendingBuy.length !== 1 ? 's' : ''} is
                held by the protocol and converts to $LOADED automatically once the token is live.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Matured, being sent */}
      {releasing.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 10, color: 'var(--green)' }}>Releasing now</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {releasing.map((lock) => (
              <div key={lock.id} className="lock-card lock-card-claimable">
                <div className="lock-card-info">
                  <div className="lock-card-amount">
                    {formatEth(BigInt(lock.tokenAmount))} $LOADED
                  </div>
                  <div className="lock-card-detail">
                    From {lock.position?.tokenSymbol ?? 'token'} trade #{lock.position?.id ?? '?'} · Locked {formatTimeAgo(lock.lockedAt)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', color: 'var(--green)', fontSize: '0.8rem' }}>
                  Sending to your wallet
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delivered */}
      {delivered.length > 0 && (
        <div>
          <h3 style={{ marginBottom: 10 }}>Delivered</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {delivered.slice(0, 10).map((lock) => (
              <div key={lock.id} className="lock-card">
                <div className="lock-card-info">
                  <div className="lock-card-amount">
                    {formatEth(BigInt(lock.tokenAmount))} $LOADED
                  </div>
                  <div className="lock-card-detail">
                    From {lock.position?.tokenSymbol ?? 'token'} trade #{lock.position?.id ?? '?'} · Locked {formatTimeAgo(lock.lockedAt)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {lock.unlockTx ? (
                    <a href={explorerTxUrl(lock.unlockTx)} target="_blank" rel="noreferrer" className="link-dim">
                      In your wallet
                    </a>
                  ) : (
                    <span className="lock-card-detail">In your wallet</span>
                  )}
                </div>
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
            <div className="empty-state-text">No active locks. Make profitable trades to earn $LOADED!</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeLocks.map((lock) => {
              const timeLeft = lock.timeRemainingMs;
              return (
                <div key={lock.id} className="lock-card">
                  <div className="lock-card-info">
                    <div className="lock-card-amount">
                      {formatEth(BigInt(lock.tokenAmount))} $LOADED
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
