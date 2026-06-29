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
import { fetchOHLCV, BirdeyePriceStream, type OHLCVBar } from '../lib/birdeye';

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

/**
 * Production-grade TradingView chart powered by lightweight-charts + Birdeye API.
 * Supports 1-second to daily candles with real-time WebSocket streaming.
 * Draws entry, liquidation, TP, and SL price lines for active positions.
 */
export const PriceChart: FC<PriceChartProps> = ({ tokenAddress, positions }) => {
  const [interval, setInterval_] = useState('1');
  const [source, setSource] = useState<'birdeye-live' | 'birdeye-embed'>('birdeye-live');
  const [loading, setLoading] = useState(false);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const streamRef = useRef<BirdeyePriceStream | null>(null);
  const currentBarRef = useRef<OHLCVBar | null>(null);
  const barsRef = useRef<OHLCVBar[]>([]);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const hasBirdeyeKey = !!import.meta.env.VITE_BIRDEYE_API_KEY;

  /** Initialize chart */
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#555',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: '#0d0d0d' },
        horzLines: { color: '#0d0d0d' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#f0b90b40', width: 1, style: 2, labelBackgroundColor: '#f0b90b' },
        horzLine: { color: '#f0b90b40', width: 1, style: 2, labelBackgroundColor: '#f0b90b' },
      },
      rightPriceScale: {
        borderColor: '#111',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: '#111',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 5,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00c853',
      downColor: '#ff3b3b',
      borderUpColor: '#00c853',
      borderDownColor: '#ff3b3b',
      wickUpColor: '#00c85380',
      wickDownColor: '#ff3b3b80',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
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

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = [];
    };
  }, []);

  /** Draw position price lines */
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries) return;

    // Remove old lines
    for (const line of priceLinesRef.current) {
      try { candleSeries.removePriceLine(line); } catch { /* ignore */ }
    }
    priceLinesRef.current = [];

    if (!positions || positions.length === 0) return;

    for (const pos of positions) {
      // Entry price line — gold dashed
      if (pos.entryPrice > 0) {
        const entryLine = candleSeries.createPriceLine({
          price: pos.entryPrice,
          color: '#f0b90b',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `ENTRY`,
        });
        priceLinesRef.current.push(entryLine);
      }

      // Liquidation price line — red solid
      if (pos.liquidationPrice > 0) {
        const liqLine = candleSeries.createPriceLine({
          price: pos.liquidationPrice,
          color: '#ff3b3b',
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `LIQ`,
        });
        priceLinesRef.current.push(liqLine);
      }

      // Take profit line — green dashed
      if (pos.takeProfitPrice && pos.takeProfitPrice > 0) {
        const tpLine = candleSeries.createPriceLine({
          price: pos.takeProfitPrice,
          color: '#00c853',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `TP`,
        });
        priceLinesRef.current.push(tpLine);
      }

      // Stop loss line — orange dashed
      if (pos.stopLossPrice && pos.stopLossPrice > 0) {
        const slLine = candleSeries.createPriceLine({
          price: pos.stopLossPrice,
          color: '#ff6d00',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: `SL`,
        });
        priceLinesRef.current.push(slLine);
      }
    }
  }, [positions]);

  /** Load data and start streaming */
  useEffect(() => {
    if (!tokenAddress || source !== 'birdeye-live' || !hasBirdeyeKey) return;

    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;

    let cancelled = false;

    const loadData = async () => {
      setLoading(true);

      const bars = await fetchOHLCV(tokenAddress, interval, 300);
      if (cancelled || bars.length === 0) {
        setLoading(false);
        return;
      }

      barsRef.current = bars;

      // Set candle data
      const candleData: CandlestickData[] = bars.map((b) => ({
        time: b.time as Time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }));

      const volumeData: HistogramData[] = bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: b.close >= b.open ? '#00c85320' : '#ff3b3b20',
      }));

      candleSeries.setData(candleData);
      volumeSeries.setData(volumeData);

      // Track last bar for real-time updates
      const lastBar = bars[bars.length - 1];
      currentBarRef.current = { ...lastBar };
      setLastPrice(lastBar.close);

      // Calculate price change
      if (bars.length > 1) {
        const firstBar = bars[0];
        const change = ((lastBar.close - firstBar.open) / firstBar.open) * 100;
        setPriceChange(change);
      }

      // Fit content
      chartRef.current?.timeScale().fitContent();
      setLoading(false);
    };

    loadData();

    // Start real-time stream
    const intervalSecs = INTERVAL_SECS[interval] || 60;

    const stream = new BirdeyePriceStream(
      tokenAddress,
      WS_CHART_TYPE[interval] || '1m',
      (price, timestamp) => {
      if (cancelled) return;

      setLastPrice(price);

      const current = currentBarRef.current;
      if (!current) return;

      // Check if this price belongs to the current bar or a new bar
      const barStart = Math.floor(timestamp / intervalSecs) * intervalSecs;
      const currentBarStart = Math.floor(current.time / intervalSecs) * intervalSecs;

      if (barStart > currentBarStart) {
        // New bar
        const newBar: OHLCVBar = {
          time: barStart,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
        };
        currentBarRef.current = newBar;
        barsRef.current.push(newBar);
      } else {
        // Update current bar
        current.high = Math.max(current.high, price);
        current.low = Math.min(current.low, price);
        current.close = price;
      }

      const bar = currentBarRef.current!;

      // Update chart
      candleSeries.update({
        time: bar.time as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });

      volumeSeries.update({
        time: bar.time as Time,
        value: bar.volume,
        color: bar.close >= bar.open ? '#00c85320' : '#ff3b3b20',
      });

      // Update price change
      const bars = barsRef.current;
      if (bars.length > 0) {
        const firstBar = bars[0];
        const change = ((price - firstBar.open) / firstBar.open) * 100;
        setPriceChange(change);
      }
    });

    stream.connect();
    streamRef.current = stream;

    return () => {
      cancelled = true;
      stream.disconnect();
      streamRef.current = null;
    };
  }, [tokenAddress, interval, source, hasBirdeyeKey]);

  // Embed URL fallback
  const embedUrl = tokenAddress
    ? `https://birdeye.so/tv-widget/${tokenAddress}?chain=solana&viewMode=pair&chartInterval=${interval}&chartType=Candle&chartLeftToolbar=show&theme=dark`
    : null;

  const showLiveChart = source === 'birdeye-live' && hasBirdeyeKey;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: '4px 8px',
        borderBottom: '1px solid #111',
        background: '#050505',
        flexShrink: 0,
      }}>
        {/* Timeframes */}
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setInterval_(tf)}
            style={{
              padding: '3px 7px',
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              color: interval === tf ? '#f0b90b' : '#444',
              background: interval === tf ? '#f0b90b10' : 'transparent',
              border: '1px solid',
              borderColor: interval === tf ? '#f0b90b25' : 'transparent',
              borderRadius: 3,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {TIMEFRAME_LABELS[tf]}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Live price indicator */}
        {lastPrice && showLiveChart && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginRight: 8,
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#00c853',
              animation: 'pulse-dot 2s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              ${lastPrice.toPrecision(6)}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              color: priceChange >= 0 ? '#00c853' : '#ff3b3b',
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
        )}

        {/* Source toggle */}
        <div style={{ display: 'flex', gap: 1, background: '#0a0a0a', borderRadius: 3, padding: 1 }}>
          {hasBirdeyeKey && (
            <button
              onClick={() => setSource('birdeye-live')}
              style={{
                padding: '2px 8px',
                fontSize: 9,
                fontWeight: 600,
                color: source === 'birdeye-live' ? '#00c853' : '#333',
                background: source === 'birdeye-live' ? '#111' : 'transparent',
                border: 'none',
                borderRadius: 2,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              <span style={{
                width: 4, height: 4, borderRadius: '50%',
                background: source === 'birdeye-live' ? '#00c853' : '#333',
              }} />
              Live
            </button>
          )}
          <button
            onClick={() => setSource('birdeye-embed')}
            style={{
              padding: '2px 8px',
              fontSize: 9,
              fontWeight: 600,
              color: source === 'birdeye-embed' ? '#f0b90b' : '#333',
              background: source === 'birdeye-embed' ? '#111' : 'transparent',
              border: 'none',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Embed
          </button>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative', background: '#000', minHeight: 0 }}>
        {/* Loading overlay */}
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
              border: '2px solid #222',
              borderTopColor: '#f0b90b',
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span style={{ fontSize: 13, color: '#555', fontWeight: 500 }}>Select a token to load chart</span>
            <span style={{ fontSize: 11, color: '#333' }}>Pick from the ticker bar or use Cmd+K</span>
          </div>
        )}

        {/* No API key warning */}
        {tokenAddress && !hasBirdeyeKey && source === 'birdeye-live' && (
          <div style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            padding: '8px 12px',
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 6,
            fontSize: 11,
            color: '#888',
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
