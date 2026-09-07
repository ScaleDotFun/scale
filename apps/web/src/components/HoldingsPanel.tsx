import { type FC, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { weiToEth } from '../lib/format';

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
    background: '#0b0d06',
    border: '1px solid #232b12',
    borderRadius: 0,
    padding: '18px 20px',
  };

  const statLabel = { fontSize: 11, color: '#67704f', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' };
  const statValue = { fontSize: 20, fontWeight: 700 as const, color: '#f0f4e4', fontFamily: "'JetBrains Mono', monospace" };

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
            {weiToEth(portfolio?.positions.totalCapitalLocked).toFixed(4)} ETH
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
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#b3bd97' }}>Open Positions</h3>
        {!portfolio?.positions.items.length ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#4a5236', fontSize: 13 }}>
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
                  padding: '12px 16px', background: '#090b05', border: '1px solid #161c0a',
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4e4' }}>{p.token.symbol || 'Unknown'}</div>
                    <div style={{ fontSize: 11, color: '#67704f' }}>{p.leverage}x • {p.tier}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f4e4', fontFamily: "'JetBrains Mono', monospace" }}>
                    {weiToEth(p.userCapital).toFixed(4)} ETH
                  </div>
                  <div style={{ fontSize: 11, color: '#67704f' }}>
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
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: '#b3bd97' }}>Performance</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={statLabel}>Total P&L</div>
            <div style={{
              ...statValue,
              fontSize: 16,
              color: Number(portfolio?.history.totalPnlWei || 0) >= 0 ? '#c8ff00' : '#ff4d4d',
            }}>
              {weiToEth(portfolio?.history.totalPnlWei).toFixed(4)} ETH
            </div>
          </div>
          <div>
            <div style={statLabel}>Locked Profits</div>
            <div style={{ ...statValue, fontSize: 16 }}>
              {weiToEth(portfolio?.locks.totalLockedWei).toFixed(4)} ETH
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
