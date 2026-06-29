// ──────────────────────────────────────────────
// FRONT PROTOCOL — REST API Client
// ──────────────────────────────────────────────

const BASE_URL = process.env.API_URL ?? 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 15_000;

/** Structured error thrown when an API call fails */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string,
  ) {
    super(`API ${endpoint} returned ${status}: ${body}`);
    this.name = 'ApiError';
  }
}

// ──────────────────────────────────────────────
// Internal fetch wrapper
// ──────────────────────────────────────────────

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeout?: number;
}

async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeout = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${BASE_URL}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new ApiError(res.status, text, `${method} ${path}`);
    }

    return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(408, 'Request timed out', `${method} ${path}`);
    }
    throw new ApiError(0, (err as Error).message, `${method} ${path}`);
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────────────────────────────
// Response types (API JSON shapes)
// ──────────────────────────────────────────────

export interface WalletInfo {
  telegramId: string;
  walletAddress: string;
  createdAt: string;
}

export interface BalanceInfo {
  solLamports: string;
  solBalance: number;
  apeBalance: number;
}

export interface PositionInfo {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  tier: string;
  status: string;
  leverage: number;
  userCapitalLamports: string;
  positionSizeLamports: string;
  protocolCapitalLamports: string;
  flatFeeLamports: string;
  entryPriceSol: number;
  currentPriceSol: number;
  pnlPercent: number;
  pnlLamports: string;
  openedAt: string;
  expiresAt: string;
}

export interface TradeInfo extends PositionInfo {
  closedAt: string | null;
  exitPriceSol: number | null;
  profitLocked: boolean;
  lockAmount: string | null;
  lockUnlocksAt: string | null;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  tier: string;
  creatorWallet: string;
  isActive: boolean;
  priceSol: number;
  priceUsd: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number;
  isBonded: boolean;
}

export interface BurnInfo {
  id: string;
  amountLamports: string;
  apeTokensBurned: string;
  txSignature: string;
  burnedAt: string;
}

export interface BurnStats {
  totalBurnedLamports: string;
  totalBurnedTokens: string;
  burnCount: number;
}

export interface ProtocolStatsResp {
  totalBurnedLamports: string;
  totalBurnedTokens: string;
  totalLockedLamports: string;
  totalLockedTokens: string;
  poolSizeLamports: string;
  totalCreatorPayoutsLamports: string;
  totalTradesExecuted: number;
  totalListedTokens: number;
  activePositions: number;
}

export interface PoolInfo {
  sizeLamports: string;
  utilizationPct: number;
  availableLamports: string;
}

export interface CreatorDashboardResp {
  tokenAddress: string;
  tokenSymbol: string;
  tier: string;
  listedAt: string;
  totalTradingVolume: string;
  totalFeesGenerated: string;
  totalEarnings: string;
  todayTradingVolume: string;
  todayFeesGenerated: string;
  todayEarnings: string;
  unclaimedEarnings: string;
  feesRedirected: string;
}

export interface EarningsInfo {
  totalEarnings: string;
  unclaimedEarnings: string;
  claimedEarnings: string;
  payouts: Array<{
    id: string;
    amountLamports: string;
    status: string;
    claimedAt: string | null;
    createdAt: string;
  }>;
}

export interface ClaimResult {
  txSignature: string;
  amountLamports: string;
  payoutIds: string[];
}

export interface LockInfo {
  id: string;
  amountLamports: string;
  apeTokens: string;
  lockedAt: string;
  unlocksAt: string;
  isUnlocked: boolean;
}

export interface PnLSummary {
  totalProfitLamports: string;
  totalLossLamports: string;
  netPnlLamports: string;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalApeAccumulated: string;
}

export interface WithdrawResult {
  txSignature: string;
  amountLamports: string;
  toAddress: string;
}

export interface OpenPositionResult {
  positionId: string;
  txSignature: string;
  position: PositionInfo;
}

export interface ClosePositionResult {
  txSignature: string;
  pnlLamports: string;
  isProfitable: boolean;
  cashoutLamports: string;
  lockLamports: string | null;
}

export interface UserSettings {
  alertsEnabled: boolean;
  slippageBps: number;
}

export interface TrendingToken extends TokenInfo {
  rank: number;
}

export interface SearchResult {
  tokens: TokenInfo[];
  total: number;
}

export interface ListedTokensResult {
  tokens: TokenInfo[];
  total: number;
  page: number;
  pageSize: number;
}

// ──────────────────────────────────────────────
// API Functions — Wallet
// ──────────────────────────────────────────────

/** Create or retrieve the wallet for a Telegram user */
export async function getOrCreateWallet(telegramId: string): Promise<WalletInfo> {
  return api<WalletInfo>('/wallet', {
    method: 'POST',
    body: { telegramId },
  });
}

/** Get SOL and $APE balance for a user */
export async function getBalance(telegramId: string): Promise<BalanceInfo> {
  return api<BalanceInfo>(`/wallet/${telegramId}/balance`);
}

