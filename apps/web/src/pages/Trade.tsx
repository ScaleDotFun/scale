import { type FC, useState, useCallback, useTransition, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useTokens } from '../hooks/useTokens';
import { usePositions } from '../hooks/usePositions';
import { useTokenOverview } from '../hooks/useTokenOverview';
import { useAuth } from '../providers/AuthProvider';
import { PriceChart, type ChartPosition } from '../components/PriceChart';
import { TokenMetrics } from '../components/TokenMetrics';
import { ExecutionSettings } from '../components/ExecutionSettings';
import { LiquidationBar } from '../components/LiquidationBar';
import { TradesFeed } from '../components/TradesFeed';
import { VibeCommandBar, type ParsedCommand } from '../components/VibeCommandBar';
import { formatSol, formatPrice, formatCountdown, formatTimeAgo, solscanTxUrl } from '../lib/format';
import * as api from '../lib/api';

export const Trade: FC = () => {
  const {
    trending,
    selectedToken,
    selectToken,
    trendingLoading,
    search,
  } = useTokens();

  const {
    activePositions,
    tradeHistory,
    positionsFetchedAt,
    loading: positionsLoading,
    isOpening,
    isClosing,
    openPosition,
    closePosition,
  } = usePositions();

  // Shared token overview data — auto-polls every 15s
  const { overview: tokenOverview } = useTokenOverview(selectedToken?.address);
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  // Balance state
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  useEffect(() => {
    if (!isAuthenticated) { setWalletBalance(null); return; }
    api.getWalletBalance()
      .then((b) => setWalletBalance(b.balanceSol))
      .catch(() => setWalletBalance(null));
  }, [isAuthenticated]);

  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'trades'>('positions');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(3);
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [stopLossPct, setStopLossPct] = useState('');
  const [, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [expandedPosition, setExpandedPosition] = useState<number | null>(null);

  // ── Listing check state ──
  const [isTokenListed, setIsTokenListed] = useState<boolean | null>(null); // null = loading/unchecked
  const [searchParams] = useSearchParams();
  const tokenAddrFromUrl = searchParams.get('token');
  const lastLoadedAddr = useRef<string | null>(null);

  // ── Auto-select token from URL ?token= param ──
  useEffect(() => {
    if (!tokenAddrFromUrl) return;
    if (tokenAddrFromUrl === lastLoadedAddr.current) return;
    lastLoadedAddr.current = tokenAddrFromUrl;

    api.getTokenDetails(tokenAddrFromUrl)
      .then((info) => {
        selectToken(info);
      })
      .catch(() => {
        // Token not in our DB — create a minimal token for chart display
        selectToken({
          address: tokenAddrFromUrl,
          name: searchParams.get('name') || 'Unknown',
          symbol: searchParams.get('symbol') || tokenAddrFromUrl.slice(0, 6),
          tier: '',
        });
      });
  }, [tokenAddrFromUrl, selectToken, searchParams]);

  // ── Check if token is listed on Front ──
  useEffect(() => {
    if (!selectedToken?.address) {
      setIsTokenListed(null);
      return;
    }
    setIsTokenListed(null); // reset to loading
    api.getTokenDetails(selectedToken.address)
      .then((info) => {
        setIsTokenListed(info.isActive === true);
      })
      .catch(() => {
        setIsTokenListed(false);
      });
  }, [selectedToken?.address]);

  const tradingDisabled = isTokenListed === false;

  // ── Live engine ──────────────────────────────────────────────
  // Streamed price from the chart (per-txn, throttled to 2/s) —
  // drives PnL, mark price and entry-line labels without any polling
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const handleLivePrice = useCallback((p: number) => setLivePrice(p), []);
  useEffect(() => { setLivePrice(null); }, [selectedToken?.address]);

  // 1s heartbeat for countdowns
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  /**
   * Live PnL in collateral terms (price move % × leverage) — the same
   * scale as exitThreshold, so the liq bar compares like-for-like.
   * Only computable for the token whose price is streaming; positions
   * on other tokens show '—' rather than a fake 0.
   */
  const livePnLFor = useCallback((pos: api.PositionInfo): number | null => {
    if (pos.token?.address !== selectedToken?.address) return pos.livePnLPercent ?? null;
    const entry = parseFloat(pos.entryPrice ?? '0');
    const price = livePrice ?? tokenOverview?.price ?? 0;
    if (!(entry > 0) || !(price > 0)) return pos.livePnLPercent ?? null;
    return ((price / entry) - 1) * 100 * pos.leverage;
  }, [selectedToken?.address, livePrice, tokenOverview?.price]);

  // Computed values — use real tier data from token API when available
  const collateralSol = parseFloat(collateral) || 0;
  const positionSize = collateralSol * leverage;
  const protocolCapital = collateralSol * (leverage - 1);
  // Use tier-specific fee from API, fallback to 0.5% for display before token loads
  const flatFeePct = selectedToken?.flatFeePct ?? 0.5;
  const flatFee = positionSize * (flatFeePct / 100);
  // Use tier-specific exit threshold from API, fallback to dynamic estimate
  const exitThreshold = selectedToken?.exitThresholdPct ?? -(100 / leverage);
  const markPrice = tokenOverview?.price ?? 0;
  const tpPct = parseFloat(takeProfitPct) || 0;
  const slPct = parseFloat(stopLossPct) || 0;
  const tpPrice = markPrice && tpPct > 0 ? markPrice * (1 + tpPct / 100) : 0;
  const slPrice = markPrice && slPct > 0 ? markPrice * (1 - slPct / 100) : 0;
  const liqPrice = markPrice ? markPrice * (1 + exitThreshold / (100 * leverage)) : 0;
  const positionSizeUsd = markPrice ? positionSize * markPrice : 0;

  // Chart position annotations — pnlPercent updates with each tick,
  // so the ENTRY line label breathes with the market
  const chartPositions: ChartPosition[] = activePositions
    .filter((pos) => pos.token?.address === selectedToken?.address)
    .map((pos) => {
      const entry = parseFloat(pos.entryPrice ?? '0');
      const exitPct = parseFloat(pos.exitThreshold) || -10;
      return {
        entryPrice: entry,
        liquidationPrice: entry > 0 ? entry * (1 + exitPct / (100 * pos.leverage)) : 0,
        side: 'long' as const,
        leverage: pos.leverage,
        pnlPercent: livePnLFor(pos) ?? undefined,
      };
    });

  // Also show preview lines when configuring a trade
  const previewPositions: ChartPosition[] = (markPrice > 0 && collateralSol > 0) ? [{
    entryPrice: markPrice,
    liquidationPrice: liqPrice,
    takeProfitPrice: tpPrice || undefined,
    stopLossPrice: slPrice || undefined,
    side: 'long',
    leverage,
  }] : [];

  const allChartPositions = chartPositions.length > 0 ? chartPositions : previewPositions;

  // Vibe Command Bar
  const handleParsedCommand = useCallback((parsed: ParsedCommand) => {
    if (parsed.capitalSol != null) setCollateral(String(parsed.capitalSol));
    if (parsed.leverage != null) setLeverage(parsed.leverage);
    if (parsed.tokenQuery) {
      const match = trending.find(
        (t) => t.symbol.toLowerCase() === parsed.tokenQuery!.toLowerCase(),
      );
      if (match) startTransition(() => selectToken(match));
    }
  }, [trending, selectToken, startTransition]);

  const executePosition = useCallback(async () => {
    if (!selectedToken || collateralSol <= 0 || isOpening) return;
    setShowConfirmModal(false);
    setOptimisticState('submitting');
    setErrorMessage('');
    try {
      const capitalLamports = String(Math.round(collateralSol * 1e9));
      await openPosition(selectedToken.address, capitalLamports, leverage);
      setOptimisticState('success');
      setCollateral('');
      setTakeProfitPct('');
      setStopLossPct('');
      setTimeout(() => setOptimisticState('idle'), 2000);
    } catch (err: any) {
      let msg = 'Something went wrong. Please try again.';
      if (err?.body) {
        const b = err.body as any;
        if (b.details?.length) msg = b.details[0];
        else if (b.error) msg = b.error;
      } else if (err?.message) {
        msg = err.message;
      }
      setErrorMessage(msg);
      setOptimisticState('error');
      setTimeout(() => setOptimisticState('idle'), 6000);
    }
  }, [selectedToken, collateralSol, leverage, isOpening, openPosition]);

  const handleBuyClick = useCallback(() => {
    if (!selectedToken || collateralSol <= 0) return;
    setShowConfirmModal(true);
  }, [selectedToken, collateralSol]);

  // Keyboard shortcut for confirm
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showConfirmModal && e.key === 'Enter') {
        e.preventDefault();
        executePosition();
      }
      if (showConfirmModal && e.key === 'Escape') {
        setShowConfirmModal(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showConfirmModal, executePosition]);

  const apeButtonLabel = () => {
    if (optimisticState === 'submitting' || isOpening) return 'Opening...';
    if (optimisticState === 'success') return 'Position Opened ✓';
    if (optimisticState === 'error') return 'Failed — Retry';
    return `Buy ${positionSize > 0 ? positionSize.toFixed(2) + ' SOL' : ''}`;
  };

  // Time remaining — counts down live between position polls
  const getTimeLeft = (pos: any) => {
    const elapsed = nowTick - positionsFetchedAt.current;
    const ms = Math.max(0, (pos.timeRemainingMs ?? 0) - elapsed);
    if (ms <= 0) return { text: 'Expired', color: '#ff4d4d' };
    const hours = ms / 3600000;
    const color = hours > 12 ? '#3dff9e' : hours > 4 ? 'var(--primary-hover)' : '#ff4d4d';
    return { text: formatCountdown(ms), color };
  };

  return (
    <>
      <div className="bento-grid">
        {/* ── LEFT: Chart + Metrics + Table ──── */}
        <div className="bento-center">
          {/* Token Metrics Row */}
          {selectedToken && (
            <div className="bento-metrics">
              <TokenMetrics token={selectedToken} overview={tokenOverview} />
            </div>
          )}

          {/* Chart — shows entry/liq/TP/SL lines */}
          <div className="bento-chart">
            <PriceChart
              tokenAddress={selectedToken?.address}
              positions={allChartPositions}
              supply={tokenOverview?.supply}
              onPrice={handleLivePrice}
            />
          </div>

          {/* Positions / History / Trades Table */}
          <div className="bento-table">
            <div className="bento-table-tabs">
              <button
                className={`bento-tab ${activeTab === 'positions' ? 'bento-tab-active' : ''}`}
                onClick={() => setActiveTab('positions')}
              >
                Positions
                {activePositions.length > 0 && (
                  <span className="bento-tab-count">{activePositions.length}</span>
                )}
              </button>
              <button
                className={`bento-tab ${activeTab === 'history' ? 'bento-tab-active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                History
              </button>
              <button
                className={`bento-tab ${activeTab === 'trades' ? 'bento-tab-active' : ''}`}
                onClick={() => setActiveTab('trades')}
              >
                Trades
              </button>
            </div>

            <div className="bento-table-body">
              {activeTab === 'positions' ? (
                activePositions.length === 0 ? (
                  <div className="bento-table-empty">No open positions</div>
                ) : (
                  <table className="terminal-table">
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Size</th>
                        <th>Lev</th>
                        <th>Entry</th>
                        <th>Mark</th>
                        <th>PnL</th>
                        <th>Time Left</th>
                        <th>Liq</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePositions.map((pos) => {
                        const livePnl = livePnLFor(pos);
                        const pnl = livePnl ?? 0;
                        const hasPnl = livePnl != null;
                        const pnlSol = (pnl / 100) * Number(pos.userCapital || 0) / 1e9;
                        const timeLeft = getTimeLeft(pos);
                        const isExpanded = expandedPosition === pos.id;
                        const entryNum = parseFloat(pos.entryPrice ?? '0');
                        const exitPct = parseFloat(pos.exitThreshold) || -10;
                        const liqPricePos = entryNum > 0 ? entryNum * (1 + exitPct / (100 * pos.leverage)) : 0;

                        return (
                          <tr
                            key={pos.id}
                            className={`pos-row ${hasPnl ? (pnl >= 0 ? 'pos-row-profit' : 'pos-row-loss') : ''}`}
                            onClick={() => setExpandedPosition(isExpanded ? null : pos.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td className="cell-token">
                              {pos.token?.symbol ?? '???'}
                            </td>
                            <td className="mono">{formatSol(pos.userCapital)}</td>
                            <td className="mono">{pos.leverage}x</td>
                            <td className="mono">{pos.entryPrice ? `$${formatPrice(parseFloat(pos.entryPrice))}` : '--'}</td>
                            <td className="mono" style={{ color: 'var(--primary)' }}>
                              {pos.token?.address === selectedToken?.address && (livePrice ?? markPrice) > 0
                                ? `$${formatPrice(livePrice ?? markPrice)}`
                                : '--'}
                            </td>
                            <td>
                              {hasPnl ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  <span
                                    className="mono"
                                    style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 12 }}
                                  >
                                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
                                  </span>
                                  <span
                                    className="mono"
                                    style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--red)', fontSize: 10, opacity: 0.7 }}
                                  >
                                    {pnlSol >= 0 ? '+' : ''}{pnlSol.toFixed(4)} SOL
                                  </span>
                                </div>
                              ) : (
                                <span className="mono text-dim" title="Select this token to stream its price">—</span>
                              )}
                            </td>
                            <td>
                              <span className="mono" style={{ color: timeLeft.color, fontSize: 11 }}>
                                {timeLeft.text}
                              </span>
                            </td>
                            <td style={{ width: 80 }}>
                              <LiquidationBar
                                livePnlPercent={pnl}
                                exitThresholdPct={exitPct}
                                status={pos.status}
                              />
                            </td>
                            <td>
                              <button
                                className="btn-close-pos"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  closePosition(String(pos.id));
                                }}
                                disabled={isClosing === String(pos.id)}
                              >
                                {isClosing === String(pos.id) ? '...' : 'Close'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              ) : activeTab === 'history' ? (
                tradeHistory.length === 0 ? (
                  <div className="bento-table-empty">No trade history</div>
                ) : (
                  <table className="terminal-table">
                    <thead>
                      <tr>
                        <th>Token</th>
                        <th>Profit</th>
                        <th>Status</th>
                        <th>Closed</th>
                        <th>Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeHistory.map((pos) => {
                        const profit = parseFloat(pos.pnlSol ?? '0');
                        return (
                          <tr key={pos.id}>
                            <td className="cell-token">{pos.token?.symbol ?? '???'}</td>
                            <td>
                              <span
                                className="mono"
                                style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}
                              >
                                {profit >= 0 ? '+' : ''}{profit.toFixed(4)} SOL
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge ${pos.status === 'closed_profit' ? 'status-profit' : 'status-loss'}`}>
                                {pos.status === 'closed_profit' ? 'Profit' : pos.status === 'liquidated' ? 'Liquidated' : 'Loss'}
                              </span>
                            </td>
                            <td className="text-right text-dim">{pos.closedAt ? formatTimeAgo(pos.closedAt) : '--'}</td>
                            <td className="text-right">
                              {pos.closeTx && (
                                <a href={solscanTxUrl(pos.closeTx)} target="_blank" rel="noreferrer" className="link-dim">Tx</a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              ) : (
                <TradesFeed tokenAddress={selectedToken?.address} />
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Execution Panel ──────────── */}
        <div className="bento-right">
          <div className="bento-exec">
            <div className="exec-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {tokenOverview?.logoURI && (
                  <img
                    src={tokenOverview.logoURI}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: '50%' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <span className="exec-header-title">Execute</span>
              </div>
              {selectedToken && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {markPrice > 0 && (
                    <span style={{
                      fontSize: 11,
                      color: '#a8a184',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      ${formatPrice(markPrice)}
                    </span>
                  )}
                  <span className="exec-header-token">{selectedToken.symbol}</span>
                </div>
              )}
            </div>

            {!selectedToken ? (
              <div className="exec-empty">
                <span className="exec-empty-text">Select a token</span>
                <span className="exec-empty-hint">from the ticker bar above</span>
              </div>
            ) : (
              <div className="exec-form">
                {/* Unlisted token banner */}
                {tradingDisabled && (
                  <div style={{
                    padding: '14px 16px',
                    background: 'rgba(255, 77, 77, 0.04)',
                    border: '1px solid rgba(255, 100, 50, 0.2)',
                    borderRadius: 0,
                    marginBottom: 4,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#ffd75e', marginBottom: 4 }}>
                      This token is not listed on Front.
                    </div>
                    <div style={{ fontSize: 12, color: '#a8a184' }}>
                      Trading is not available for unlisted tokens.
                    </div>
                    <Link to="/list" style={{
                      display: 'inline-block', marginTop: 8, fontSize: 11, color: 'var(--primary)',
                      textDecoration: 'none',
                    }}>
                      Token creators can list at /list →
                    </Link>
                  </div>
                )}
                {/* Capital */}
                <div className="exec-field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="exec-label">Collateral</label>
                    {walletBalance && (
                      <span style={{ fontSize: 11, color: '#a8a184', fontFamily: 'var(--font-mono)' }}>
                        Balance: <span style={{ color: 'var(--primary)' }}>{parseFloat(walletBalance).toFixed(4)}</span> SOL
                      </span>
                    )}
                  </div>
                  <div className="exec-input-wrap">
                    <input
                      className="exec-input"
                      type="number"
                      placeholder="0.00"
                      step="0.1"
                      min="0"
                      value={collateral}
                      onChange={(e) => setCollateral(e.target.value)}
                    />
                    <span className="exec-input-unit">SOL</span>
                  </div>
                  <div className="exec-presets">
                    {['0.1', '0.25', '0.5', '1.0'].map((amt) => (
                      <motion.button
                        key={amt}
                        className="exec-preset-btn"
                        onClick={() => setCollateral(amt)}
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                      >
                        {amt}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Leverage — Slider + Buttons */}
                <div className="exec-field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className="exec-label">Leverage</label>
                    <span style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--primary)',
                      fontFamily: 'var(--font-mono)',
                    }}>
                      {leverage}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="10"
                    step="1"
                    value={leverage}
                    onChange={(e) => setLeverage(Number(e.target.value))}
                    className="leverage-slider"
                  />
                  <div className="exec-lev-row">
                    {[2, 3, 5, 7, 10].map((lev) => (
                      <motion.button
                        key={lev}
                        className={`exec-lev-btn ${leverage === lev ? 'exec-lev-active' : ''}`}
                        onClick={() => setLeverage(lev)}
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.94 }}
                      >
                        {lev}x
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* Take Profit / Stop Loss */}
                <div className="exec-field">
                  <label className="exec-label">Take Profit / Stop Loss</label>
                  <div className="exec-tpsl-row">
                    <div className="exec-tpsl-input-wrap">
                      <span className="exec-tpsl-icon" style={{ color: '#3dff9e' }}>TP</span>
                      <input
                        className="exec-tpsl-input"
                        type="number"
                        placeholder="—"
                        step="1"
                        min="0"
                        value={takeProfitPct}
                        onChange={(e) => setTakeProfitPct(e.target.value)}
                      />
                      <span className="exec-tpsl-unit">%</span>
                    </div>
                    <div className="exec-tpsl-input-wrap">
                      <span className="exec-tpsl-icon" style={{ color: '#ffd75e' }}>SL</span>
                      <input
                        className="exec-tpsl-input"
                        type="number"
                        placeholder="—"
                        step="1"
                        min="0"
                        value={stopLossPct}
                        onChange={(e) => setStopLossPct(e.target.value)}
                      />
                      <span className="exec-tpsl-unit">%</span>
                    </div>
                  </div>
                  {(tpPrice > 0 || slPrice > 0) && (
                    <div className="exec-tpsl-prices">
                      {tpPrice > 0 && <span style={{ color: '#3dff9e', fontSize: 10 }}>TP: ${formatPrice(tpPrice)}</span>}
                      {slPrice > 0 && <span style={{ color: '#ffd75e', fontSize: 10 }}>SL: ${formatPrice(slPrice)}</span>}
                    </div>
                  )}
                </div>

                {/* Execution Settings */}
                <ExecutionSettings />

                {/* Breakdown */}
                <div className="exec-breakdown">
                  <div className="exec-row">
                    <span>Position Size</span>
                    <div style={{ textAlign: 'right' }}>
                      <span className="mono">{positionSize.toFixed(3)} SOL</span>
                      {positionSizeUsd > 0 && (
                        <span className="mono" style={{ color: '#6b664f', fontSize: 10, marginLeft: 4 }}>
                          (${positionSizeUsd.toFixed(2)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="exec-row">
                    <span>Protocol Fills</span>
                    <span className="mono" style={{ color: 'var(--primary)' }}>{protocolCapital.toFixed(3)} SOL</span>
                  </div>
                  <div className="exec-row">
                    <span>Fee (0.5%)</span>
                    <span className="mono">{flatFee.toFixed(4)} SOL</span>
                  </div>
                  <div className="exec-row">
                    <span>Liquidation</span>
                    <div style={{ textAlign: 'right' }}>
                      <span className="mono" style={{ color: 'var(--red)' }}>{exitThreshold.toFixed(1)}%</span>
                      {liqPrice > 0 && (
                        <span className="mono" style={{ color: '#6b664f', fontSize: 10, marginLeft: 4 }}>
                          (${formatPrice(liqPrice)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="exec-row">
                    <span>Duration</span>
                    <span className="mono">24h max</span>
                  </div>
                  <div className="exec-row">
                    <span>Profit Lock</span>
                    <span className="mono" style={{ color: 'var(--yellow)' }}>30% &rarr; $FRONT</span>
                  </div>
                </div>

                {/* Execute Button */}
                {!isAuthenticated ? (
                  <motion.button
                    className="exec-btn"
                    onClick={() => navigate('/auth')}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    style={{ background: 'var(--primary)' }}
                  >
                    Sign in to Trade
                  </motion.button>
                ) : (
                  <motion.button
                    className={`exec-btn ${
                      optimisticState === 'success' ? 'exec-btn-success' :
                      optimisticState === 'error' ? 'exec-btn-error' : ''
                    }`}
                    onClick={handleBuyClick}
                    disabled={tradingDisabled || optimisticState === 'submitting' || isOpening || collateralSol <= 0}
                    whileHover={tradingDisabled ? {} : { scale: 1.01 }}
                    whileTap={tradingDisabled ? {} : { scale: 0.99 }}
                  >
                    {tradingDisabled ? 'Trading Unavailable' : apeButtonLabel()}
                  </motion.button>
                )}

                {/* Error message */}
                {errorMessage && optimisticState === 'error' && (
                  <div style={{
                    marginTop: 8,
                    padding: '10px 14px',
                    borderRadius: 0,
                    background: 'rgba(255, 77, 77, 0.08)',
                    border: '1px solid rgba(255, 77, 77, 0.2)',
                    color: '#ff6b6b',
                    fontSize: '0.82rem',
                    lineHeight: 1.5,
                  }}>
                    {errorMessage}
                  </div>
                )}
              </div>
            )}

            {/* ── Your positions for this token ── */}
            {(() => {
              const tokenPositions = activePositions.filter(
                (pos) => pos.token?.address === selectedToken?.address
              );
              if (tokenPositions.length === 0) return null;
              return (
                <div style={{
                  marginTop: 16,
                  padding: '14px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid #262418',
                  borderRadius: 0,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: '#a8a184',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    marginBottom: 10,
                  }}>
                    Your Positions · {selectedToken?.symbol}
                  </div>
                  {tokenPositions.map((pos) => {
                    const pnl = pos.livePnLPercent ?? 0;
                    const pnlSol = (pnl / 100) * Number(pos.userCapital || 0) / 1e9;
                    const entryNum = parseFloat(pos.entryPrice ?? '0');
                    const timeMs = pos.timeRemainingMs ?? 0;
                    const timeStr = timeMs <= 0 ? 'Expired' : formatCountdown(timeMs);
                    const timeColor = timeMs <= 0 ? '#ff4d4d' : timeMs > 12 * 3600000 ? '#3dff9e' : timeMs > 4 * 3600000 ? 'var(--primary-hover)' : '#ff4d4d';

                    return (
                      <div
                        key={pos.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 0',
                          borderTop: '1px solid #12110c',
                          gap: 8,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#f2eee2' }}>{pos.leverage}x</span>
                            <span
                              className="mono"
                              style={{
                                fontSize: 12,
                                color: pnl >= 0 ? 'var(--green)' : 'var(--red)',
                                fontWeight: 600,
                              }}
                            >
                              {pnl >= 0 ? '+' : ''}{pnl.toFixed(1)}%
                            </span>
                            <span className="mono" style={{
                              fontSize: 10, color: pnl >= 0 ? 'var(--green)' : 'var(--red)', opacity: 0.7
                            }}>
                              ({pnlSol >= 0 ? '+' : ''}{pnlSol.toFixed(4)} SOL)
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#6b664f' }}>
                            <span>Entry: <span className="mono" style={{ color: '#a8a184' }}>${formatPrice(entryNum)}</span></span>
                            <span>Size: <span className="mono" style={{ color: '#a8a184' }}>{formatSol(pos.userCapital)}</span></span>
                            <span style={{ color: timeColor }}>{timeStr}</span>
                          </div>
                        </div>
                        <motion.button
                          onClick={() => closePosition(String(pos.id))}
                          disabled={isClosing === String(pos.id)}
                          whileHover={{ scale: 1.04 }}
                          whileTap={{ scale: 0.96 }}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 0,
                            border: 'none',
                            background: pnl >= 0
                              ? 'linear-gradient(135deg, rgba(61, 255, 158,0.15), rgba(61, 255, 158,0.08))'
                              : 'linear-gradient(135deg, rgba(255, 77, 77,0.15), rgba(255, 77, 77,0.08))',
                            color: pnl >= 0 ? '#3dff9e' : '#ff4d4d',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: isClosing === String(pos.id) ? 'wait' : 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isClosing === String(pos.id) ? 'Closing...' : 'Close'}
                        </motion.button>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Order Confirmation Modal ────────── */}
      <AnimatePresence>
        {showConfirmModal && selectedToken && (
          <motion.div
            className="confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setShowConfirmModal(false)}
          >
            <motion.div
              className="confirm-modal"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="confirm-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {tokenOverview?.logoURI && (
                    <img
                      src={tokenOverview.logoURI}
                      alt=""
                      style={{ width: 24, height: 24, borderRadius: '50%' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <span className="confirm-title">Confirm Long {selectedToken.symbol}</span>
                </div>
                <button className="confirm-close" onClick={() => setShowConfirmModal(false)}>✕</button>
              </div>

              <div className="confirm-body">
                <div className="confirm-row">
                  <span>Collateral</span>
                  <span className="mono">{collateralSol} SOL</span>
                </div>
                <div className="confirm-row">
                  <span>Position Size</span>
                  <span className="mono">{positionSize.toFixed(3)} SOL {positionSizeUsd > 0 && `($${positionSizeUsd.toFixed(2)})`}</span>
                </div>
                <div className="confirm-row">
                  <span>Leverage</span>
                  <span className="mono" style={{ color: 'var(--primary)' }}>{leverage}x</span>
                </div>
                <div className="confirm-divider" />
                <div className="confirm-row">
                  <span>Entry Price</span>
                  <span className="mono">{markPrice > 0 ? `$${formatPrice(markPrice)}` : 'Market'}</span>
                </div>
                <div className="confirm-row">
                  <span>Liquidation Price</span>
                  <span className="mono" style={{ color: '#ff4d4d' }}>{liqPrice > 0 ? `$${formatPrice(liqPrice)}` : '--'}</span>
                </div>
                {tpPrice > 0 && (
                  <div className="confirm-row">
                    <span>Take Profit</span>
                    <span className="mono" style={{ color: '#3dff9e' }}>${formatPrice(tpPrice)} (+{tpPct}%)</span>
                  </div>
                )}
                {slPrice > 0 && (
                  <div className="confirm-row">
                    <span>Stop Loss</span>
                    <span className="mono" style={{ color: '#ffd75e' }}>${formatPrice(slPrice)} (-{slPct}%)</span>
                  </div>
                )}
                <div className="confirm-divider" />
                <div className="confirm-row">
                  <span>Fee (0.5%)</span>
                  <span className="mono">{flatFee.toFixed(4)} SOL</span>
                </div>
                <div className="confirm-row">
                  <span>Max Duration</span>
                  <span className="mono">24 hours</span>
                </div>
                <div className="confirm-row">
                  <span>Profit Lock</span>
                  <span className="mono" style={{ color: 'var(--primary)' }}>30% → $FRONT</span>
                </div>
              </div>

              <div className="confirm-actions">
                <button className="confirm-cancel-btn" onClick={() => setShowConfirmModal(false)}>
                  Cancel
                </button>
                <motion.button
                  className="confirm-execute-btn"
                  onClick={executePosition}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Confirm Long {positionSize.toFixed(2)} SOL
                </motion.button>
              </div>

              <div className="confirm-hint">Press Enter to confirm · Esc to cancel</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Command Bar ────────────────── */}
      <VibeCommandBar
        onParsedCommand={handleParsedCommand}
        onExecute={handleBuyClick}
        selectedTokenSymbol={selectedToken?.symbol}
      />
    </>
  );
};
