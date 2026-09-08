// VITE_API_URL can be the server origin ("http://localhost:4001") or already
// include /api ("http://localhost:4001/api"). We normalize both to end at /api.
// In dev, the Vite proxy forwards /api/* to the backend, so the fallback is '/api'.
const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
  : '/api';

const TOKEN_KEY = 'loaded_token';
const DEVICE_KEY = 'loaded_did';

/**
 * Stable per-device id for sybil resistance. Persisted in localStorage
 * and mirrored to the `loaded_did` cookie so it also rides the top-level
 * Google OAuth navigation (which can't carry custom headers).
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
      localStorage.setItem(DEVICE_KEY, id);
    }
    // 1-year cookie, same-site so it's sent on the /api/auth/google redirect
    document.cookie = `${DEVICE_KEY}=${id}; path=/; max-age=31536000; SameSite=Lax`;
    return id;
  } catch {
    return '';
  }
}

/** Get stored auth token */
export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Store auth token */
export function setAuthToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage unavailable
  }
}

/** Clear auth token */
export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage unavailable
  }
}

/** Core fetch wrapper with auth and error handling */
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-device-id': getDeviceId(),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, response.statusText, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json();
  // API wraps responses as { success, data }. Unwrap if present.
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json as T;
}

/** API error with status code */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown,
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

// ── Auth ──

export interface AuthLoginResponse {
  token: string;
  user: {
    id: number;
    email: string;
    walletAddress: string;
  };
}

export interface AuthMeResponse {
  id: number;
  email: string;
  walletAddress: string;
}

export function login(email: string, password: string): Promise<AuthLoginResponse> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function register(email: string, password: string, referralCode?: string): Promise<AuthLoginResponse> {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, ...(referralCode ? { referralCode } : {}) }),
  });
}

// ── Points & referrals ──────────────────────────────────────
export interface PointsMe {
  totalPoints: string;
  rank: number | null;
  breakdown: Record<string, string>;
  referralCode: string;
  referralCount: number;
  pointsPerEth: string;
  referralBonusPct: number;
}

export interface LeaderboardRow {
  rank: number;
  wallet: string;
  display: string;
  points: string;
}

export function getPointsMe(): Promise<PointsMe> {
  return request('/points/me');
}

export function getLeaderboard(limit = 25): Promise<{ totalWallets: number; leaderboard: LeaderboardRow[] }> {
  return request(`/points/leaderboard?limit=${limit}`);
}

export function getMe(): Promise<AuthMeResponse> {
  return request('/auth/me');
}

// ── Tokens ──

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  imageUri?: string;
  tier: string;
  tierEmoji?: string;
  tierLabel?: string;
  creatorWallet?: string;
  isActive?: boolean;
  maxLeverage?: number;
  flatFeePct?: number;
  exitThresholdPct?: number;
  /** The threshold the protocol ACTUALLY closes at: exitThresholdPct plus the
   *  5% safety buffer shouldAutoClose applies before comparing. */
  liquidationThresholdPct?: number;
  volume24h?: string;
  trades24h?: number;
  totalTradingVolume?: string;
  totalCreatorPayouts?: string;
  listedAt?: string;
  // Price fields (may be undefined if not available)
  priceUsd?: number;
  priceEth?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  volume24hUsd?: number;
  priceChange24hPct?: number;
  isBonded?: boolean;
}

export function searchTokens(query: string): Promise<TokenInfo[]> {
  return request(`/tokens/search?q=${encodeURIComponent(query)}`);
}

export function getTrendingTokens(): Promise<TokenInfo[]> {
  return request('/tokens/trending');
}

export function getTokenDetails(address: string): Promise<TokenInfo> {
  return request(`/tokens/${address}`);
}

export function getListedTokens(limit?: number, includeDelisted = false): Promise<TokenInfo[]> {
  // Default active=true keeps delisted coins out of the command palette and
  // trade pickers — you should never be able to pick a dead coin to trade.
  // The Explorer opts in via includeDelisted so the full history stays
  // browsable (delisted rows render dimmed with a DELISTED badge).
  const parts = [includeDelisted ? '' : 'active=true', limit ? `limit=${limit}` : '']
    .filter(Boolean)
    .join('&');
  return request(`/tokens/listed${parts ? `?${parts}` : ''}`);
}

