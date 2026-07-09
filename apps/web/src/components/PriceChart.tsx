import { type FC, useState, useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  type IPriceLine,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
} from 'lightweight-charts';
import { fetchOHLCV, BirdeyePriceStream, type OHLCVBar, type StreamStatus } from '../lib/birdeye';
import { getVar, onThemeChange } from '../lib/theme';

/** Map our interval keys to Birdeye WS chartType */
const WS_CHART_TYPE: Record<string, string> = {
  '1S': '1s', '5S': '5s', '15S': '15s', '30S': '30s',
  '1': '1m', '3': '3m', '5': '5m', '15': '15m',
  '30': '30m', '60': '1H', '240': '4H', 'D': '1D',
};

/** Position data for chart annotations */
export interface ChartPosition {
  entryPrice: number;
  liquidationPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  side: 'long';
  leverage: number;
  pnlPercent?: number;
}

interface PriceChartProps {
  tokenAddress?: string;
  positions?: ChartPosition[];
  supply?: number;
  /** Fires with every live price (stream tick or initial load) so the
   *  parent can run live PnL — throttled to at most ~2/s */
  onPrice?: (price: number) => void;
}

const TIMEFRAMES = ['1S', '5S', '15S', '30S', '1', '3', '5', '15', '30', '60', '240', 'D'] as const;
const TIMEFRAME_LABELS: Record<string, string> = {
  '1S': '1s', '5S': '5s', '15S': '15s', '30S': '30s',
  '1': '1m', '3': '3m', '5': '5m', '15': '15m',
  '30': '30m', '60': '1H', '240': '4H', 'D': 'D',
};

/** Duration in seconds for each interval */
const INTERVAL_SECS: Record<string, number> = {
  '1S': 1, '5S': 5, '15S': 15, '30S': 30,
  '1': 60, '3': 180, '5': 300, '15': 900,
  '30': 1800, '60': 3600, '240': 14400, 'D': 86400,
};

