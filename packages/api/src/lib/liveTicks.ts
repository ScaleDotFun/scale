// ──────────────────────────────────────────────
// SCALE PROTOCOL — on-chain live tick engine (Robinhood Chain)
//
// Memecoin traders live on seconds-charts, and no aggregator serves
// sub-minute candles for Robinhood Chain — so we read the truth
// directly: Uniswap V3 Swap events from the token's pool, decoded to
// USD via sqrtPriceX96 × ETH/USD, aggregated into 1-second buckets in
// memory. An AMM's price only moves on swaps, so between trades the
// last pool price IS the live price — no interpolation, no fakery.
//
// Watchers spin up on demand per pool, poll logs every ~1.2s, and
// self-expire after 90s without a reader.
// ──────────────────────────────────────────────

import { parseAbiItem, type Address } from 'viem';
import { getPublicClient, CONTRACTS, erc20Decimals } from '@front-protocol/evm';
import { fetchEthUsd } from './geckoterminal';

const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
);

const POOL_ABI = [
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function', name: 'slot0', stateMutability: 'view', inputs: [],
    outputs: [
      { type: 'uint160', name: 'sqrtPriceX96' }, { type: 'int24', name: 'tick' },
      { type: 'uint16', name: 'observationIndex' }, { type: 'uint16', name: 'observationCardinality' },
      { type: 'uint16', name: 'observationCardinalityNext' }, { type: 'uint8', name: 'feeProtocol' },
      { type: 'bool', name: 'unlocked' },
    ],
  },
] as const;

export interface LiveCandle {
  timestamp: number; // unix seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD
}

interface Watcher {
  pool: Address;
  tokenIsToken0: boolean;
  decToken: number;
  decWeth: number;
  /** 1-second buckets, ascending, trades only */
  candles: LiveCandle[];
  lastPriceUsd: number;
  lastBlock: bigint;
  lastAccess: number;
  timer: ReturnType<typeof setInterval> | null;
  ready: Promise<void>;
}

const watchers = new Map<string, Watcher>();
const blockTsCache = new Map<string, number>();

const POLL_MS = 1_200;
const IDLE_EXPIRE_MS = 90_000;
const MAX_BUCKETS = 3_600; // 1h of 1s candles per pool
const SEED_BLOCKS = 6_000n; // ~10 min at 0.1s blocks

function sqrtToWethPerToken(sqrtPriceX96: bigint, tokenIsToken0: boolean, decToken: number, decWeth: number): number {
  const s = Number(sqrtPriceX96) / 2 ** 96;
  const p1per0 = s * s; // token1 per token0, raw units
  // adjust raw → human using decimals, then orient to WETH-per-token
  const human1per0 = p1per0 * Math.pow(10, tokenIsToken0 ? decToken - decWeth : decWeth - decToken);
  return tokenIsToken0 ? human1per0 : 1 / human1per0;
}

async function blockTimestamp(blockNumber: bigint): Promise<number> {
  const key = blockNumber.toString();
  const hit = blockTsCache.get(key);
  if (hit) return hit;
  const block = await getPublicClient().getBlock({ blockNumber });
  const ts = Number(block.timestamp);
  blockTsCache.set(key, ts);
  if (blockTsCache.size > 5_000) {
    for (const k of Array.from(blockTsCache.keys()).slice(0, 1_000)) blockTsCache.delete(k);
  }
  return ts;
}

/** Fold a decoded swap into the watcher's 1s candle buffer. */
function foldSwap(w: Watcher, ts: number, priceUsd: number, volumeUsd: number): void {
  w.lastPriceUsd = priceUsd;
  const last = w.candles[w.candles.length - 1];
  if (last && last.timestamp === ts) {
    last.high = Math.max(last.high, priceUsd);
    last.low = Math.min(last.low, priceUsd);
    last.close = priceUsd;
    last.volume += volumeUsd;
  } else if (!last || ts > last.timestamp) {
    // open at previous close so candles chain like a real tape
    const open = last ? last.close : priceUsd;
    w.candles.push({
      timestamp: ts,
      open,
      high: Math.max(open, priceUsd),
      low: Math.min(open, priceUsd),
      close: priceUsd,
      volume: volumeUsd,
    });
    if (w.candles.length > MAX_BUCKETS) w.candles.splice(0, w.candles.length - MAX_BUCKETS);
  }
  // out-of-order (older than last bucket) swaps are dropped — the seed
  // pass processes logs in order, so this only loses sub-second races
}

