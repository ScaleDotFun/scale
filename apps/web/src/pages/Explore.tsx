import { type FC, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../lib/api';
import { formatUsd, formatSol } from '../lib/format';

const SOLANA_ADDR_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

export const Explore: FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [listedTokens, setListedTokens] = useState<api.TokenInfo[]>([]);
  const [searchResults, setSearchResults] = useState<api.TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  // Load listed tokens on mount
  useEffect(() => {
    api.getListedTokens()
      .then((data) => setListedTokens(data))
      .catch(() => setListedTokens([]))
      .finally(() => setLoading(false));
  }, []);

  // Search behavior
  useEffect(() => {
    if (!search.trim() || search.length < 2) {
      setSearchResults([]);
      return;
    }

    // If input looks like a Solana address (32-44 chars, base58)
    const trimmed = search.trim();
    if (trimmed.length >= 32 && trimmed.length <= 44 && SOLANA_ADDR_REGEX.test(trimmed)) {
      // Navigate directly to trade page — listing check is done there
      navigate(`/trade?token=${trimmed}`);
      return;
    }

    // Filter listed tokens client-side only — don't show unlisted tokens
    setSearching(true);
    const timer = setTimeout(() => {
      const lower = trimmed.toLowerCase();
      const filtered = listedTokens.filter(t =>
        (t.symbol && t.symbol.toLowerCase().includes(lower)) ||
        (t.name && t.name.toLowerCase().includes(lower))
      );
      setSearchResults(filtered);
      setSearching(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, listedTokens, navigate]);

  const displayTokens = search.trim().length >= 2 ? searchResults : listedTokens;

  const handleTokenClick = (token: api.TokenInfo) => {
    navigate(`/trade?token=${token.address}`);
  };

  const formatChange = (pct: number | undefined | null) => {
    if (pct == null) return <span style={{ color: '#555' }}>--</span>;
    const color = pct >= 0 ? '#22c55e' : '#ef4444';
    const sign = pct >= 0 ? '+' : '';
    return <span style={{ color, fontWeight: 600 }}>{sign}{pct.toFixed(1)}%</span>;
  };

  const tierBadge = (tier: string) => {
    const tierMap: Record<string, { color: string; bg: string; label: string }> = {
      bonded: { color: '#00c853', bg: 'rgba(0, 200, 83, 0.08)', label: 'Bonded' },
      rising: { color: '#f0b90b', bg: 'rgba(240, 185, 11, 0.06)', label: 'Rising' },
      degen: { color: '#ff3b3b', bg: 'rgba(255, 59, 59, 0.08)', label: 'Degen' },
    };
    const t = tierMap[tier] || tierMap.degen;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center',
        padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
        color: t.color, background: t.bg,
      }}>
        {t.label}
      </span>
    );
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>Explore Tokens</h2>
          <p style={{ fontSize: '0.86rem', color: '#666' }}>
            Tokens listed on Front Protocol — click any token to trade with leverage
          </p>
        </div>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="search-wrapper" style={{ flex: 1, maxWidth: 500 }}>
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            placeholder="Search by name, symbol, or paste token address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {searching && <span style={{ fontSize: 12, color: '#666' }}>Searching...</span>}
      </div>

      {/* Token Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 12 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="skeleton" style={{ height: 160, borderRadius: 14 }} />
          ))}
        </div>
      ) : displayTokens.length === 0 ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '48px 16px', gap: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#888' }}>
            {search ? 'No tokens found' : 'No tokens listed yet'}
          </div>
          <div style={{ fontSize: 12, color: '#555' }}>
            {search ? 'Try a different search term or paste a token address' : 'Token creators can list tokens at /list'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 14 }}>
          {displayTokens.map((token) => (
            <div
              key={token.address}
              className="token-card"
              onClick={() => handleTokenClick(token)}
              style={{
                background: 'linear-gradient(135deg, #0c0c0f 0%, #0a0a0d 100%)',
                border: '1px solid #1a1a1f',
                borderRadius: 16,
                padding: '20px',
                cursor: 'pointer',
                transition: 'all 0.25s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#f0b90b40';
                e.currentTarget.style.transform = 'translateY(-3px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(240, 185, 11, 0.06)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#1a1a1f';
                e.currentTarget.style.transform = 'none';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Token Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <img
                  src={
                    token.imageUri
                      ? token.imageUri.replace('https://ipfs.io/ipfs/', 'https://cf-ipfs.com/ipfs/')
                      : `https://dd.dexscreener.com/ds-data/tokens/solana/${token.address}.png`
                  }
                  alt={token.symbol}
                  style={{
                    width: 42, height: 42, borderRadius: '50%',
                    objectFit: 'cover',
                    border: '2px solid #1a1a1f',
                  }}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    const step = img.dataset.fallback || '0';
                    if (step === '0') {
                      img.dataset.fallback = '1';
                      img.src = `https://dd.dexscreener.com/ds-data/tokens/solana/${token.address}.png`;
                    } else if (step === '1') {
                      img.dataset.fallback = '2';
                      img.src = `https://tokens.jup.ag/token/${token.address}/logo`;
                    } else {
                      img.style.display = 'none';
                      if (img.nextElementSibling) (img.nextElementSibling as HTMLElement).style.display = 'flex';
                    }
                  }}
                />
                <div style={{
                  width: 42, height: 42, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #f0b90b25, #f0b90b08)',
                  display: 'none',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, color: '#f0b90b',
                  border: '2px solid #1a1a1f',
                  flexShrink: 0,
                }}>
                  {token.symbol?.charAt(0) || '?'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
                      {token.symbol || 'Unknown'}
                    </span>
                    {token.tier && tierBadge(token.tier)}
                  </div>
                  <div style={{
                    fontSize: 12, color: '#666', marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {token.name || 'Unknown Token'}
                  </div>
                </div>
                {/* Price */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: '#fff',
                    fontFamily: "'JetBrains Mono', monospace",
                  }}>
                    {token.priceUsd != null
                      ? `$${token.priceUsd < 0.01 ? token.priceUsd.toExponential(2) : token.priceUsd.toFixed(4)}`
                      : ''}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>
                    {formatChange(token.priceChange24hPct)}
                  </div>
                </div>
              </div>

              {/* Stats Row */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: 14, borderTop: '1px solid #141418',
              }}>
                <div>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Volume</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                    {token.totalTradingVolume && token.totalTradingVolume !== '0'
                      ? `${formatSol(token.totalTradingVolume)} SOL`
                      : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Max Leverage</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f0b90b', fontFamily: "'JetBrains Mono', monospace" }}>
                    {token.maxLeverage ? `${token.maxLeverage}x` : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Fee</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ccc', fontFamily: "'JetBrains Mono', monospace" }}>
                    {token.flatFeePct ? `${token.flatFeePct}%` : '—'}
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