const fmtCompact = (v: number): string => {
  // 4 significant digits so tight ranges still get distinct axis ticks
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toPrecision(4)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toPrecision(4)}M`;
  if (v >= 1_000) return `${(v / 1_000).toPrecision(4)}K`;
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toPrecision(4);
};

/**
 * Terminal trading chart — lightweight-charts + Birdeye.
 * Hardened: sanitized data, per-switch resets, honest empty/error
 * states, truthful stream badge, PRICE/MCAP unit toggle, theme-aware.
 */
export const PriceChart: FC<PriceChartProps> = ({ tokenAddress, positions, supply, onPrice }) => {
  const supplyRef = useRef(supply ?? 0);
  useEffect(() => { supplyRef.current = supply ?? 0; }, [supply]);

  const onPriceRef = useRef(onPrice);
  useEffect(() => { onPriceRef.current = onPrice; }, [onPrice]);
  const lastEmitRef = useRef(0);
  const emitPrice = (price: number) => {
    const now = Date.now();
    if (now - lastEmitRef.current < 500) return;
    lastEmitRef.current = now;
    onPriceRef.current?.(price);
  };

  const [interval, setInterval_] = useState('1');
  const [source, setSource] = useState<'birdeye-live' | 'birdeye-embed'>(
    () => (import.meta.env.VITE_BIRDEYE_API_KEY ? 'birdeye-live' : 'birdeye-embed'),
  );
  const [loading, setLoading] = useState(false);
  const [dataState, setDataState] = useState<'ok' | 'empty' | 'error'>('ok');
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [unit, setUnit] = useState<'mcap' | 'price'>('mcap');
  const [themeTick, setThemeTick] = useState(0);
  const [retryTick, setRetryTick] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const streamRef = useRef<BirdeyePriceStream | null>(null);
  const currentBarRef = useRef<OHLCVBar | null>(null);
  const barsRef = useRef<OHLCVBar[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const unitRef = useRef(unit);
  useEffect(() => { unitRef.current = unit; }, [unit]);

  const hasBirdeyeKey = !!import.meta.env.VITE_BIRDEYE_API_KEY;

  /** Axis multiplier: mcap mode multiplies price by supply (pump.fun style) */
  const mult = () => (unitRef.current === 'mcap' && supplyRef.current > 0 ? supplyRef.current : 1);

  useEffect(() => onThemeChange(() => setThemeTick((v) => v + 1)), []);

  /** Initialize chart (rebuilt on theme change so every color re-tints) */
  useEffect(() => {
    if (!containerRef.current) return;

    const P = {
      primary: getVar('--primary') || '#00c805',
      primaryRgb: getVar('--primary-rgb') || '0, 200, 5',
      bg: getVar('--bg-0') || '#060807',
      text: getVar('--text-2') || '#5c6b60',
      grid: '#0d1420',
      border: '#141c16',
    };

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: P.bg },
        textColor: P.text,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: P.grid },
        horzLines: { color: P.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: `rgba(${P.primaryRgb}, 0.25)`, width: 1, style: 2, labelBackgroundColor: P.primary },
        horzLine: { color: `rgba(${P.primaryRgb}, 0.25)`, width: 1, style: 2, labelBackgroundColor: P.primary },
      },
      rightPriceScale: {
        borderColor: P.border,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: P.border,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00c805',
      downColor: '#ff4d4d',
      borderUpColor: '#00c805',
      borderDownColor: '#ff4d4d',
      wickUpColor: '#00c80580',
      wickDownColor: '#ff4d4d80',
      priceFormat: { type: 'custom', formatter: fmtCompact },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Resize handler
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
      }
    });
    resizeObserver.observe(containerRef.current);

    // Fix chart freeze when switching tabs
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && chartRef.current && containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        chartRef.current.applyOptions({ width, height });
        chartRef.current.timeScale().fitContent();
        requestAnimationFrame(() => {
          if (chartRef.current && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            chartRef.current.applyOptions({ width: rect.width, height: rect.height });
            chartRef.current.timeScale().scrollToRealTime();
          }
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, [themeTick]);

  /** Draw position price lines (re-tinted on theme, re-scaled on unit) */
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    for (const line of priceLinesRef.current) {
      try { candleSeries.removePriceLine(line); } catch { /* ignore */ }
    }
    priceLinesRef.current = [];

    if (!positions || positions.length === 0) return;

    const m = mult();
    const primary = getVar('--primary') || '#00c805';

    for (const pos of positions) {
      const mk = (price: number, color: string, style: LineStyle, title: string) => {
        if (!(price > 0)) return;
        priceLinesRef.current.push(candleSeries.createPriceLine({
          price: price * m,
          color,
          lineWidth: 1,
          lineStyle: style,
          axisLabelVisible: true,
          title,
        }));
      };
      const pnlTag = pos.pnlPercent != null
        ? ` ${pos.pnlPercent >= 0 ? '+' : ''}${pos.pnlPercent.toFixed(1)}%`
        : '';
      mk(pos.entryPrice, primary, LineStyle.Dashed, `ENTRY${pnlTag}`);
      mk(pos.liquidationPrice, '#ff4d4d', LineStyle.Solid, 'LIQ');
      mk(pos.takeProfitPrice ?? 0, '#00c805', LineStyle.Dashed, 'TP');
      mk(pos.stopLossPrice ?? 0, '#b8ff5e', LineStyle.Dashed, 'SL');
    }
  }, [positions, unit, themeTick, supply]);

  /** Load data and start streaming */
  useEffect(() => {
    if (!tokenAddress || source !== 'birdeye-live' || !hasBirdeyeKey) return;

    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    let cancelled = false;
    const intervalSecs = INTERVAL_SECS[interval] || 60;

    // Hard reset — never show the previous token/interval while loading
    candleSeries.setData([]);
    volumeSeries.setData([]);
    barsRef.current = [];
    currentBarRef.current = null;
    setLastPrice(null);
    setPriceChange(0);
    setDataState('ok');
    setLoading(true);

    const applyBars = (bars: OHLCVBar[]) => {
      const m = mult();
      candleSeries.setData(bars.map((b) => ({
        time: b.time as Time,
        open: b.open * m,
        high: b.high * m,
        low: b.low * m,
        close: b.close * m,
      })) as CandlestickData[]);
      volumeSeries.setData(bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: b.close >= b.open ? '#00c80520' : '#ff4d4d20',
      })) as HistogramData[]);
    };

    const loadData = async () => {
      try {
        const bars = await fetchOHLCV(tokenAddress, interval, 300);
        if (cancelled) return;

        if (bars.length === 0) {
          setDataState('empty');
          setLoading(false);
          return;
        }

        barsRef.current = bars;
        applyBars(bars);

        const lastBar = bars[bars.length - 1];
        currentBarRef.current = { ...lastBar };
        setLastPrice(lastBar.close);
        emitPrice(lastBar.close);

        if (bars.length > 1) {
          setPriceChange(((lastBar.close - bars[0].open) / bars[0].open) * 100);
        }

        chartRef.current?.timeScale().fitContent();
        setTimeout(() => {
          if (cancelled) return;
          chartRef.current?.timeScale().fitContent();
          chartRef.current?.timeScale().scrollToRealTime();
        }, 100);
        setDataState('ok');
      } catch {
        if (!cancelled) setDataState('error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();

    // Real-time stream with truthful status
    const stream = new BirdeyePriceStream(
      tokenAddress,
      WS_CHART_TYPE[interval] || '1m',
      (price, timestamp, serverBar) => {
        if (cancelled || !(price > 0)) return;

        setLastPrice(price);
        emitPrice(price);

        const current = currentBarRef.current;
        if (!current) return; // no baseline bars yet — don't invent candles

        const barStart = Math.floor(timestamp / intervalSecs) * intervalSecs;
        const currentBarStart = Math.floor(current.time / intervalSecs) * intervalSecs;

        // Drop stale/out-of-order ticks — lightweight-charts rejects
        // updates older than the last bar and corrupts the series
        if (barStart < currentBarStart) return;

        if (serverBar) {
          // Birdeye pushes the authoritative OHLCV bar for this
          // interval on every trade — adopt it wholesale (real
          // wicks + real volume, not client reconstruction)
          const adopted: OHLCVBar = {
            time: barStart,
            open: serverBar.o,
            high: serverBar.h,
            low: serverBar.l,
            close: serverBar.c,
            volume: serverBar.v,
          };
          currentBarRef.current = adopted;
          const bars = barsRef.current;
          if (bars.length > 0 && bars[bars.length - 1].time === barStart) {
            bars[bars.length - 1] = adopted;
          } else {
            bars.push(adopted);
          }
        } else if (barStart > currentBarStart) {
          const newBar: OHLCVBar = {
            time: barStart, open: price, high: price, low: price, close: price, volume: 0,
          };
          currentBarRef.current = newBar;
          barsRef.current.push(newBar);
        } else {
          current.high = Math.max(current.high, price);
          current.low = Math.min(current.low, price);
          current.close = price;
        }

        const bar = currentBarRef.current!;
        const m = mult();
        try {
          candleSeries.update({
            time: bar.time as Time,
            open: bar.open * m,
            high: bar.high * m,
            low: bar.low * m,
            close: bar.close * m,
          });
          volumeSeries.update({
            time: bar.time as Time,
            value: bar.volume,
            color: bar.close >= bar.open ? '#00c80520' : '#ff4d4d20',
          });
        } catch { /* series replaced mid-tick — safe to drop */ }

        const bars = barsRef.current;
        if (bars.length > 0) {
          setPriceChange(((price - bars[0].open) / bars[0].open) * 100);
        }
      },
      (status) => { if (!cancelled) setStreamStatus(status); },
    );

    stream.connect();
    streamRef.current = stream;

    return () => {
      cancelled = true;
      stream.disconnect();
      streamRef.current = null;
    };
    // `supply` dep: candles often load before token overview resolves —
    // when supply lands, reload once so axis units match the MC readout
  }, [tokenAddress, interval, source, hasBirdeyeKey, unit, themeTick, retryTick, supply]);

  // Embed URL fallback
  const embedUrl = tokenAddress
    ? `https://birdeye.so/tv-widget/${tokenAddress}?chain=solana&viewMode=pair&chartInterval=${interval}&chartType=Candle&chartLeftToolbar=show&theme=dark`
    : null;

  const showLiveChart = source === 'birdeye-live' && hasBirdeyeKey;
  const hasMcap = (supply ?? 0) > 0;
  const streamBadge: Record<StreamStatus, { label: string; color: string }> = {
    connecting: { label: 'SYNC', color: 'var(--yellow)' },
    ws: { label: 'LIVE', color: 'var(--green)' },
    polling: { label: 'POLL', color: 'var(--yellow)' },
    dead: { label: 'STALE', color: 'var(--red)' },
  };
  const badge = streamBadge[streamStatus];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '4px 8px',
        borderBottom: '1px solid #141c16',
        background: '#080a08',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setInterval_(tf)}
            style={{
              padding: '3px 7px',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              color: interval === tf ? 'var(--primary)' : '#3d4d40',
              background: interval === tf ? 'rgba(var(--primary-rgb),0.07)' : 'transparent',
              border: '1px solid',
              borderColor: interval === tf ? 'rgba(var(--primary-rgb),0.15)' : 'transparent',
              borderRadius: 0,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {TIMEFRAME_LABELS[tf]}
          </button>
        ))}

        {/* Unit toggle — axis in market cap or token price */}
        {hasMcap && showLiveChart && (
          <div style={{ display: 'flex', marginLeft: 8, border: '1px solid #1c261f' }}>
            {(['mcap', 'price'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                style={{
                  padding: '2px 8px',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: unit === u ? '#0a0a08' : '#5c6b60',
                  background: unit === u ? 'var(--primary)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {u === 'mcap' ? 'MC' : 'PX'}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Live readout — same unit as the axis */}
        {lastPrice != null && showLiveChart && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8, whiteSpace: 'nowrap' }}>
            <span style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#eef3ef',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {unit === 'mcap' && hasMcap
                ? `MC $${fmtCompact(lastPrice * (supply ?? 0))}`
                : `$${lastPrice.toPrecision(6)}`}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              color: priceChange >= 0 ? '#00c805' : '#ff4d4d',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Stream + source */}
        <div style={{ display: 'flex', gap: 1, background: '#0a0e0b', borderRadius: 0, padding: 1 }}>
          {hasBirdeyeKey && (
            <button
              onClick={() => setSource('birdeye-live')}
              title={`Feed: ${badge.label}`}
              style={{
                padding: '2px 8px',
                fontSize: 9,
                fontWeight: 600,
                color: source === 'birdeye-live' ? badge.color : '#2a3d2e',
                background: source === 'birdeye-live' ? '#141c16' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <span style={{
                width: 4, height: 4, borderRadius: '50%',
                background: source === 'birdeye-live' ? badge.color : '#2a3d2e',
              }} />
              {source === 'birdeye-live' ? badge.label : 'Live'}
            </button>
          )}
          <button
            onClick={() => setSource('birdeye-embed')}
            style={{
              padding: '2px 8px',
              fontSize: 9,
              fontWeight: 600,
              color: source === 'birdeye-embed' ? 'var(--primary)' : '#2a3d2e',
              background: source === 'birdeye-embed' ? '#141c16' : 'transparent',
              border: 'none',
              borderRadius: 0,
              cursor: 'pointer',
            }}
          >
            Embed
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative', background: '#060807', minHeight: 0 }}>
        {loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#000000cc',
            zIndex: 10,
          }}>
            <div style={{
              width: 20,
              height: 20,
              border: '2px solid #1c261f',
              borderTopColor: 'var(--primary)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
          </div>
        )}

        {/* Live chart (lightweight-charts) */}
        {showLiveChart && (
          <div
            ref={containerRef}
            style={{
              position: 'absolute',
              inset: 0,
              display: source === 'birdeye-live' ? 'block' : 'none',
            }}
          />
        )}

        {/* Honest empty / error states */}
        {showLiveChart && tokenAddress && !loading && dataState !== 'ok' && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            zIndex: 5,
            background: '#060807',
          }}>
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.3em',
              color: dataState === 'error' ? '#ff4d4d' : '#5c6b60',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {dataState === 'error' ? '[ FEED ERROR ]' : `[ NO ${TIMEFRAME_LABELS[interval].toUpperCase()} CANDLES ]`}
            </span>
            <span style={{ fontSize: 11, color: '#5c6b60' }}>
              {dataState === 'error'
                ? 'Candle feed unreachable — retry or switch source'
                : 'This token has no trades at this resolution'}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {dataState === 'empty' && interval !== '60' && (
                <button className="btn btn-outline btn-sm" onClick={() => setInterval_('60')}>
                  SWITCH TO 1H
                </button>
              )}
              <button className="btn btn-outline btn-sm" onClick={() => setRetryTick((v) => v + 1)}>
                RETRY
              </button>
            </div>
          </div>
        )}

        {/* Embed fallback */}
        {source === 'birdeye-embed' && embedUrl && (
          <iframe
            key={embedUrl}
            src={embedUrl}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
            }}
            title="Price Chart"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        )}

        {/* No token selected */}
        {!tokenAddress && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 8,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2a3d2e" strokeWidth="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span style={{ fontSize: 13, color: '#5c6b60', fontWeight: 500 }}>Select a token to load chart</span>
            <span style={{ fontSize: 11, color: '#2a3d2e' }}>Pick from the ticker bar or use Cmd+K</span>
          </div>
        )}

        {/* No API key warning */}
        {tokenAddress && !hasBirdeyeKey && source === 'birdeye-live' && (
          <div style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            padding: '8px 12px',
            background: '#1c261f',
            border: '1px solid #2a3d2e',
            borderRadius: 0,
            fontSize: 11,
            color: '#93a89a',
            zIndex: 5,
          }}>
            Add VITE_BIRDEYE_API_KEY to .env for live 1s charts
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
