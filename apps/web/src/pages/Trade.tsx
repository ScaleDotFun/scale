import { type FC, useState, useCallback, useTransition, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTokens } from '../hooks/useTokens';
import { usePositions } from '../hooks/usePositions';
import { useTokenOverview } from '../hooks/useTokenOverview';
import { PriceChart, type ChartPosition } from '../components/PriceChart';
import { TokenMetrics } from '../components/TokenMetrics';
import { ExecutionSettings } from '../components/ExecutionSettings';
import { LiquidationBar } from '../components/LiquidationBar';
import { TradesFeed } from '../components/TradesFeed';
import { VibeCommandBar, type ParsedCommand } from '../components/VibeCommandBar';
import { formatSol, formatPrice, formatCountdown, formatTimeAgo, solscanTxUrl } from '../lib/format';

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
    loading: positionsLoading,
    isOpening,
    isClosing,
    openPosition,
    closePosition,
  } = usePositions();

  // Shared token overview data — auto-polls every 15s
  const { overview: tokenOverview } = useTokenOverview(selectedToken?.address);

  const [activeTab, setActiveTab] = useState<'positions' | 'history' | 'trades'>('positions');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(3);
  const [takeProfitPct, setTakeProfitPct] = useState('');
  const [stopLossPct, setStopLossPct] = useState('');
  const [, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [expandedPosition, setExpandedPosition] = useState<number | null>(null);

  // Computed values
  const collateralSol = parseFloat(collateral) || 0;
  const positionSize = collateralSol * leverage;
  const protocolCapital = collateralSol * (leverage - 1);
  const flatFee = positionSize * 0.005;
  const exitThreshold = selectedToken?.exitThresholdPct ? -Math.abs(selectedToken.exitThresholdPct) : selectedToken?.tier === 'bonded' ? -15 : selectedToken?.tier === 'rising' ? -12 : -10;
  const markPrice = tokenOverview?.price ?? 0;
  const tpPct = parseFloat(takeProfitPct) || 0;
  const slPct = parseFloat(stopLossPct) || 0;
  const tpPrice = markPrice && tpPct > 0 ? markPrice * (1 + tpPct / 100) : 0;
  const slPrice = markPrice && slPct > 0 ? markPrice * (1 - slPct / 100) : 0;
  const liqPrice = markPrice ? markPrice * (1 + exitThreshold / (100 * leverage)) : 0;
  const positionSizeUsd = markPrice ? positionSize * markPrice : 0;

  // Chart position annotations
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
        pnlPercent: pos.livePnLPercent ?? undefined,
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
    try {
      const capitalLamports = String(Math.round(collateralSol * 1e9));
      await openPosition(selectedToken.address, capitalLamports, leverage);
      setOptimisticState('success');
      setCollateral('');
      setTakeProfitPct('');
      setStopLossPct('');
      setTimeout(() => setOptimisticState('idle'), 2000);
    } catch {
      setOptimisticState('error');
      setTimeout(() => setOptimisticState('idle'), 2000);
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

  // Time remaining helper
  const getTimeLeft = (pos: any) => {
    const ms = pos.timeRemainingMs ?? 0;
    if (ms <= 0) return { text: 'Expired', color: '#ff3b3b' };
    const hours = ms / 3600000;
    const color = hours > 12 ? '#34d399' : hours > 4 ? '#fbbf24' : '#ff3b3b';
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
                        const pnl = pos.livePnLPercent ?? 0;
                        const pnlSol = (pnl / 100) * Number(pos.userCapital || 0) / 1e9;
                        const timeLeft = getTimeLeft(pos);
                        const isExpanded = expandedPosition === pos.id;
                        const entryNum = parseFloat(pos.entryPrice ?? '0');
                        const exitPct = parseFloat(pos.exitThreshold) || -10;
                        const liqPricePos = entryNum > 0 ? entryNum * (1 + exitPct / (100 * pos.leverage)) : 0;

                        return (
                          <tr
                            key={pos.id}
                            className={`pos-row ${pnl >= 0 ? 'pos-row-profit' : 'pos-row-loss'}`}
                            onClick={() => setExpandedPosition(isExpanded ? null : pos.id)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td className="cell-token">
                              {pos.token?.symbol ?? '???'}
                            </td>
                            <td className="mono">{formatSol(pos.userCapital)}</td>
                            <td className="mono">{pos.leverage}x</td>
                            <td className="mono">{pos.entryPrice ? `$${formatPrice(parseFloat(pos.entryPrice))}` : '--'}</td>
                            <td className="mono" style={{ color: '#f0b90b' }}>
                              {tokenOverview && pos.token?.address === selectedToken?.address
                                ? `$${formatPrice(markPrice)}`
                                : '--'}
                            </td>
                            <td>
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
                      color: '#888',
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
                {/* Capital */}
                <div className="exec-field">
                  <label className="exec-label">Collateral</label>
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
                      color: '#f0b90b',
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
                      <span className="exec-tpsl-icon" style={{ color: '#00c853' }}>TP</span>
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
                      <span className="exec-tpsl-icon" style={{ color: '#ff6d00' }}>SL</span>
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
                      {tpPrice > 0 && <span style={{ color: '#00c853', fontSize: 10 }}>TP: ${formatPrice(tpPrice)}</span>}
                      {slPrice > 0 && <span style={{ color: '#ff6d00', fontSize: 10 }}>SL: ${formatPrice(slPrice)}</span>}
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
                        <span className="mono" style={{ color: '#555', fontSize: 10, marginLeft: 4 }}>
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
                      <span className="mono" style={{ color: 'var(--red)' }}>{exitThreshold}%</span>
                      {liqPrice > 0 && (
                        <span className="mono" style={{ color: '#555', fontSize: 10, marginLeft: 4 }}>
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
                <motion.button
                  className={`exec-btn ${
                    optimisticState === 'success' ? 'exec-btn-success' :
                    optimisticState === 'error' ? 'exec-btn-error' : ''
                  }`}
                  onClick={handleBuyClick}
                  disabled={optimisticState === 'submitting' || isOpening || collateralSol <= 0}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  {apeButtonLabel()}
                </motion.button>
              </div>
            )}

            {/* Mini positions */}
            {activePositions.length > 0 && (
              <div className="exec-mini-positions">
                <div className="exec-mini-header">Active Positions</div>
                {activePositions.slice(0, 4).map((pos) => (
                  <div key={pos.id} className="exec-mini-row">
                    <span className="exec-mini-token">{pos.token?.symbol ?? '???'} <span className="text-dim">{pos.leverage}x</span></span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: (pos.livePnLPercent ?? 0) >= 0 ? 'var(--green)' : 'var(--red)',
                      }}
                    >
                      {pos.livePnLPercent != null
                        ? `${pos.livePnLPercent >= 0 ? '+' : ''}${pos.livePnLPercent.toFixed(1)}%`
                        : '--'}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                  <span className="mono" style={{ color: '#f0b90b' }}>{leverage}x</span>
                </div>
                <div className="confirm-divider" />
                <div className="confirm-row">
                  <span>Entry Price</span>
                  <span className="mono">{markPrice > 0 ? `$${formatPrice(markPrice)}` : 'Market'}</span>
                </div>
                <div className="confirm-row">
                  <span>Liquidation Price</span>
                  <span className="mono" style={{ color: '#ff3b3b' }}>{liqPrice > 0 ? `$${formatPrice(liqPrice)}` : '--'}</span>
                </div>
                {tpPrice > 0 && (
                  <div className="confirm-row">
                    <span>Take Profit</span>
                    <span className="mono" style={{ color: '#00c853' }}>${formatPrice(tpPrice)} (+{tpPct}%)</span>
                  </div>
                )}
                {slPrice > 0 && (
                  <div className="confirm-row">
                    <span>Stop Loss</span>
                    <span className="mono" style={{ color: '#ff6d00' }}>${formatPrice(slPrice)} (-{slPct}%)</span>
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
                  <span className="mono" style={{ color: '#f0b90b' }}>30% → $FRONT</span>
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
