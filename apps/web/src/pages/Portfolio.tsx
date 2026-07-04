import { type FC, useState, useEffect } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { formatUsd } from '../lib/format';

export const Portfolio: FC = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<api.PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) return;
    api.getPortfolio()
      .then(setPortfolio)
      .catch(() => setPortfolio(null))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
        <h2>Sign in to view your portfolio</h2>
        <button className="btn btn-primary" onClick={() => navigate('/auth')}>Sign In</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
        </div>
        <div className="skeleton" style={{ height: 200, borderRadius: 14 }} />
      </div>
    );
  }

  const cardStyle = {
    background: '#0c0a16',
    border: '1px solid #211a38',
    borderRadius: 14,
    padding: '18px 20px',
  };

  const statLabel = { fontSize: 11, color: '#5e5680', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' };
  const statValue = { fontSize: 20, fontWeight: 700 as const, color: '#f4f2ff', fontFamily: "'JetBrains Mono', monospace" };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ marginBottom: 4 }}>Portfolio</h2>

      {/* Wallet Card */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={statLabel}>Wallet Address</div>
            <div style={{ fontSize: 13, color: '#c9c3e0', fontFamily: "'JetBrains Mono', monospace" }}>
              {portfolio?.wallet.address
                ? `${portfolio.wallet.address.slice(0, 6)}...${portfolio.wallet.address.slice(-4)}`
                : '—'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={statLabel}>SOL Balance</div>
            <div style={{ ...statValue, color: '#8b5cff' }}>
              {portfolio?.wallet.balanceSol || '0.0000'} SOL
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div style={cardStyle}>
          <div style={statLabel}>Open Positions</div>
          <div style={statValue}>{portfolio?.positions.open || 0}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabel}>Capital Locked</div>
          <div style={statValue}>
            {((Number(portfolio?.positions.totalCapitalLocked || 0)) / 1e9).toFixed(2)} SOL
          </div>
        </div>
        <div style={cardStyle}>
          <div style={statLabel}>Total Trades</div>
          <div style={statValue}>{portfolio?.history.totalTrades || 0}</div>
        </div>
        <div style={cardStyle}>
          <div style={statLabel}>Active Locks</div>
          <div style={statValue}>{portfolio?.locks.activeLocks || 0}</div>
        </div>
      </div>

      {/* Open Positions */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#c9c3e0' }}>Open Positions</h3>
        {!portfolio?.positions.items.length ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#453a6b', fontSize: 13 }}>
            No open positions.{' '}
            <span
              style={{ color: '#8b5cff', cursor: 'pointer' }}
              onClick={() => navigate('/explore')}
            >
              Start trading →
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {portfolio.positions.items.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', background: '#07060d', border: '1px solid #0f0c1a',
                  borderRadius: 10, cursor: 'pointer',
                }}
                onClick={() => navigate(`/trade?token=${p.token.address}`)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #8b5cff20, #8b5cff05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: '#8b5cff',
                  }}>
                    {p.token.symbol?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f2ff' }}>{p.token.symbol || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#5e5680' }}>{p.leverage}x • {p.tier}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f4f2ff', fontFamily: "'JetBrains Mono', monospace" }}>
                    {(Number(p.userCapital) / 1e9).toFixed(3)} SOL
                  </div>
                  <div style={{ fontSize: 11, color: '#5e5680' }}>
                    {new Date(p.openedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* P&L Summary */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#c9c3e0' }}>Performance</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={statLabel}>Total P&L</div>
            <div style={{
              ...statValue,
              fontSize: 16,
              color: Number(portfolio?.history.totalPnlLamports || 0) >= 0 ? '#00ffa3' : '#ff3d71',
            }}>
              {((Number(portfolio?.history.totalPnlLamports || 0)) / 1e9).toFixed(4)} SOL
            </div>
          </div>
          <div>
            <div style={statLabel}>Locked Profits</div>
            <div style={{ ...statValue, fontSize: 16 }}>
              {((Number(portfolio?.locks.totalLockedLamports || 0)) / 1e9).toFixed(4)} SOL
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