// ── Wallet ──

export interface WalletBalance {
  address: string;
  balanceWei: string;
  balanceEth: string;
}

export function getWalletBalance(): Promise<WalletBalance> {
  return request('/wallet/balance');
}

export function withdrawWallet(destinationAddress: string, amountWei: string): Promise<{
  txHash: string;
  amountWei: string;
  destination: string;
}> {
  return request('/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify({ destinationAddress, amountWei }),
  });
}

// ── Positions ──

export interface PositionTokenInfo {
  address: string;
  name: string | null;
  symbol: string | null;
  tier?: string;
}

export interface PositionInfo {
  id: number;
  userWallet: string;
  token: PositionTokenInfo;
  status: string;
  userCapital: string;
  protocolCapital: string;
  leverage: number;
  flatFee: string;
  tier: string;
  entryPrice: string | null;
  /** Entry converted to token-USD by the API (null when unavailable) */
  entryPriceUsd?: number | null;
  exitThreshold: string;
  takeProfitPct?: number | null;
  stopLossPct?: number | null;
  tokensBought: string | null;
  openedAt: string;
  // Active position fields
  timeRemainingMs?: number;
  livePnLPercent?: number | null;
  // History fields
  exitPrice?: string | null;
  /** Realized P&L in wei (negative on a loss). */
  pnlWei?: string | null;
  userProfit?: string | null;
  protocolRevenue?: string | null;
  closedAt?: string | null;
  closeTx?: string | null;
}

export interface PositionPreviewResponse {
  tier: string;
  tierEmoji: string;
  leverage: number;
  userCapitalWei: string;
  positionSizeWei: string;
  protocolCapitalWei: string;
  flatFeeWei: string;
  flatFeePct: number;
  exitThresholdPct: number;
  maxDurationHours: number;
  profitLockPct: number;
  scenarioIf2x: ScenarioResponse;
  scenarioIf3x: ScenarioResponse;
  scenarioIfDump: ScenarioResponse;
}

export interface ScenarioResponse {
  label: string;
  priceMovePercent: number;
  profitWei: string;
  degenCashoutWei: string;
  degenLockWei: string;
}

export function openPosition(
  tokenAddress: string,
  capitalWei: string,
  leverage: number,
  takeProfitPct?: number,
  stopLossPct?: number,
): Promise<PositionInfo> {
  return request('/positions/open', {
    method: 'POST',
    body: JSON.stringify({
      tokenAddress,
      capitalWei,
      leverage,
      ...(takeProfitPct != null && takeProfitPct > 0 ? { takeProfitPct } : {}),
      ...(stopLossPct != null && stopLossPct > 0 ? { stopLossPct } : {}),
    }),
  });
}

export function getActivePositions(): Promise<PositionInfo[]> {
  return request('/positions/active');
}

export function getTradeHistory(): Promise<PositionInfo[]> {
  return request('/positions/history');
}

export function closePosition(positionId: string, slippageBps = 200): Promise<PositionInfo> {
  return request(`/positions/${positionId}/close`, {
    method: 'POST',
    body: JSON.stringify({ slippageBps }),
  });
}

// ── Burns & Stats ──

export interface BurnEntry {
  id: number;
  ethAmount: string;
  tokenAmount: string;
  txHash: string;
  burnedAt: string;
  position?: {
    id: number;
    userWallet: string;
    tier: string;
    tokenSymbol: string;
    tokenAddress: string;
  };
}

