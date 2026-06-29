import { type FC, useState } from 'react';
import * as api from '../lib/api';
import { formatSol, formatNumber, formatTimeAgo, solscanTxUrl, formatAddress } from '../lib/format';

export const Creator: FC = () => {
  const [walletAddress, setWalletAddress] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<api.CreatorDashboardTokenItem[]>([]);
  const [payouts, setPayouts] = useState<api.CreatorPayoutEntry[]>([]);

  const handleSearch = async () => {
    const addr = walletAddress.trim();
    if (!addr || addr.length < 32) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const [dashRes, payRes] = await Promise.allSettled([
        api.getCreatorDashboardByWallet(addr),
        api.getCreatorPayoutsByWallet(addr),
      ]);

      if (dashRes.status === 'fulfilled') {
        setTokens(dashRes.value.tokens ?? []);
      } else {
        setTokens([]);
      }

      if (payRes.status === 'fulfilled') {
        setPayouts(payRes.value ?? []);
      } else {
        setPayouts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load creator data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div>
        <h2 style={{ marginBottom: 4 }}>Creator Dashboard</h2>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-1)' }}>
          Look up any wallet to view creator earnings and listed tokens. No account required.
        </p>
      </div>

      {/* Search */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="search-wrapper" style={{ flex: 1 }}>
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="search-input"
              placeholder="Enter creator wallet address..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={loading || !walletAddress.trim()}
          >
            {loading ? 'Loading...' : 'Look Up'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: '12px 16px', borderColor: 'var(--red)', color: 'var(--red)', fontSize: '0.86rem' }}>
          {error}
        </div>
      )}

      {!searched && !loading && (
        <div className="card" style={{ padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="1.5" style={{ opacity: 0.5 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </div>
          <div style={{ fontSize: '0.93rem', fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
            Enter a wallet address
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-2)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            Look up any creator wallet to view their listed tokens, trading volume, fees generated, and unclaimed earnings.
            All data is on-chain and publicly verifiable.
          </div>
        </div>
      )}

      {searched && !loading && tokens.length === 0 && (
        <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: '0.93rem', fontWeight: 600, color: 'var(--text-1)', marginBottom: 6 }}>
            No listed tokens found
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-2)', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
            This wallet has no tokens listed on Front Protocol.
            To list a token, redirect its Pump.fun creator rewards to the protocol wallet.
          </div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: '48px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="spinner" />
          <span style={{ fontSize: '0.82rem', color: 'var(--text-2)' }}>Loading creator data...</span>
        </div>
      )}

      {tokens.length > 0 && (
        <>
          {/* Token Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {tokens.map((token) => (
              <div key={token.tokenAddress} className="card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 600, fontSize: 15 }}>{token.tokenSymbol}</span>
                    <span className={`badge badge-${token.tier}`}>{token.tier}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-2)' }}>{formatAddress(token.tokenAddress, 4)}</span>
                  </div>
                  {Number(token.unclaimedEarnings) > 0 && (
                    <span className="badge badge-bonded" style={{ fontSize: 12 }}>
                      {formatSol(BigInt(token.unclaimedEarnings), 3)} SOL unclaimed
                    </span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>Volume</div>
                    <div className="mono" style={{ fontSize: 13 }}>{formatNumber(Number(token.totalTradingVolume))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>Fees</div>
                    <div className="mono" style={{ fontSize: 13 }}>{formatNumber(Number(token.totalFeesGenerated))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>Earnings</div>
                    <div className="mono" style={{ fontSize: 13, color: 'var(--green)' }}>{formatNumber(Number(token.totalEarnings))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>Today</div>
                    <div className="mono" style={{ fontSize: 13, color: 'var(--green)' }}>+{formatNumber(Number(token.todayEarnings))}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Payout History */}
          {payouts.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>Payout History</h3>
              </div>
              <div className="table-wrapper">
                <table className="terminal-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Date</th>
                      <th style={{ textAlign: 'right' }}>TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payouts.map((payout) => (
                      <tr key={payout.id}>
                        <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{payout.token.symbol ?? formatAddress(payout.token.address, 4)}</td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--green)' }}>{formatSol(BigInt(payout.amount), 3)} SOL</td>
                        <td>
                          <span className={`badge ${payout.status === 'claimed' ? 'badge-bonded' : 'badge-rising'}`}>
                            {payout.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-2)' }}>{formatTimeAgo(payout.createdAt)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {payout.claimTx && (
                            <a href={solscanTxUrl(payout.claimTx)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontSize: 12 }}>
                              View
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