async function ingestLogs(w: Watcher, fromBlock: bigint, toBlock: bigint, ethUsd: number): Promise<void> {
  const logs = await getPublicClient().getLogs({
    address: w.pool,
    event: SWAP_EVENT,
    fromBlock,
    toBlock,
  });
  for (const log of logs) {
    const ts = await blockTimestamp(log.blockNumber);
    const wethPerToken = sqrtToWethPerToken(log.args.sqrtPriceX96!, w.tokenIsToken0, w.decToken, w.decWeth);
    const priceUsd = wethPerToken * ethUsd;
    const wethAmount = w.tokenIsToken0 ? log.args.amount1! : log.args.amount0!;
    const volumeUsd = (Math.abs(Number(wethAmount)) / 10 ** w.decWeth) * ethUsd;
    if (Number.isFinite(priceUsd) && priceUsd > 0) foldSwap(w, ts, priceUsd, volumeUsd);
  }
  w.lastBlock = toBlock;
}

async function initWatcher(w: Watcher, token: string): Promise<void> {
  const client = getPublicClient();
  const [token0, latest, ethUsd] = await Promise.all([
    client.readContract({ address: w.pool, abi: POOL_ABI, functionName: 'token0' }),
    client.getBlockNumber(),
    fetchEthUsd(),
  ]);
  w.tokenIsToken0 = (token0 as string).toLowerCase() === token.toLowerCase();
  const wethAddr = CONTRACTS.WETH.toLowerCase();
  // sanity: one side must be WETH (Noxa pools always are)
  const [decToken, decWeth] = await Promise.all([
    erc20Decimals(token),
    erc20Decimals(wethAddr),
  ]);
  w.decToken = decToken;
  w.decWeth = decWeth;

  // current pool price even if nothing trades (slot0 is live AMM state)
  const slot0 = await client.readContract({ address: w.pool, abi: POOL_ABI, functionName: 'slot0' });
  const spotWeth = sqrtToWethPerToken(slot0[0], w.tokenIsToken0, decToken, decWeth);
  if (ethUsd > 0) w.lastPriceUsd = spotWeth * ethUsd;

  // seed history from recent blocks
  const from = latest > SEED_BLOCKS ? latest - SEED_BLOCKS : 0n;
  await ingestLogs(w, from, latest, ethUsd || 1);

  w.timer = setInterval(async () => {
    try {
      if (Date.now() - w.lastAccess > IDLE_EXPIRE_MS) {
        if (w.timer) clearInterval(w.timer);
        watchers.delete(w.pool.toLowerCase());
        return;
      }
      const [tip, usd] = await Promise.all([client.getBlockNumber(), fetchEthUsd()]);
      if (tip > w.lastBlock) await ingestLogs(w, w.lastBlock + 1n, tip, usd || 1);
    } catch (err) {
      // transient RPC hiccup — next tick retries; watcher keeps last state
      console.warn('[liveTicks] poll failed:', err instanceof Error ? err.message.slice(0, 120) : err);
    }
  }, POLL_MS);
  w.timer.unref?.();
}

/** Get (or start) the live watcher for a token's pool. */
export async function watchPool(pool: string, token: string): Promise<Watcher> {
  const key = pool.toLowerCase();
  let w = watchers.get(key);
  if (!w) {
    w = {
      pool: pool as Address,
      tokenIsToken0: true,
      decToken: 18,
      decWeth: 18,
      candles: [],
      lastPriceUsd: 0,
      lastBlock: 0n,
      lastAccess: Date.now(),
      timer: null,
      ready: Promise.resolve(),
    };
    watchers.set(key, w);
    w.ready = initWatcher(w, token).catch((err) => {
      watchers.delete(key);
      throw err;
    });
  }
  w.lastAccess = Date.now();
  await w.ready;
  return w;
}

/**
 * Aggregated candles for a timeframe (1/5/15 seconds), ascending.
 * The current bucket always exists at the live pool price so charts
 * tick forward in real time — that price is real AMM state, not fill.
 */
export function liveCandles(w: Watcher, tfSec: number, limit = 300): { candles: LiveCandle[]; last: number } {
  const byBucket = new Map<number, LiveCandle>();
  for (const c of w.candles) {
    const bucket = Math.floor(c.timestamp / tfSec) * tfSec;
    const agg = byBucket.get(bucket);
    if (!agg) {
      byBucket.set(bucket, { ...c, timestamp: bucket });
    } else {
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close;
      agg.volume += c.volume;
    }
  }
  const out = Array.from(byBucket.values()).sort((a, b) => a.timestamp - b.timestamp);

  // live current bucket (chains from previous close; real spot price)
  if (w.lastPriceUsd > 0) {
    const nowBucket = Math.floor(Date.now() / 1000 / tfSec) * tfSec;
    const tail = out[out.length - 1];
    if (!tail || tail.timestamp < nowBucket) {
      const open = tail ? tail.close : w.lastPriceUsd;
      out.push({
        timestamp: nowBucket,
        open,
        high: Math.max(open, w.lastPriceUsd),
        low: Math.min(open, w.lastPriceUsd),
        close: w.lastPriceUsd,
        volume: 0,
      });
    }
  }
  return { candles: out.slice(-limit), last: w.lastPriceUsd };
}