/** Withdraw SOL to an external address */
export async function withdrawSol(
  telegramId: string,
  amountLamports: string,
  toAddress: string,
): Promise<WithdrawResult> {
  return api<WithdrawResult>(`/wallet/${telegramId}/withdraw`, {
    method: 'POST',
    body: { amountLamports, toAddress },
  });
}

// ──────────────────────────────────────────────
// API Functions — Positions / Trading
// ──────────────────────────────────────────────

/** Open a new leveraged position */
export async function openPosition(
  telegramId: string,
  tokenSymbol: string,
  amountSol: number,
  leverage: number,
): Promise<OpenPositionResult> {
  return api<OpenPositionResult>('/positions/open', {
    method: 'POST',
    body: { telegramId, tokenSymbol, amountSol, leverage },
  });
}

/** Close a position */
export async function closePosition(
  telegramId: string,
  positionId: string,
): Promise<ClosePositionResult> {
  return api<ClosePositionResult>(`/positions/${positionId}/close`, {
    method: 'POST',
    body: { telegramId },
  });
}

/** Get all active (open) positions */
export async function getActivePositions(telegramId: string): Promise<PositionInfo[]> {
  return api<PositionInfo[]>(`/positions/${telegramId}/active`);
}

/** Get trade history */
export async function getTradeHistory(telegramId: string): Promise<TradeInfo[]> {
  return api<TradeInfo[]>(`/positions/${telegramId}/history`);
}

// ──────────────────────────────────────────────
// API Functions — Token Discovery
// ──────────────────────────────────────────────

/** Get detailed info for a token by address or symbol */
export async function getTokenInfo(tokenAddressOrSymbol: string): Promise<TokenInfo> {
  return api<TokenInfo>(`/tokens/${encodeURIComponent(tokenAddressOrSymbol)}`);
}

/** Search for tokens by name or symbol */
export async function searchTokens(query: string): Promise<SearchResult> {
  return api<SearchResult>(`/tokens/search?q=${encodeURIComponent(query)}`);
}

/** Get trending tokens ranked by volume */
export async function getTrendingTokens(): Promise<TrendingToken[]> {
  return api<TrendingToken[]>('/tokens/trending');
}

/** Get all listed tokens with pagination */
export async function getListedTokens(page = 1, pageSize = 10): Promise<ListedTokensResult> {
  return api<ListedTokensResult>(`/tokens/listed?page=${page}&pageSize=${pageSize}`);
}

// ──────────────────────────────────────────────
// API Functions — Burns & Protocol
// ──────────────────────────────────────────────

/** Get recent burns */
export async function getBurns(): Promise<BurnInfo[]> {
  return api<BurnInfo[]>('/burns');
}

/** Get aggregate burn stats */
export async function getBurnStats(): Promise<BurnStats> {
  return api<BurnStats>('/burns/stats');
}

/** Get protocol-wide statistics */
export async function getProtocolStats(): Promise<ProtocolStatsResp> {
  return api<ProtocolStatsResp>('/stats');
}

/** Get capital pool info */
export async function getPoolInfo(): Promise<PoolInfo> {
  return api<PoolInfo>('/pool');
}

// ──────────────────────────────────────────────
// API Functions — Creator
// ──────────────────────────────────────────────

/** Get creator dashboard */
export async function getCreatorDashboard(telegramId: string): Promise<CreatorDashboardResp> {
  return api<CreatorDashboardResp>(`/creator/${telegramId}/dashboard`);
}

/** Get detailed earnings breakdown */
export async function getCreatorEarnings(telegramId: string): Promise<EarningsInfo> {
  return api<EarningsInfo>(`/creator/${telegramId}/earnings`);
}

/** Claim all pending creator earnings */
export async function claimCreatorEarnings(telegramId: string): Promise<ClaimResult> {
  return api<ClaimResult>(`/creator/${telegramId}/claim`, { method: 'POST' });
}

// ──────────────────────────────────────────────
// API Functions — Locks / PnL
// ──────────────────────────────────────────────

/** Get user's $FRONT profit locks */
export async function getUserLocks(telegramId: string): Promise<LockInfo[]> {
  return api<LockInfo[]>(`/locks/${telegramId}`);
}

/** Get user's overall P&L summary */
export async function getPnL(telegramId: string): Promise<PnLSummary> {
  return api<PnLSummary>(`/pnl/${telegramId}`);
}

// ──────────────────────────────────────────────
// API Functions — Settings
// ──────────────────────────────────────────────

/** Get current user settings */
export async function getUserSettings(telegramId: string): Promise<UserSettings> {
  return api<UserSettings>(`/settings/${telegramId}`);
}

/** Update user settings */
export async function updateUserSettings(
  telegramId: string,
  settings: Partial<UserSettings>,
): Promise<UserSettings> {
  return api<UserSettings>(`/settings/${telegramId}`, {
    method: 'PATCH',
    body: settings,
  });
}
