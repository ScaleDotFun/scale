/**
 * LOADED — Robinhood Chain (EVM) execution layer.
 *
 * viem for RPC + signing, LI.FI as the swap aggregator (it routes across the
 * DEXes on Robinhood Chain), and wei as the native unit.
 *
 * Units: 1 ETH = 1e18 wei. Token amounts are always RAW units (bigint), never
 * floats — decimals are applied only at the display edge.
 */
import crypto from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseAbiItem,
  isAddress,
  getAddress,
  decodeEventLog,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from 'viem/accounts';
import { defineChain } from 'viem';

const LOG_PREFIX = '[evm]';

// ── Chain ────────────────────────────────────────────────────
export const CHAIN_ID = 4663;

export const ROBINHOOD_RPC =
  process.env.EVM_RPC_URL?.trim() || 'https://rpc.mainnet.chain.robinhood.com';

/** Robinhood Chain — Arbitrum Orbit L2, EVM-equivalent (Nitro). */
export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC] } },
  blockExplorers: {
    default: { name: 'Robinhood Explorer', url: 'https://explorer.chain.robinhood.com' },
  },
});

export const LIFI_API = process.env.LIFI_API_URL?.trim() || 'https://li.quest/v1';

/** Native ETH sentinel used by LI.FI (and most aggregators) for the gas token. */
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000' as Address;

/** Canonical burn sink — ERC-20s without burn() are sent here instead. */
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;

const EXPLORER = 'https://explorer.chain.robinhood.com';
export const explorerTxUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;
export const explorerTokenUrl = (addr: string) => `${EXPLORER}/token/${addr}`;

// ── Clients ──────────────────────────────────────────────────
let _publicClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: robinhoodChain,
      transport: http(ROBINHOOD_RPC, { batch: true, retryCount: 3 }),
    }) as PublicClient;
    console.log(`${LOG_PREFIX} connection → ${ROBINHOOD_RPC.replace(/api[-_]?key=[^&]+/i, 'api-key=…')}`);
  }
  return _publicClient;
}

export function getWalletClient(account: PrivateKeyAccount): WalletClient {
  return createWalletClient({ account, chain: robinhoodChain, transport: http(ROBINHOOD_RPC) });
}

/** Checksummed-address validation. Accepts any valid 20-byte hex address. */
export function isValidAddress(addr: string): boolean {
  return typeof addr === 'string' && isAddress(addr.trim());
}

// ── Key encryption (AES-256-GCM) ─────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error(`${LOG_PREFIX} ENCRYPTION_KEY env var is not set`);
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error(`${LOG_PREFIX} ENCRYPTION_KEY must be 32 bytes (64 hex chars)`);
  return key;
}

