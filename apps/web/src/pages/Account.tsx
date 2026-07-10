import { type FC, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNavigate, Link } from 'react-router-dom';
import * as api from '../lib/api';
import { HoldingsPanel } from '../components/HoldingsPanel';
import { formatSol, formatAddress, formatCountdown, formatTimeAgo, solscanTxUrl } from '../lib/format';

// Normalize VITE_API_URL: strip trailing /api if present, then add /api
const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
  : '/api';

type LockItem = api.ProfitLockEntry;

export const Account: FC = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();

  // Wallet state
  const [balance, setBalance] = useState<api.WalletBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Withdraw state
  const [destAddress, setDestAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawResult, setWithdrawResult] = useState<{ success: boolean; message: string; txSig?: string } | null>(null);

  // Locks state
  const [locks, setLocks] = useState<LockItem[]>([]);
  const [locksLoading, setLocksLoading] = useState(true);
  const [claiming, setClaiming] = useState<number | null>(null);

  // Copy state
  const [copied, setCopied] = useState(false);

  // ── Fetch wallet balance ──
  const fetchBalance = useCallback(async () => {
    try {
      const data = await api.getWalletBalance();
      setBalance(data);
    } catch {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  // ── Fetch locks ──
  const fetchLocks = useCallback(async () => {
    try {
      const token = api.getAuthToken();
      if (!token) { setLocksLoading(false); return; }

      const response = await api.getRecentLocks();
      setLocks(response.locks);
    } catch {
      setLocks([]);
    } finally {
      setLocksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchBalance();
    fetchLocks();
    const interval = setInterval(fetchBalance, 15_000);
    const locksInterval = setInterval(fetchLocks, 30_000);
    return () => { clearInterval(interval); clearInterval(locksInterval); };
  }, [isAuthenticated, fetchBalance, fetchLocks]);

  // ── Handlers ──
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleWithdraw = useCallback(async () => {
    if (!destAddress || !withdrawAmount || withdrawing) return;
    setWithdrawing(true);
    setWithdrawResult(null);
    try {
      // micro-ETH precision then scale to wei — avoids float drift past 2^53
      const amountLamports = String(BigInt(Math.round(parseFloat(withdrawAmount) * 1e6)) * 1_000_000_000_000n);
      const result = await api.withdrawWallet(destAddress, amountLamports);
      setWithdrawResult({ success: true, message: 'Withdrawal successful!', txSig: result.txSignature });
      setDestAddress('');
      setWithdrawAmount('');
      fetchBalance();
    } catch (err: any) {
      let msg = 'Withdrawal failed. Please try again.';
      if (err?.body) {
        const b = err.body as any;
        if (b.details?.length) msg = b.details[0];
        else if (b.error) msg = b.error;
      } else if (err?.message) {
        msg = err.message;
      }
      setWithdrawResult({ success: false, message: msg });
    } finally {
      setWithdrawing(false);
    }
  }, [destAddress, withdrawAmount, withdrawing, fetchBalance]);

  const handleClaim = useCallback(async (lockId: number) => {
    setClaiming(lockId);
    try {
      const token = api.getAuthToken();
      const res = await fetch(`${API_BASE}/locks/${lockId}/claim`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        const msg = json?.details?.[0] || json?.error || 'Failed to claim lock. It may not be ready yet.';
        alert(msg);
        return;
      }
      await fetchLocks();
    } catch (err) {
      alert('Failed to claim lock. Please try again later.');
    } finally {
      setClaiming(null);
    }
  }, [fetchLocks]);

  const handleSignOut = useCallback(() => {
    logout();
    navigate('/auth');
  }, [logout, navigate]);

  // ── Auth gate ──
  if (!isAuthenticated) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <h2>Sign in to view your account</h2>
        <p style={{ fontSize: 13, color: '#66786a' }}>Manage your wallet, locks, and profile</p>
        <button className="btn btn-primary" onClick={() => navigate('/auth')}>Sign In</button>
      </div>
    );
  }

  // ── Styles ──
  const cardStyle = {
    background: '#0b0d06',
    border: '1px solid #232b12',
    borderRadius: 0,
    padding: '18px 20px',
  };

  const sectionLabel = {
    fontSize: 10,
    fontWeight: 600 as const,
    color: '#67704f',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 10,
  };

  const statLabel = {
    fontSize: 11,
    color: '#67704f',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  };

  const statValue = {
    fontSize: 20,
    fontWeight: 700 as const,
    color: '#f0f4e4',
    fontFamily: "'JetBrains Mono', monospace",
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    background: '#12110c',
    border: '1px solid #232b12',
    borderRadius: 0,
    color: '#f0f4e4',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    outline: 'none',
  };

  const activeLocks = locks.filter((l) => !l.isUnlocked);
  const claimable = locks.filter((l) => l.isUnlocked || l.isExpired);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 0 }}>Account</h2>

      {/* ═══ A) Wallet Section ═══ */}
      <div style={cardStyle}>
        <div style={sectionLabel}>Wallet</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={statLabel}>Address</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#b3bd97', fontFamily: "'JetBrains Mono', monospace" }}>
                {balance?.address ? formatAddress(balance.address, 6) : user?.walletAddress ? formatAddress(user.walletAddress, 6) : '—'}
              </span>
              <button
                onClick={() => handleCopy(balance?.address || user?.walletAddress || '')}
                style={{
                  background: 'none', border: '1px solid #232b12', borderRadius: 0,
                  padding: '2px 8px', fontSize: 11, color: copied ? '#c8ff00' : '#66786a',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={statLabel}>ETH Balance</div>
            <div style={{ ...statValue, color: 'var(--primary)' }}>
              {balanceLoading ? (
                <span className="skeleton" style={{ display: 'inline-block', width: 80, height: 24, borderRadius: 0 }} />
              ) : (
                <>{balance?.balanceSol || '0.0000'} ETH</>
              )}
            </div>
          </div>
        </div>

        {/* Deposit */}
        <div style={{ borderTop: '1px solid #12110c', paddingTop: 14, marginBottom: 16 }}>
          <div style={sectionLabel}>Deposit</div>
          <p style={{ fontSize: 12, color: '#66786a', marginBottom: 8 }}>
            Send ETH on Robinhood Chain to this address to deposit
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{
              flex: 1, padding: '10px 12px', background: '#080808', border: '1px solid #232b12',
              borderRadius: 0, fontSize: 12, color: 'var(--primary)', fontFamily: "'JetBrains Mono', monospace",
              wordBreak: 'break-all',
            }}>
              {balance?.address || user?.walletAddress || '...'}
            </code>
            <button
              className="btn btn-outline"
              onClick={() => handleCopy(balance?.address || user?.walletAddress || '')}
              style={{ flexShrink: 0, fontSize: 11 }}
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Withdraw */}
        <div style={{ borderTop: '1px solid #12110c', paddingTop: 14 }}>
          <div style={sectionLabel}>Withdraw</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              style={inputStyle}
              placeholder="Destination address"
              value={destAddress}
              onChange={(e) => setDestAddress(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                type="number"
                placeholder="Amount (ETH)"
                step="0.01"
                min="0"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={handleWithdraw}
                disabled={withdrawing || !destAddress || !withdrawAmount}
                style={{ flexShrink: 0 }}
              >
                {withdrawing ? 'Sending...' : 'Withdraw'}
              </button>
            </div>
          </div>

          {withdrawResult && (
            <div style={{
              marginTop: 10, padding: '10px 14px', borderRadius: 0, fontSize: 12,
              background: withdrawResult.success ? 'rgba(200, 255, 0, 0.05)' : 'rgba(255, 77, 77, 0.05)',
              border: `1px solid ${withdrawResult.success ? 'rgba(200, 255, 0, 0.15)' : 'rgba(255, 77, 77, 0.15)'}`,
              color: withdrawResult.success ? '#c8ff00' : '#ff4d4d',
            }}>
              {withdrawResult.message}
              {withdrawResult.txSig && (
                <> · <a href={solscanTxUrl(withdrawResult.txSig)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>View on Blockscout →</a></>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Holdings (merged from the old /portfolio page) ═══ */}
      <div style={cardStyle}>
        <div style={sectionLabel}>Holdings</div>
        <HoldingsPanel />
      </div>

      {/* ═══ B) Locked $SCALE Section ═══ */}
      <div style={cardStyle}>
        <div style={sectionLabel}>Locked $SCALE</div>

        {locksLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
            <div className="spinner" />
          </div>
        ) : locks.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: '#4a5236', fontSize: 13 }}>
            No locks yet. Make profitable trades to earn $SCALE!
          </div>
        ) : (
          <>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={statLabel}>Active Locks</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f4e4', fontFamily: "'JetBrains Mono', monospace" }}>
                  {activeLocks.length}
                </div>
              </div>
              <div>
                <div style={statLabel}>Claimable</div>
                <div style={{
                  fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                  color: claimable.length > 0 ? '#c8ff00' : '#f0f4e4',
                }}>
                  {claimable.length}
                </div>
              </div>
              <div>
                <div style={statLabel}>Total Locks</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f4e4', fontFamily: "'JetBrains Mono', monospace" }}>
                  {locks.length}
                </div>
              </div>
            </div>

            {/* Claimable locks */}
            {claimable.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#c8ff00', marginBottom: 8 }}>
                  Ready to Claim
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {claimable.map((lock) => (
                    <div key={lock.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', background: '#090b05', border: '1px solid rgba(52, 211, 153, 0.15)',
                      borderRadius: 0,
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4e4', fontFamily: "'JetBrains Mono', monospace" }}>
                          {formatSol(BigInt(lock.tokenAmount))} $SCALE
                        </div>
                        <div style={{ fontSize: 11, color: '#67704f' }}>
                          From {lock.position?.tokenSymbol ?? 'token'} trade · Locked {formatTimeAgo(lock.lockedAt)}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleClaim(lock.id)}
                        disabled={claiming === lock.id}
                        style={{ fontSize: 12, padding: '6px 14px' }}
                      >
                        {claiming === lock.id ? 'Claiming...' : 'Claim'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active locks */}
            {activeLocks.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#a3ad8d', marginBottom: 8 }}>
                  Active Locks
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeLocks.map((lock) => (
                    <div key={lock.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', background: '#090b05', border: '1px solid #12110c',
                      borderRadius: 0,
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4e4', fontFamily: "'JetBrains Mono', monospace" }}>
                          {formatSol(BigInt(lock.tokenAmount))} $SCALE
                        </div>
                        <div style={{ fontSize: 11, color: '#67704f' }}>
                          From {lock.position?.tokenSymbol ?? 'token'} trade · Locked {formatTimeAgo(lock.lockedAt)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', fontFamily: "'JetBrains Mono', monospace" }}>
                          {formatCountdown(lock.timeRemainingMs)}
                        </div>
                        <div style={{ fontSize: 10, color: '#67704f' }}>until unlock</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/locks" style={{ fontSize: 11, color: '#66786a', textDecoration: 'none' }}>
            View all locks →
          </Link>
        </div>
      </div>

      {/* ═══ C) Account Info ═══ */}
      <div style={cardStyle}>
        <div style={sectionLabel}>Account</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={statLabel}>Email</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#b3bd97' }}>
              {user?.email || '—'}
            </div>
          </div>
          <button
            className="btn btn-outline"
            onClick={handleSignOut}
            style={{ color: '#ff4d4d', borderColor: 'rgba(255, 77, 77, 0.2)', fontSize: 12 }}
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};
