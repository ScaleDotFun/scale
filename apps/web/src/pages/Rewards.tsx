import { type FC, useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import * as api from '../lib/api';
import { formatNumber } from '../lib/format';

function fmtPoints(raw: string | undefined): string {
  if (!raw) return '0';
  return formatNumber(Number(raw));
}

export const Rewards: FC = () => {
  const { isAuthenticated } = useAuth();
  const [me, setMe] = useState<api.PointsMe | null>(null);
  const [board, setBoard] = useState<api.LeaderboardRow[]>([]);
  const [totalWallets, setTotalWallets] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // The leaderboard call is rate-limited and can 429 or 5xx. With no catch,
    // its rejection skipped every setter and the page rendered its EMPTY
    // states as facts — "No points yet, be the first" and the signed-out
    // referral CTA — to a signed-in user who has points and a rank.
    try {
      const [lb, mine] = await Promise.all([
        api.getLeaderboard(50),
        isAuthenticated ? api.getPointsMe().catch(() => null) : Promise.resolve(null),
      ]);
      setBoard(lb.leaderboard);
      setTotalWallets(lb.totalWallets);
      setMe(mine);
      setLoadError(null);
    } catch {
      setLoadError('Could not load the leaderboard right now — retrying shortly.');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { load(); }, [load]);

  const refLink = me ? `${window.location.origin}/?ref=${me.referralCode}` : '';
  const copyLink = () => {
    if (!refLink) return;
    navigator.clipboard.writeText(refLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (loading) {
    return (
      <div className="fade-in" style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 860 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>Points &amp; Referrals</h2>
        <p className="text-muted" style={{ fontSize: '0.9rem', margin: 0 }}>
          Every leveraged trade earns points — <b>{me?.pointsPerEth ?? '100'}</b> per 1 ETH of
          position size. Refer traders and earn <b>{me?.referralBonusPct ?? 20}%</b> of everything
          they make, forever. Points are pre-token; the leaderboard is public.
        </p>
      </div>

      {loadError && (
        <div className="alert alert-error" style={{ padding: '12px 16px', borderRadius: 0 }}>
          {loadError}
        </div>
      )}

      {/* My points */}
      {isAuthenticated && me ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div className="stat-card">
              <div className="stat-card-label">Your Points</div>
              <div className="stat-card-value" style={{ color: 'var(--primary)' }}>{fmtPoints(me.totalPoints)}</div>
              <div className="stat-card-sub">{me.rank ? `Rank #${me.rank}` : 'Trade to get on the board'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">From Trading</div>
              <div className="stat-card-value">{fmtPoints(me.breakdown['trade_volume'])}</div>
              <div className="stat-card-sub">{me.pointsPerEth} pts / ETH of size</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">From Referrals</div>
              <div className="stat-card-value">{fmtPoints(me.breakdown['referral_bonus'])}</div>
              <div className="stat-card-sub">{me.referralCount} referred · {me.referralBonusPct}% override</div>
            </div>
          </div>

          {/* Referral link */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <div className="text-muted" style={{ fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              Your referral link
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{
                flex: 1, minWidth: 240, fontSize: '0.82rem', color: 'var(--primary)',
                background: 'var(--bg-1)', border: '1px solid var(--border)', padding: '10px 14px', wordBreak: 'break-all',
              }}>
                {refLink}
              </code>
              <button className="btn btn-primary" onClick={copyLink} style={{ flexShrink: 0 }}>
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
            <p className="text-muted" style={{ fontSize: '0.78rem', margin: '10px 0 0' }}>
              Anyone who signs up through this link is yours forever — you earn {me.referralBonusPct}% of
              every point they generate, on top of your own trading points.
            </p>
          </div>
        </>
      ) : (
        <div className="card" style={{ padding: '18px 22px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.92rem' }}>
            Sign in to get your referral link and start stacking points.
          </p>
          <Link to="/auth" className="btn btn-primary" style={{ display: 'inline-block' }}>
            Sign in
          </Link>
        </div>
      )}

      {/* Leaderboard */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Leaderboard</h3>
          <span className="text-muted" style={{ fontSize: '0.78rem' }}>{formatNumber(totalWallets)} wallets earning</span>
        </div>
        {board.length === 0 ? (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-2)' }}>
            {loadError
              ? 'Leaderboard unavailable right now.'
              : 'No points yet — be the first. Open a position and you top the board.'}
          </div>
        ) : (
          <table className="terminal-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Wallet</th>
                <th style={{ textAlign: 'right' }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row) => {
                const mine = me?.rank === row.rank && me?.totalPoints === row.points;
                return (
                  <tr key={row.wallet} style={mine ? { background: 'rgba(200,255,0,0.06)' } : undefined}>
                    <td className="mono" style={{ color: row.rank <= 3 ? 'var(--primary)' : 'var(--text-2)' }}>{row.rank}</td>
                    <td className="mono">{row.display}{mine ? ' · you' : ''}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--primary)' }}>{fmtPoints(row.points)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-muted" style={{ fontSize: '0.74rem', margin: 0 }}>
        Points reward real on-chain trading volume and referred volume only — never posting or social
        actions. Redemption details announced before the $LOADED token goes live.
      </p>
    </div>
  );
};
