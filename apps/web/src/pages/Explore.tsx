import { type FC, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTokens } from '../hooks/useTokens';
import { formatUsd, formatSol } from '../lib/format';

export const Explore: FC = () => {
  const { trending, trendingLoading, selectToken } = useTokens();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');

  const filtered = trending.filter((t) => {
    const matchesSearch =
      !search ||
      t.symbol?.toLowerCase().includes(search.toLowerCase()) ||
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.address.includes(search);
    const matchesTier = tierFilter === 'all' || t.tier === tierFilter;
    return matchesSearch && matchesTier;
  });

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Explore Tokens</h2>
          <p style={{ fontSize: '0.86rem' }}>
            Tokens auto-listed when creators redirect pump.fun rewards to Front Protocol
          </p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="search-wrapper" style={{ flex: 1, maxWidth: 400 }}>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            placeholder="Search by name, symbol, or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'bonded', 'rising', 'degen'].map((tier) => (
            <button
              key={tier}
              className={`btn btn-outline btn-sm ${tierFilter === tier ? 'active' : ''}`}
              onClick={() => setTierFilter(tier)}
            >
              {tier === 'all' ? 'All' : tier.charAt(0).toUpperCase() + tier.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Token Grid */}
      {trendingLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="skeleton" style={{ height: 140, borderRadius: 14 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No tokens found</div>
          <div className="empty-state-text">
            {search ? 'Try a different search' : 'Tokens appear here automatically when devs redirect their pump.fun creator rewards to Front Protocol'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {filtered.map((token) => (
            <div key={token.address} className="token-card" onClick={() => { selectToken(token); navigate(`/trade?token=${token.address}`); }}>
              <div className="token-card-header">
                <div className="token-card-icon" />
                <div>
                  <div className="token-card-name">{token.symbol}</div>
                  <div className="token-card-symbol">{token.name}</div>
                </div>
                <span className={`badge badge-${token.tier}`} style={{ marginLeft: 'auto' }}>{token.tier}</span>
              </div>
              <div className="token-card-stats">
                <div>
                  <div className="token-card-stat-label">Market Cap</div>
                  <div className="token-card-stat-value">{formatUsd(token.marketCapUsd || 0)}</div>
                </div>
                <div>
                  <div className="token-card-stat-label">24h Volume</div>
                  <div className="token-card-stat-value">{formatUsd(token.volume24hUsd || 0)}</div>
                </div>
                <div>
                  <div className="token-card-stat-label">Liquidity</div>
                  <div className="token-card-stat-value">{formatUsd(token.liquidityUsd || 0)}</div>
                </div>
                <div>
                  <div className="token-card-stat-label">Max Leverage</div>
                  <div className="token-card-stat-value">
                    {token.maxLeverage ? `${token.maxLeverage}x` : token.tier === 'bonded' ? '10x' : token.tier === 'rising' ? '5x' : '3x'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