export interface ProtocolStatsResponse {
  totalBurnedWei: string;
  totalBurnedTokens: string;
  totalLockedWei: string;
  totalLockedTokens: string;
  /** Real on-chain pool wallet balance (falls back to ledger if RPC down) */
  poolSizeWei: string;
  poolLedgerWei?: string;
  poolWalletAddress?: string | null;
  /** protocol $LOADED token — Trade page default */
  loadedToken?: string | null;
  poolSourceOnchain?: boolean;
  /** $LOADED locked supply, read on-chain */
  frontLockedTokens?: number | null;
  frontTotalSupply?: number | null;
  frontLockedPct?: number | null;
  totalCreatorPayoutsWei: string;
  totalTradesExecuted: number;
  totalListedTokens: number;
  activeListedTokens: number;
  activePositions: number;
}

export function getProtocolStats(): Promise<ProtocolStatsResponse> {
  return request('/stats');
}

export function getRecentBurns(limit?: number): Promise<BurnEntry[]> {
  const q = limit ? `?limit=${limit}` : '';
  return request(`/burns${q}`);
}

export interface ProfitLockEntry {
  id: number;
  ethAmount: string;
  tokenAmount: string;
  lockedAt: string;
  unlocksAt: string;
  isUnlocked: boolean;
  isExpired: boolean;
  timeRemainingMs: number;
  buyTx: string;
  unlockTx: string | null;
  position: {
    id: number;
    tier: string;
    tokenAddress: string;
    tokenSymbol: string | null;
  } | null;
}

export interface LocksResponse {
  locks: ProfitLockEntry[];
  summary: {
    totalLocked: string;
    totalUnlocked: string;
    pendingUnlock: string;
    activeLockCount: number;
  };
}

export function getRecentLocks(limit?: number): Promise<LocksResponse> {
  const q = limit ? `?limit=${limit}` : '';
  return request(`/locks${q}`);
}

export interface GlobalLockStats {
  totalLocked: { tokenAmount: string; ethAmount: string };
  totalUnlocked: { tokenAmount: string; ethAmount: string };
  upcoming7d: { tokenAmount: string; ethAmount: string; count: number };
  activeLockCount: number;
  totalLockCount: number;
  nextUnlocks: Array<{
    id: number;
    ethAmount: string;
    tokenAmount: string;
    unlocksAt: string;
  }>;
}

/** Public endpoint — no auth required */
export function getGlobalLockStats(): Promise<GlobalLockStats> {
  return request('/locks/global');
}

// ── Creator ──

export interface CreatorDashboardTokenItem {
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tier: string;
  tierEmoji: string;
  listedAt: string;
  isActive: boolean;
  totalTradingVolume: string;
  totalFeesGenerated: string;
  totalEarnings: string;
  todayTradingVolume: string;
  todayEarnings: string;
  unclaimedEarnings: string;
}

export interface CreatorDashboardTotals {
  totalTradingVolume: string;
  totalEarnings: string;
  totalFeesClaimed: string;
  unclaimedEarnings: string;
  todayVolume: string;
  todayEarnings: string;
  tokenCount: number;
}

export interface CreatorDashboardResponse {
  tokens: CreatorDashboardTokenItem[];
  totals: CreatorDashboardTotals;
}

export interface CreatorPayoutEntry {
  id: number;
  token: {
    address: string;
    name: string | null;
    symbol: string | null;
  };
  amount: string;
  status: string;
  claimTx: string | null;
  createdAt: string;
  claimedAt: string | null;
}

export function getCreatorDashboard(): Promise<CreatorDashboardResponse> {
  return request('/creator/dashboard');
}

export function getCreatorPayouts(): Promise<CreatorPayoutEntry[]> {
  return request('/creator/payouts');
}

/** Public wallet-based lookup — no auth required */
export function getCreatorDashboardByWallet(wallet: string): Promise<CreatorDashboardResponse> {
  return request(`/creator/dashboard/${wallet}`);
}

/** Public wallet-based payout lookup — no auth required */
export function getCreatorPayoutsByWallet(wallet: string): Promise<CreatorPayoutEntry[]> {
  return request(`/creator/payouts/${wallet}`);
}

export function claimCreatorEarnings(tokenAddress: string): Promise<{
  claimedAmount: string;
  payoutCount: number;
  message: string;
}> {
  return request('/creator/claim', {
    method: 'POST',
    body: JSON.stringify({ tokenAddress }),
  });
}

