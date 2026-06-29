import { type FC, useState, useEffect, useRef } from 'react';
import type { TokenInfo } from '../lib/api';
import { fetchTokenSecurity, type TokenOverview, type TokenSecurity } from '../lib/birdeye';

interface TokenMetricsProps {
  token: TokenInfo;
  overview?: TokenOverview | null;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

/**
 * Rich token metrics bar powered by Birdeye API data.
 * Shows MCAP, LIQ, VOL 24H, TRADES, HOLDERS, BUY/SELL ratio, TOP 10 concentration,
 * security flags (mint authority, freeze authority), and tier badge.
 */
export const TokenMetrics: FC<TokenMetricsProps> = ({ token, overview }) => {
  const [security, setSecurity] = useState<TokenSecurity | null>(null);
  const lastAddress = useRef('');

  useEffect(() => {
    if (!token.address || token.address === lastAddress.current) return;
    lastAddress.current = token.address;
    fetchTokenSecurity(token.address).then(setSecurity);
  }, [token.address]);

  const tierConfig = {
    bonded: { label: 'BONDED', color: '#34d399', bg: 'rgba(52, 211, 153, 0.08)' },
    rising: { label: 'RISING', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.08)' },
    degen: { label: 'DEGEN', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)' },
  }[token.tier] ?? { label: token.tier.toUpperCase(), color: '#888', bg: 'rgba(128,128,128,0.08)' };

  // Use Birdeye data if available, otherwise fallback to token data
  const mcap = overview?.marketCap ?? token.marketCapUsd ?? 0;
  const liq = overview?.liquidity ?? token.liquidityUsd ?? 0;
  const vol24h = overview?.volume24h ?? 0;
  const trade24h = overview?.trade24h ?? 0;
  const holders = overview?.holder ?? 0;
  const buy24h = overview?.buy24h ?? 0;
  const sell24h = overview?.sell24h ?? 0;
  const buyRatio = buy24h + sell24h > 0 ? (buy24h / (buy24h + sell24h)) * 100 : 50;
  const uniqueWallets = overview?.uniqueWallet24h ?? 0;
  const top10Pct = security?.top10HolderPercent != null ? security.top10HolderPercent * 100 : null;
  const hasMintAuth = security?.mintAuthority != null && security.mintAuthority !== '';
  const hasFreezeAuth = security?.freezeAuthority != null && security.freezeAuthority !== '';
  const priceChange = overview?.priceChange24h ?? token.priceChange24hPct ?? 0;

  return (
    <div className="token-metrics">
      {/* MCAP */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">MCAP</span>
        <span className="token-metrics-value">{formatCompact(mcap)}</span>
      </div>
      <div className="token-metrics-sep" />

      {/* LIQ */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">LIQ</span>
        <span className="token-metrics-value">{formatCompact(liq)}</span>
      </div>
      <div className="token-metrics-sep" />

      {/* VOL 24H */}
      {vol24h > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">VOL 24H</span>
            <span className="token-metrics-value">{formatCompact(vol24h)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* TRADES 24H */}
      {trade24h > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">TXNS</span>
            <span className="token-metrics-value">{formatNum(trade24h)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* HOLDERS */}
      {holders > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">HOLDERS</span>
            <span className="token-metrics-value">{formatNum(holders)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* BUY/SELL RATIO */}
      {(buy24h + sell24h) > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">B/S</span>
            <span className="token-metrics-value">
              <span style={{ color: '#34d399' }}>{buyRatio.toFixed(0)}%</span>
              <span style={{ color: '#333', margin: '0 2px' }}>/</span>
              <span style={{ color: '#ef4444' }}>{(100 - buyRatio).toFixed(0)}%</span>
            </span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* WALLETS */}
      {uniqueWallets > 0 && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">WALLETS</span>
            <span className="token-metrics-value">{formatNum(uniqueWallets)}</span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* TOP 10 */}
      {top10Pct != null && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">TOP 10</span>
            <span className="token-metrics-value" style={{
              color: top10Pct > 60 ? '#ef4444' : top10Pct > 40 ? '#fbbf24' : '#34d399',
            }}>
              {top10Pct.toFixed(1)}%
            </span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* SECURITY FLAGS */}
      {security && (
        <>
          <div className="token-metrics-item">
            <span className="token-metrics-label">MINT</span>
            <span className="token-metrics-value" style={{
              color: hasMintAuth ? '#ef4444' : '#34d399',
              fontSize: 9,
              fontWeight: 700,
            }}>
              {hasMintAuth ? 'ENABLED' : 'REVOKED'}
            </span>
          </div>
          <div className="token-metrics-sep" />
          <div className="token-metrics-item">
            <span className="token-metrics-label">FREEZE</span>
            <span className="token-metrics-value" style={{
              color: hasFreezeAuth ? '#ef4444' : '#34d399',
              fontSize: 9,
              fontWeight: 700,
            }}>
              {hasFreezeAuth ? 'ENABLED' : 'REVOKED'}
            </span>
          </div>
          <div className="token-metrics-sep" />
        </>
      )}

      {/* TIER */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">TIER</span>
        <span
          className="token-metrics-tier"
          style={{ color: tierConfig.color, background: tierConfig.bg }}
        >
          {tierConfig.label}
        </span>
      </div>
      <div className="token-metrics-sep" />

      {/* 24H CHANGE */}
      <div className="token-metrics-item">
        <span className="token-metrics-label">24H</span>
        <span
          className="token-metrics-value"
          style={{ color: priceChange >= 0 ? '#34d399' : '#ef4444' }}
        >
          {priceChange >= 0 ? '+' : ''}
          {priceChange.toFixed(2)}%
        </span>
      </div>
    </div>
  );
};