export function encryptPrivateKey(privateKey: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(privateKey, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPrivateKey(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = encrypted.split(':') as [string, string, string];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const out = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return out.toString('utf8');
}

// ── Wallets ──────────────────────────────────────────────────
export interface CustodialWallet {
  address: string;
  encryptedPrivateKey: string;
}

/** Fresh custodial EVM wallet; 0x-hex private key AES-encrypted at rest. */
export function generateCustodialWallet(): CustodialWallet {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { address: account.address, encryptedPrivateKey: encryptPrivateKey(pk) };
}

/**
 * Parse a private key. Accepts 0x-prefixed or bare 64-char hex. Anything that
 * is not a 32-byte hex key fails loudly rather than silently deriving a
 * garbage address that would strand funds.
 */
function accountFromSecret(secret: string): PrivateKeyAccount {
  const trimmed = secret.trim();
  if (trimmed.startsWith('[')) {
    throw new Error(
      `${LOG_PREFIX} got a JSON-array secret key — expected an EVM hex private key (0x…).`,
    );
  }
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${LOG_PREFIX} PROTOCOL_WALLET_PRIVATE_KEY is not a 32-byte hex key. ` +
      `Expected 0x + 64 hex chars (an EVM private key).`,
    );
  }
  return privateKeyToAccount(hex as Hex);
}

export function loadCustodialWallet(encryptedKey: string): PrivateKeyAccount {
  return accountFromSecret(decryptPrivateKey(encryptedKey));
}

let _protocolAccount: PrivateKeyAccount | null = null;

export function getProtocolAccount(): PrivateKeyAccount {
  if (!_protocolAccount) {
    const raw = process.env.PROTOCOL_WALLET_PRIVATE_KEY;
    if (!raw) throw new Error(`${LOG_PREFIX} PROTOCOL_WALLET_PRIVATE_KEY env var is not set`);
    _protocolAccount = accountFromSecret(raw);
    console.log(`${LOG_PREFIX} protocol wallet → ${_protocolAccount.address}`);
  }
  return _protocolAccount;
}

/** True when a usable EVM protocol key is configured — the "trading enabled" gate. */
export function hasProtocolKey(): boolean {
  const raw = process.env.PROTOCOL_WALLET_PRIVATE_KEY?.trim();
  if (!raw) return false;
  try {
    accountFromSecret(raw);
    return true;
  } catch {
    return false;
  }
}

/** Pool wallet address — live key when installed, else PROTOCOL_WALLET env, else null. */
export function protocolPublicKey(): string | null {
  if (hasProtocolKey()) return getProtocolAccount().address;
  const envAddr = process.env.PROTOCOL_WALLET?.trim();
  return envAddr && isValidAddress(envAddr) ? getAddress(envAddr) : null;
}

// ── Native balance & transfer ────────────────────────────────
export async function getNativeBalance(address: string): Promise<bigint> {
  return getPublicClient().getBalance({ address: getAddress(address) });
}

/** Send native ETH. Returns the tx hash once mined (reverts throw). */
export async function transferNative(
  from: PrivateKeyAccount,
  to: string,
  amountWei: bigint,
): Promise<string> {
  return withWalletLock(from.address, async () => {
    const wallet = getWalletClient(from);
    const hash = await wallet.sendTransaction({
      account: from,
      chain: robinhoodChain,
      to: getAddress(to),
      value: amountWei,
    });
    const receipt = await getPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
    if (receipt.status !== 'success') {
      throw new Error(`${LOG_PREFIX} native transfer reverted: ${hash}`);
    }
    console.log(
      `${LOG_PREFIX} transferNative ${Number(amountWei) / 1e18} ETH → ${to.slice(0, 10)}… ${hash.slice(0, 16)}…`,
    );
    return hash;
  });
}

// ── ERC-20 ───────────────────────────────────────────────────
const ERC20_ABI = parseAbi([
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function burn(uint256 amount)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const _decimalsCache = new Map<string, number>();

export async function erc20Decimals(token: string): Promise<number> {
  const key = token.toLowerCase();
  const hit = _decimalsCache.get(key);
  if (hit !== undefined) return hit;
  const d = await getPublicClient().readContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'decimals',
  });
  const n = Number(d);
  _decimalsCache.set(key, n);
  return n;
}

export async function erc20TotalSupply(token: string): Promise<bigint> {
  return getPublicClient().readContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'totalSupply',
  });
}

export async function erc20Balance(token: string, owner: string): Promise<bigint> {
  return getPublicClient().readContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [getAddress(owner)],
  });
}

/** Transfer body without the wallet lock — callers must already hold it. */
async function erc20TransferInner(
  from: PrivateKeyAccount,
  token: string,
  to: string,
  amount: bigint,
): Promise<string> {
  const wallet = getWalletClient(from);
  const hash = await wallet.writeContract({
    account: from,
    chain: robinhoodChain,
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [getAddress(to), amount],
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`${LOG_PREFIX} erc20 transfer reverted: ${hash}`);
  return hash;
}

export async function erc20Transfer(
  from: PrivateKeyAccount,
  token: string,
  to: string,
  amount: bigint,
): Promise<string> {
  return withWalletLock(from.address, () => erc20TransferInner(from, token, to, amount));
}

/**
 * Burn tokens. Prefers a real burn() when the token exposes one; otherwise
 * transfers to the dead address (most memecoins have no burn function).
 */
export async function erc20Burn(
  from: PrivateKeyAccount,
  token: string,
  amount: bigint,
): Promise<string> {
  // One lock for the whole operation — the dead-address fallback uses the
  // unlocked transfer body so it cannot deadlock against this same lock.
  return withWalletLock(from.address, async () => {
    const wallet = getWalletClient(from);
    try {
      const hash = await wallet.writeContract({
        account: from,
        chain: robinhoodChain,
        address: getAddress(token),
        abi: ERC20_ABI,
        functionName: 'burn',
        args: [amount],
      });
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status === 'success') return hash;
    } catch {
      // no burn() on this token — fall through to the dead-address transfer
    }
    return erc20TransferInner(from, token, DEAD_ADDRESS, amount);
  });
}

async function ensureAllowance(
  owner: PrivateKeyAccount,
  token: string,
  spender: string,
  amount: bigint,
): Promise<void> {
  const current = await getPublicClient().readContract({
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner.address, getAddress(spender)],
  });
  if (current >= amount) return;
  const wallet = getWalletClient(owner);
  const hash = await wallet.writeContract({
    account: owner,
    chain: robinhoodChain,
    address: getAddress(token),
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [getAddress(spender), amount],
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`${LOG_PREFIX} approve reverted: ${hash}`);
}

// ── Swaps (LI.FI aggregator) ─────────────────────────────────
export interface SwapResult {
  txHash: string;
  amountIn: bigint;
  amountOut: bigint;
  tool: string;
}

export interface AggQuote {
  tool: string;
  fromAmount: bigint;
  toAmount: bigint;
  toAmountMin: bigint;
  to: Address;
  data: Hex;
  value: bigint;
  gasLimit?: bigint;
  approvalAddress?: Address;
}

function bpsToPct(slippageBps: number): number {
  return Math.max(0.0001, Math.min(0.5, slippageBps / 10_000));
}

/**
 * Quote a swap through LI.FI. `fromToken`/`toToken` use NATIVE_TOKEN for ETH.
 * Returns the signable transaction plus the guaranteed minimum output.
 */
export async function aggregatorQuote(
  fromToken: string,
  toToken: string,
  amountIn: bigint,
  fromAddress: string,
  slippageBps = 100,
): Promise<AggQuote> {
  const url = new URL(`${LIFI_API}/quote`);
  url.searchParams.set('fromChain', String(CHAIN_ID));
  url.searchParams.set('toChain', String(CHAIN_ID));
  url.searchParams.set('fromToken', fromToken);
  url.searchParams.set('toToken', toToken);
  url.searchParams.set('fromAmount', amountIn.toString());
  url.searchParams.set('fromAddress', fromAddress);
  url.searchParams.set('slippage', String(bpsToPct(slippageBps)));

  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.LIFI_API_KEY) headers['x-lifi-api-key'] = process.env.LIFI_API_KEY;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${LOG_PREFIX} LI.FI quote failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const j = (await res.json()) as any;
  const est = j?.estimate;
  const tx = j?.transactionRequest;
  if (!est || !tx?.to || !tx?.data) {
    throw new Error(`${LOG_PREFIX} LI.FI returned no executable route for this pair`);
  }
  return {
    tool: String(j.tool ?? 'lifi'),
    fromAmount: BigInt(est.fromAmount),
    toAmount: BigInt(est.toAmount),
    toAmountMin: BigInt(est.toAmountMin ?? est.toAmount),
    to: getAddress(tx.to),
    data: tx.data as Hex,
    value: BigInt(tx.value ?? '0'),
    gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    approvalAddress: j?.estimate?.approvalAddress
      ? getAddress(j.estimate.approvalAddress)
      : undefined,
  };
}

/**
 * Sum ERC-20 Transfer events crediting `owner` for `token` in a mined receipt.
 *
 * This is the EVM counterpart to reading confirmed transaction meta on Robinhood Chain:
 * we derive the REAL output from the mined logs rather than diffing balances
 * with a second RPC read. Balance-diffing is what produced the "blind position"
 * bug (a stale read reported 0 out, creating an unclosable position), so the
 * amount must always come from the receipt itself.
 */
export function tokenCreditedInReceipt(
  receipt: TransactionReceipt,
  token: string,
  owner: string,
): bigint {
  const tokenAddr = getAddress(token).toLowerCase();
  const ownerAddr = getAddress(owner).toLowerCase();
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenAddr) continue;
    try {
      const ev = decodeEventLog({ abi: ERC20_ABI, data: log.data, topics: log.topics });
      if (ev.eventName !== 'Transfer') continue;
      const args = ev.args as unknown as { from: Address; to: Address; value: bigint };
      if (args.to.toLowerCase() === ownerAddr) total += args.value;
      if (args.from.toLowerCase() === ownerAddr) total -= args.value;
    } catch {
      // not a Transfer we can decode — ignore
    }
  }
  return total > 0n ? total : 0n;
}

/**
 * Recovery helpers: given only a tx hash, determine what a swap actually did.
 *
 * Used when a position is found stuck (the process died between sending a swap
 * and recording its result). They return null when the outcome genuinely cannot
 * be established, so callers escalate to manual review rather than booking a
 * fabricated amount.
 */
export async function confirmedTokenDelta(
  txHash: string,
  owner: string,
  token: string,
): Promise<bigint | null> {
  try {
    const receipt = await getPublicClient().getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== 'success') return null;
    return tokenCreditedInReceipt(receipt, token, owner);
  } catch {
    return null;
  }
}

export async function confirmedNativeDelta(
  txHash: string,
  owner: string,
): Promise<bigint | null> {
  try {
    const client = getPublicClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== 'success') return null;
    const addr = getAddress(owner);
    // Native ETH movement emits no log, so diff the owner's balance across the
    // block that mined the tx and add back the gas it paid.
    const [after, before] = await Promise.all([
      client.getBalance({ address: addr, blockNumber: receipt.blockNumber }),
      client.getBalance({ address: addr, blockNumber: receipt.blockNumber - 1n }),
    ]);
    const gas = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
    const paidGas = receipt.from.toLowerCase() === addr.toLowerCase() ? gas : 0n;
    const delta = after - before + paidGas;
    return delta > 0n ? delta : null;
  } catch {
    // Historical balance lookups are not guaranteed on every RPC provider.
    return null;
  }
}

/**
 * Per-wallet serialization.
 *
 * Every position is opened and closed from the SAME protocol pool wallet, and
 * several workers act on it at once. Two concurrent sends race the nonce, and —
 * worse — any concurrent pool movement corrupts a balance-difference reading,
 * which is how native swap proceeds are measured. Serializing per wallet makes
 * both problems impossible; the pool is a single account, so this is the
 * natural throughput limit anyway.
 */
const _walletLocks = new Map<string, Promise<unknown>>();

export function withWalletLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase();
  const prev = _walletLocks.get(key) ?? Promise.resolve();
  // Chain onto the previous holder, ignoring its outcome so one failure
  // does not poison the queue.
  const run = prev.then(fn, fn);
  // Keep the chain alive but never let it surface as an unhandled rejection.
  _walletLocks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

async function executeQuote(
  account: PrivateKeyAccount,
  quote: AggQuote,
): Promise<TransactionReceipt> {
  const wallet = getWalletClient(account);
  const hash = await wallet.sendTransaction({
    account,
    chain: robinhoodChain,
    to: quote.to,
    data: quote.data,
    value: quote.value,
    ...(quote.gasLimit ? { gas: quote.gasLimit } : {}),
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') {
    throw new Error(`${LOG_PREFIX} swap reverted on-chain: ${hash}`);
  }
  return receipt;
}

/**
 * Native ETH credited to `owner` by a specific transaction.
 *
 * Measured across the mined block boundary rather than "latest", so the answer
 * is a property of that transaction instead of whatever the wallet happens to
 * hold when the query runs.
 */
async function nativeCreditedByTx(
  receipt: TransactionReceipt,
  owner: Address,
): Promise<bigint | null> {
  try {
    const client = getPublicClient();
    const [after, before] = await Promise.all([
      client.getBalance({ address: owner, blockNumber: receipt.blockNumber }),
      client.getBalance({ address: owner, blockNumber: receipt.blockNumber - 1n }),
    ]);
    const gas = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);
    const paidGas = receipt.from.toLowerCase() === owner.toLowerCase() ? gas : 0n;
    const delta = after - before + paidGas;
    return delta > 0n ? delta : null;
  } catch {
    // Historical balance lookups are not guaranteed on every provider.
    return null;
  }
}

/** Buy `token` with native ETH. amountIn is wei. */
export async function swapNativeForToken(
  account: PrivateKeyAccount,
  token: string,
  amountInWei: bigint,
  slippageBps = 100,
): Promise<SwapResult> {
  const quote = await aggregatorQuote(
    NATIVE_TOKEN,
    getAddress(token),
    amountInWei,
    account.address,
    slippageBps,
  );
  // Serialized for nonce safety — several workers trade from this one wallet.
  return withWalletLock(account.address, async () => {
    const receipt = await executeQuote(account, quote);
    let amountOut = tokenCreditedInReceipt(receipt, token, account.address);
    if (amountOut === 0n) {
      // Router credited via a path the logs did not attribute to us; fall back to
      // the quoted minimum rather than recording a blind zero.
      amountOut = quote.toAmountMin;
      console.warn(`${LOG_PREFIX} no Transfer credit found in receipt; using toAmountMin`);
    }
    console.log(
      `${LOG_PREFIX} buy ${Number(amountInWei) / 1e18} ETH → ${amountOut} ${token.slice(0, 10)}… via ${quote.tool} ${receipt.transactionHash.slice(0, 16)}…`,
    );
    return { txHash: receipt.transactionHash, amountIn: amountInWei, amountOut, tool: quote.tool };
  });
}

/** Sell `token` for native ETH. amountIn is raw token units. */
export async function swapTokenForNative(
  account: PrivateKeyAccount,
  token: string,
  amountIn: bigint,
  slippageBps = 200,
): Promise<SwapResult> {
  const quote = await aggregatorQuote(
    getAddress(token),
    NATIVE_TOKEN,
    amountIn,
    account.address,
    slippageBps,
  );
  const spender = quote.approvalAddress ?? quote.to;

  // Serialized: the proceeds below are derived from this wallet's balance, so
  // no other pool transaction may be in flight while this one settles.
  return withWalletLock(account.address, async () => {
    await ensureAllowance(account, token, spender, amountIn);
    const receipt = await executeQuote(account, quote);

    // Native output emits no Transfer log, so measure the credit across this
    // transaction's own block boundary. Falling back to the quoted minimum
    // under-records rather than inventing proceeds the pool never received.
    const credited = await nativeCreditedByTx(receipt, account.address);
    const amountOut = credited ?? quote.toAmountMin;
    if (credited === null) {
      console.warn(
        `${LOG_PREFIX} could not measure ETH credited by ${receipt.transactionHash}; using toAmountMin`,
      );
    }

    console.log(
      `${LOG_PREFIX} sell ${amountIn} ${token.slice(0, 10)}… → ${Number(amountOut) / 1e18} ETH via ${quote.tool} ${receipt.transactionHash.slice(0, 16)}…`,
    );
    return { txHash: receipt.transactionHash, amountIn, amountOut, tool: quote.tool };
  });
}

// ── Token metadata & market data (GeckoTerminal) ─────────────
/**
 * GeckoTerminal base + headers.
 *
 * The free tier allows ~30 req/min for the whole process. With a CoinGecko Pro
 * key the identical endpoints are served at ~500 req/min from the Pro host —
 * without this, calls from here burn the shared free budget and 429 the API's
 * market feeds, which surfaces to users as "FEED OFFLINE".
 */
function gtKey(): string {
  return (process.env.COINGECKO_API_KEY ?? '').trim();
}
function gtBase(): string {
  return gtKey() ? 'https://pro-api.coingecko.com/api/v3/onchain' : 'https://api.geckoterminal.com/api/v2';
}
function gtHeaders(): Record<string, string> {
  const key = gtKey();
  return key
    ? { accept: 'application/json', 'x-cg-pro-api-key': key }
    : { accept: 'application/json' };
}
/** GeckoTerminal's network slug for Robinhood Chain. */
export const GT_NETWORK = 'robinhood';

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  imageUri?: string | null;
  priceUsd?: number | null;
  marketCap?: number | null;
  liquidity?: number | null;
  volume24h?: number | null;
  priceChange24h?: number | null;
  launchpad?: string | null;
}

function gtToken(d: any): TokenInfo | null {
  const a = d?.attributes;
  if (!a?.address) return null;
  return {
    address: getAddress(a.address),
    name: a.name ?? '',
    symbol: a.symbol ?? '',
    decimals: Number(a.decimals ?? 18),
    imageUri: a.image_url && a.image_url !== 'missing.png' ? a.image_url : null,
    priceUsd: a.price_usd != null ? Number(a.price_usd) : null,
    marketCap:
      a.market_cap_usd != null
        ? Number(a.market_cap_usd)
        : a.fdv_usd != null
          ? Number(a.fdv_usd)
          : null,
    liquidity: a.total_reserve_in_usd != null ? Number(a.total_reserve_in_usd) : null,
    volume24h: a.volume_usd?.h24 != null ? Number(a.volume_usd.h24) : null,
    priceChange24h: null,
  };
}

export async function getTokenInfo(address: string): Promise<TokenInfo | null> {
  try {
    const res = await fetch(`${gtBase()}/networks/${GT_NETWORK}/tokens/${address}`, {
      headers: gtHeaders(),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    return gtToken(j?.data);
  } catch {
    return null;
  }
}

/** Trending tokens on Robinhood Chain, derived from trending pools. */
export async function getTrendingTokens(limit = 20): Promise<TokenInfo[]> {
  try {
    const res = await fetch(
      `${gtBase()}/networks/${GT_NETWORK}/trending_pools?include=base_token&page=1`,
      { headers: gtHeaders() },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as any;
    const included = new Map<string, any>(
      (j.included ?? []).filter((x: any) => x.type === 'token').map((x: any) => [x.id, x]),
    );
    const out: TokenInfo[] = [];
    for (const pool of j.data ?? []) {
      const baseId = pool?.relationships?.base_token?.data?.id;
      const tok = included.get(baseId);
      const info = tok ? gtToken(tok) : null;
      if (!info) continue;
      // Price/mcap live on the POOL, not the included token record — the
      // token payload leaves them null, which showed up as $null / mc=0.
      const a = pool.attributes ?? {};
      info.volume24h = a.volume_usd?.h24 != null ? Number(a.volume_usd.h24) : info.volume24h;
      info.liquidity = a.reserve_in_usd != null ? Number(a.reserve_in_usd) : info.liquidity;
      info.priceChange24h =
        a.price_change_percentage?.h24 != null ? Number(a.price_change_percentage.h24) : null;
      if (a.base_token_price_usd != null) info.priceUsd = Number(a.base_token_price_usd);
      if (info.marketCap == null || info.marketCap === 0) {
        const mc = a.market_cap_usd ?? a.fdv_usd;
        if (mc != null) info.marketCap = Number(mc);
      }
      info.launchpad = pool?.relationships?.dex?.data?.id ?? null;
      if (!out.some((t) => t.address === info.address)) out.push(info);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Launch venues, as GeckoTerminal dex ids with the chain suffix stripped.
 *
 * Every dex on this chain is indexed as "<name>-robinhood", so these must be
 * matched against the SUFFIX-STRIPPED id — a substring test for "hood" would
 * match "uniswap-v3-robinhood" and classify every plain AMM as a launchpad.
 */
export const KNOWN_LAUNCHPADS = [
  'pons',
  'pons-v2',
  'pons-v2-dex',
  'pons-dot-family',
  'hoodit',
  'uniswap-pools-trade',
  'clanker',
  'bankr',
  'virtuals',
  'o1-launchpad',
  'mint-club',
  'easya-kickstart',
] as const;

/** Strip the "-robinhood" chain suffix GeckoTerminal appends to dex ids. */
function normalizeDexId(dex: string): string {
  return dex.toLowerCase().replace(/-robinhood$/, '').trim();
}

export function isLaunchpadToken(_address: string, launchpad?: string | null): boolean {
  if (!launchpad) return false;
  const d = normalizeDexId(launchpad);
  return KNOWN_LAUNCHPADS.some((k) => d === k || d.startsWith(`${k}-`));
}

// ── PONS ─────────────────────────────────────────────────────
/** PONS bonding-curve implementation — every launch's curve delegates to it. */
export const PONS_CURVE_IMPL = '0x3711cea4feade896c913c68f01eda97cb06d1a42';

/** PONS fee/config contract — holds the 1% trade fee and the creator's share of it. */
export const PONS_FEE_CONFIG = '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044';

/** GeckoTerminal dex ids that PONS pools are indexed under. */
export const PONS_DEXES = ['pons-v2-dex', 'pons-v2', 'pons-dot-family'] as const;

export function isPonsDex(dex?: string | null): boolean {
  if (!dex) return false;
  const d = normalizeDexId(dex);
  return d === 'pons' || d.startsWith('pons-') || PONS_DEXES.some((k) => d === k);
}

interface TokenPool {
  /** Pool identity. Post-graduation this is a Uniswap V4 32-byte poolId, not a contract. */
  id: string;
  dex: string | null;
}

/** Pools quoting `address`, newest liquidity first. `null` means the feed was unreachable. */
async function fetchTokenPools(address: string): Promise<TokenPool[] | null> {
  try {
    const res = await fetch(`${gtBase()}/networks/${GT_NETWORK}/tokens/${address}/pools`, {
      headers: gtHeaders(),
    });
    if (!res.ok) return res.status === 404 ? [] : null;
    const j = (await res.json()) as any;
    return (j?.data ?? []).map((p: any) => ({
      id: String(p?.attributes?.address ?? p?.id ?? ''),
      dex: p?.relationships?.dex?.data?.id ?? null,
    }));
  } catch {
    return null;
  }
}

// ── Creator-fee gate ─────────────────────────────────────────
export type CreatorFeeStatus =
  | 'verified'
  | 'not_redirected'
  | 'not_launchpad_token'
  | 'not_found'
  | 'unverifiable';

export interface CreatorFeeResult {
  status: CreatorFeeStatus;
  token: TokenInfo | null;
  launchpad: string | null;
  poolWallet: string;
  graduated: boolean;
  detail: string;
}

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

/** Default log window. ~0.25s blocks on this L2, so this is roughly the last few hours. */
export const DEFAULT_FEE_SCAN_BLOCKS = 50_000n;
const MAX_FEE_SCAN_BLOCKS = 1_000_000n;
const FEE_SCAN_TIMEOUT_MS = 20_000;

function feeScanBlocks(): bigint {
  const raw = Number(process.env.LOADED_FEE_SCAN_BLOCKS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_FEE_SCAN_BLOCKS;
  const n = BigInt(Math.floor(raw));
  return n > MAX_FEE_SCAN_BLOCKS ? MAX_FEE_SCAN_BLOCKS : n;
}

/** A stalled eth_getLogs must not hold the listing request open. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${LOG_PREFIX} ${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

interface CreditScan {
  /** The chain answered — a false `credited` is then a real negative, not ignorance. */
  readable: boolean;
  credited: boolean;
  detail: string;
}

/**
 * Economic proof that this coin's PONS creator fees reach the pool wallet.
 *
 * PONS has setCreatorFeeRecipient(address) but publishes no getter for it, so the
 * redirect cannot be read off the curve — the only honest evidence is money
 * actually arriving FROM this coin's pool. Both filters matter: the pool wallet
 * also holds every leveraged position the protocol opens, so a bare "was this
 * wallet credited" query would pass any coin on the chain. Fees paid in native
 * ETH emit no log at all and therefore cannot be attributed here; those come back
 * as not_redirected rather than a guess.
 */
/** Resolved curve per token — a curve never moves, so cache it forever. */
const _curveCache = new Map<string, Address | null>();

/**
 * The PONS bonding curve for a coin.
 *
 * PONS mints the entire supply to the curve at launch, so the recipient of the
 * mint (the one Transfer whose `from` is the zero address) IS the curve. That
 * is the only reliable handle on it: GeckoTerminal reports pools as Uniswap V4
 * poolIds, which are 32-byte hashes and not contracts at all, and PONS exposes
 * no registry mapping token -> curve.
 *
 * The candidate is confirmed by checking its bytecode carries the curve's own
 * selectors, so an ordinary airdrop-style mint can never be mistaken for one.
 */
export async function findCurveForToken(token: string): Promise<Address | null> {
  const key = token.toLowerCase();
  const cached = _curveCache.get(key);
  if (cached !== undefined) return cached;

  let found: Address | null = null;
  try {
    const client = getPublicClient();
    const logs = await withTimeout(
      client.getLogs({
        address: getAddress(token),
        event: TRANSFER_EVENT,
        args: { from: '0x0000000000000000000000000000000000000000' as Address },
        fromBlock: 0n,
        toBlock: 'latest',
      }),
      FEE_SCAN_TIMEOUT_MS,
      'getLogs(mint)',
    );
    for (const log of logs) {
      const to = (log.args as { to?: Address }).to;
      if (!to) continue;
      const code = await client.getCode({ address: to }).catch(() => undefined);
      if (!code || code === '0x') continue;
      // setCreatorFeeRecipient(address) + token() — the curve's fingerprint.
      if (code.includes('7b04ea62') && code.includes('fc0c546a')) {
        found = getAddress(to);
        break;
      }
    }
  } catch {
    // Leave it unresolved rather than caching a wrong answer; the caller
    // reports 'unverifiable' and the next sweep retries.
    return null;
  }

  _curveCache.set(key, found);
  return found;
}

async function scanPoolCredits(
  token: string,
  poolWallet: string,
  sources: Address[],
): Promise<CreditScan> {
  if (sources.length === 0) {
    return {
      readable: false,
      credited: false,
      detail: 'could not resolve this coin’s PONS curve — fee credits cannot be attributed yet',
    };
  }

  const client = getPublicClient();
  const pool = getAddress(poolWallet);

  let head: bigint;
  try {
    head = await withTimeout(client.getBlockNumber(), FEE_SCAN_TIMEOUT_MS, 'getBlockNumber');
  } catch (err) {
    return { readable: false, credited: false, detail: `RPC unreachable: ${(err as Error).message}` };
  }

  const span = feeScanBlocks();
  const fromBlock = head > span ? head - span : 0n;

  // One query per pool, settled independently so a single provider refusal
  // does not discard the answers that did come back.
  const scans = await Promise.allSettled(
    sources.map((src) =>
      withTimeout(
        client.getLogs({ event: TRANSFER_EVENT, args: { from: src, to: pool }, fromBlock, toBlock: head }),
        FEE_SCAN_TIMEOUT_MS,
        `getLogs(${src})`,
      ),
    ),
  );

  let readable = false;
  let hits = 0;
  for (const s of scans) {
    if (s.status === 'fulfilled') {
      readable = true;
      hits += s.value.length;
    } else {
      console.warn(`${LOG_PREFIX} fee-share log scan failed: ${(s.reason as Error)?.message}`);
    }
  }

  if (hits > 0) {
    return {
      readable,
      credited: true,
      detail: `${hits} fee credit(s) from this coin's PONS pool to the pool wallet in blocks ${fromBlock}–${head}`,
    };
  }
  return readable
    ? { readable, credited: false, detail: `no fee credit to the pool wallet in blocks ${fromBlock}–${head}` }
    : { readable, credited: false, detail: 'the chain could not be read over the scan window' };
}