export function listToken(
  tokenAddress: string,
): Promise<{
  id: number;
  address: string;
  name: string | null;
  symbol: string | null;
  imageUri: string | null;
  tier: string;
  tierLabel: string;
  maxLeverage: number;
  message: string;
}> {
  return request('/tokens/list', {
    method: 'POST',
    body: JSON.stringify({ tokenAddress }),
  });
}

// ── Market Data (GeckoTerminal via API — Robinhood Chain) ──

export interface MarketToken {
  address: string;
  name: string;
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  logoURI: string | null;
}

export interface NewLaunch extends MarketToken {
  createdAt: string | null;
  dex: string | null;
}

/** Freshly launched launchpad coins, newest first — the Explorer feed. */
export function getNewLaunches(): Promise<NewLaunch[]> {
  return request('/market/new');
}

export function getMarketTrending(): Promise<MarketToken[]> {
  return request('/market/trending');
}

export function searchMarket(query: string): Promise<MarketToken[]> {
  return request(`/market/search?q=${encodeURIComponent(query)}`);
}

export function getMarketToken(address: string): Promise<MarketToken & {
  holders: number;
  supply: number;
  extensions: Record<string, string>;
}> {
  return request(`/market/token/${address}`);
}

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function getMarketPriceHistory(
  address: string,
  type?: string,
  timeFrom?: number,
  timeTo?: number,
): Promise<OHLCVCandle[]> {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (timeFrom) params.set('time_from', String(timeFrom));
  if (timeTo) params.set('time_to', String(timeTo));
  const q = params.toString() ? `?${params.toString()}` : '';
  return request(`/market/token/${address}/price-history${q}`);
}

export interface ReferenceFeed {
  /** What the candles actually are (top trending Robinhood Chain pool), e.g. "CASHCAT/USD" */
  label: string;
  candles: OHLCVCandle[];
}

/** Top-pool OHLCV on Robinhood Chain — the landing hero reference feed. */
export function getReferenceHistory(type = '15m'): Promise<ReferenceFeed> {
  return request(`/market/reference-history?type=${encodeURIComponent(type)}`);
}

export interface MarketTrade {
  txHash: string;
  blockUnixTime: number;
  side: 'buy' | 'sell';
  tokenAmount: number;
  priceUsd: number;
  volumeUsd: number;
  owner: string;
}

/** Recent real swaps in the token's top Robinhood Chain pool. */
export function getMarketTrades(address: string, limit = 30): Promise<MarketTrade[]> {
  return request(`/market/token/${address}/trades?limit=${limit}`);
}

/** Top Robinhood Chain pool for a token — used for the GeckoTerminal embed. */
export function getMarketPool(address: string): Promise<{ pool: string | null }> {
  return request(`/market/token/${address}/pool`);
}

/** Seconds-level candles from the live on-chain price feed. */
export function getLiveHistory(
  address: string,
  type: '1s' | '5s' | '15s' = '1s',
  limit = 300,
): Promise<{ candles: OHLCVCandle[]; last: number }> {
  return request(`/market/token/${address}/live-history?type=${type}&limit=${limit}`);
}

// ── Portfolio ──

export interface PortfolioData {
  wallet: {
    address: string;
    balanceWei: string;
    balanceEth: string;
  };
  positions: {
    open: number;
    totalCapitalLocked: string;
    items: Array<{
      id: number;
      token: PositionTokenInfo;
      leverage: number;
      userCapital: string;
      tier: string;
      openedAt: string;
    }>;
  };
  history: {
    totalTrades: number;
    totalPnlWei: string;
    totalProfitWei: string;
  };
  locks: {
    activeLocks: number;
    totalLockedWei: string;
  };
}

export function getPortfolio(): Promise<PortfolioData> {
  return request('/portfolio');
}

export function getPortfolioHistory(): Promise<{
  trades: PositionInfo[];
  total: number;
  limit: number;
  offset: number;
}> {
  return request('/portfolio/history');
}
