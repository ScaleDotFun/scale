import { type FC, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';

/**
 * Holdings — open positions, capital and performance. Lives inside
 * the Account page (the old /portfolio route redirects there).
 * Assumes the caller has already verified authentication.
 */
export const HoldingsPanel: FC = () => {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState<api.PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getPortfolio()
      .then(setPortfolio)
      .catch(() => setPortfolio(null))
      .finally(() => setLoading(false));
  }, []);

  const cardStyle = {
    background: '#0a0e0b',
    border: '1px solid #1c261f',
    borderRadius: 0,
    padding: '18px 20px',
  };

  const statLabel = { fontSize: 11, color: '#5c6b60', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' };
  const statValue = { fontSize: 20, fontWeight: 700 as const, color: '#eef3ef', fontFamily: "'JetBrains Mono', monospace" };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 90 }} />)}
        </div>
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
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
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#a6bcae' }}>Open Positions</h3>
        {!portfolio?.positions.items.length ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#3d4d40', fontSize: 13 }}>
            No open positions.{' '}
            <span
              style={{ color: 'var(--primary)', cursor: 'pointer' }}
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
                  padding: '12px 16px', background: '#080a08', border: '1px solid #141c16',
                  borderRadius: 0, cursor: 'pointer',
                }}
                onClick={() => navigate(`/trade?token=${p.token.address}`)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'rgba(var(--primary-rgb),0.10)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: 'var(--primary)',
                  }}>
                    {p.token.symbol?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#eef3ef' }}>{p.token.symbol || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#5c6b60' }}>{p.leverage}x • {p.tier}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#eef3ef', fontFamily: "'JetBrains Mono', monospace" }}>
                    {(Number(p.userCapital) / 1e9).toFixed(3)} SOL
                  </div>
                  <div style={{ fontSize: 11, color: '#5c6b60' }}>
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
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#a6bcae' }}>Performance</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={statLabel}>Total P&L</div>
            <div style={{
              ...statValue,
              fontSize: 16,
              color: Number(portfolio?.history.totalPnlLamports || 0) >= 0 ? '#00c805' : '#ff4d4d',
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