/**
 * Gate a coin for listing: it must be a real launchpad token whose PONS creator
 * fees demonstrably reach `poolWallet`.
 *
 * Never reports 'verified' on absent evidence — an unreadable chain or an
 * inconclusive window is 'unverifiable', which callers must treat as a soft no.
 */
export async function verifyCreatorFeeShare(
  token: string,
  poolWallet: string,
): Promise<CreatorFeeResult> {
  const base = { token: null as TokenInfo | null, launchpad: null as string | null, poolWallet, graduated: false };

  if (!isValidAddress(token)) {
    return { ...base, status: 'not_found', detail: `${token} is not a Robinhood Chain address.` };
  }
  if (!isValidAddress(poolWallet)) {
    return { ...base, status: 'unverifiable', detail: 'Pool wallet is not a valid address.' };
  }

  const info = await getTokenInfo(token);
  if (!info) {
    return { ...base, status: 'not_found', detail: 'No token at this address on Robinhood Chain.' };
  }

  const pools = await fetchTokenPools(token);
  if (pools === null) {
    return { ...base, token: info, status: 'unverifiable', detail: 'Market data is unavailable right now.' };
  }

  const dexes = pools.map((p) => p.dex).filter((d): d is string => !!d);
  const launchpad =
    dexes.find((d) => isPonsDex(d)) ?? dexes.find((d) => isLaunchpadToken(token, d)) ?? null;
  // PONS graduates into Uniswap V4; a pool on any non-launchpad venue means it left the curve.
  const graduated = dexes.some((d) => !isPonsDex(d) && !isLaunchpadToken(token, d));

  if (!launchpad) {
    return {
      ...base,
      token: info,
      graduated,
      status: 'not_launchpad_token',
      detail: dexes.length
        ? `Only trades on ${[...new Set(dexes)].join(', ')} — no launchpad pool.`
        : 'No indexed pool for this token.',
    };
  }
  info.launchpad = launchpad;

  // Fee credits are attributed to the coin's own PONS bonding curve — the
  // contract that charges the 1% and pays the creator's slice out.
  //
  // Pool ids are NOT usable here: PONS graduates into Uniswap V4, whose pools
  // are 32-byte poolIds rather than contracts, so filtering them for a valid
  // address discarded every source and left the gate permanently unverifiable.
  const curve = await findCurveForToken(token);
  const sources = curve ? [curve] : [];

  const scan = await scanPoolCredits(token, poolWallet, sources);
  const result: CreatorFeeResult = {
    token: info,
    launchpad,
    poolWallet: getAddress(poolWallet),
    graduated,
    status: scan.credited ? 'verified' : scan.readable ? 'not_redirected' : 'unverifiable',
    detail: scan.detail,
  };
  console.log(
    `${LOG_PREFIX} creator-fee gate ${token.slice(0, 10)}… → ${result.status} (${launchpad}): ${scan.detail}`,
  );
  return result;
}

// ── Prices ───────────────────────────────────────────────────
export interface TokenPrice {
  address: string;
  priceUsd: number;
}

export async function getUsdPrices(addresses: string[]): Promise<Map<string, TokenPrice>> {
  const out = new Map<string, TokenPrice>();
  if (addresses.length === 0) return out;
  try {
    for (let i = 0; i < addresses.length; i += 30) {
      const batch = addresses.slice(i, i + 30);
      const res = await fetch(
        `${gtBase()}/simple/networks/${GT_NETWORK}/token_price/${batch.join(",")}`,
        { headers: gtHeaders() },
      );
      if (!res.ok) continue;
      const j = (await res.json()) as any;
      const prices = j?.data?.attributes?.token_prices ?? {};
      for (const [addr, p] of Object.entries(prices)) {
        const n = Number(p);
        if (Number.isFinite(n)) out.set(getAddress(addr), { address: getAddress(addr), priceUsd: n });
      }
    }
  } catch {
    // price feed is best-effort — callers handle an empty map
  }
  return out;
}

let _ethUsdCache: { v: number; at: number } | null = null;

/** ETH/USD, cached for 30s. Falls back to the last good value on failure. */
export async function getEthUsd(): Promise<number> {
  if (_ethUsdCache && Date.now() - _ethUsdCache.at < 30_000) return _ethUsdCache.v;
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { headers: gtHeaders() },
    );
    if (res.ok) {
      const j = (await res.json()) as any;
      const v = Number(j?.ethereum?.usd);
      if (Number.isFinite(v) && v > 0) {
        _ethUsdCache = { v, at: Date.now() };
        return v;
      }
    }
  } catch {
    // fall through
  }
  return _ethUsdCache?.v ?? 0;
}
