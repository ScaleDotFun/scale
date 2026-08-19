// ──────────────────────────────────────────────
// SCALE PROTOCOL — Solana execution layer
//
// Chain: Solana mainnet. Memecoins launched on pump.fun (bonding curve
// and graduated PumpSwap/Raydium pools alike).
// Swaps + quotes: Jupiter aggregator (lite-api.jup.ag) — routes pump.fun
// bonding-curve tokens as well as graduated pools, verified live.
// Prices: Jupiter Price v3. Token metadata/discovery: Jupiter Tokens v2
// (reports `launchpad: "pump.fun"`, dev wallet, mcap, liquidity, stats).
// ──────────────────────────────────────────────

import crypto from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createBurnCheckedInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';

const LOG_PREFIX = '[solana]';

// ── Chain ────────────────────────────────────────────────────
export const SOLANA_RPC =
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/** Jupiter free tier. Set JUPITER_API_URL + JUPITER_API_KEY for the paid tier. */
export const JUPITER_API = process.env.JUPITER_API_URL || 'https://lite-api.jup.ag';

/** Wrapped SOL mint — the "native" side of every quote. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/** Canonical Solana incinerator (display/reference only — burns use the SPL burn ix). */
export const INCINERATOR = '1nc1nerator11111111111111111111111111111111';

export const explorerTxUrl = (sig: string) => `https://solscan.io/tx/${sig}`;
export const explorerAddressUrl = (addr: string) => `https://solscan.io/account/${addr}`;
export const explorerTokenUrl = (mint: string) => `https://solscan.io/token/${mint}`;

// ── Connection ───────────────────────────────────────────────
let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(SOLANA_RPC, 'confirmed');
    console.log(`${LOG_PREFIX} connection → ${SOLANA_RPC.slice(0, 40)}…`);
  }
  return _connection;
}

/** Base58 pubkey sanity check (32-byte ed25519 key). */
export function isValidSolanaAddress(addr: string): boolean {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

// ── Key encryption (AES-256-GCM, same iv:authTag:ciphertext hex
//    format as the previous layers — existing ENCRYPTION_KEY works) ──
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

/** Generate a fresh custodial Solana wallet; base58 secret key AES-encrypted. */
export function generateCustodialWallet(): CustodialWallet {
  const kp = Keypair.generate();
  const secret = bs58.encode(kp.secretKey);
  return { address: kp.publicKey.toBase58(), encryptedPrivateKey: encryptPrivateKey(secret) };
}

/** Parse a secret key in base58 (Phantom export) or JSON-array (solana-keygen) form. */
function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith('0x')) {
    throw new Error(
      `${LOG_PREFIX} got an EVM hex key — expected a Solana base58 secret key. ` +
      `Generate one with \`solana-keygen new\` or export from Phantom.`,
    );
  }
  if (trimmed.startsWith('[')) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

export function loadCustodialWallet(encryptedKey: string): Keypair {
  return keypairFromSecret(decryptPrivateKey(encryptedKey));
}

let _protocolAccount: Keypair | null = null;

/**
 * Protocol pool wallet from PROTOCOL_WALLET_PRIVATE_KEY (base58-encoded
 * 64-byte secret key, or a solana-keygen JSON array). A leftover EVM hex
 * key fails with a clear message instead of silently deriving garbage.
 */
export function getProtocolAccount(): Keypair {
  if (!_protocolAccount) {
    const raw = process.env.PROTOCOL_WALLET_PRIVATE_KEY;
    if (!raw) throw new Error(`${LOG_PREFIX} PROTOCOL_WALLET_PRIVATE_KEY env var is not set`);
    _protocolAccount = keypairFromSecret(raw);
    console.log(`${LOG_PREFIX} protocol wallet → ${_protocolAccount.publicKey.toBase58()}`);
  }
  return _protocolAccount;
}

/** True when a usable Solana protocol key is configured — the "trading enabled" gate. */
export function hasProtocolKey(): boolean {
  const raw = process.env.PROTOCOL_WALLET_PRIVATE_KEY?.trim();
  if (!raw || raw.startsWith('0x')) return false;
  try {
    keypairFromSecret(raw);
    return true;
  } catch {
    return false;
  }
}

/** Pool wallet pubkey — live key when installed, else PROTOCOL_WALLET env, else null. */
export function protocolPublicKey(): string | null {
  if (hasProtocolKey()) return getProtocolAccount().publicKey.toBase58();
  const envAddr = process.env.PROTOCOL_WALLET?.trim();
  return envAddr && isValidSolanaAddress(envAddr) ? envAddr : null;
}

// ── SOL balance & transfer ───────────────────────────────────
export async function getSolBalance(address: string): Promise<bigint> {
  const balance = await getConnection().getBalance(new PublicKey(address), 'confirmed');
  return BigInt(balance);
}

/** Transfer native SOL. Returns the transaction signature. */
export async function transferSol(from: Keypair, to: string, amountLamports: bigint): Promise<string> {
  const connection = getConnection();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(to),
      lamports: amountLamports,
    }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [from], {
    commitment: 'confirmed',
    maxRetries: 3,
  });
  console.log(`${LOG_PREFIX} transferSol ${(Number(amountLamports) / 1e9).toFixed(4)} SOL → ${to.slice(0, 8)}… ${sig.slice(0, 16)}…`);
  return sig;
}

// ── SPL tokens (legacy + Token-2022 — new pump.fun mints are 2022) ──
const mintProgramCache = new Map<string, PublicKey>();
const decimalsCache = new Map<string, number>();

/** Owning token program of a mint (TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID). */
async function getMintProgram(mint: string): Promise<PublicKey> {
  const cached = mintProgramCache.get(mint);
  if (cached) return cached;
  const info = await getConnection().getAccountInfo(new PublicKey(mint));
  if (!info) throw new Error(`${LOG_PREFIX} mint ${mint} does not exist`);
  const owner = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  mintProgramCache.set(mint, owner);
  return owner;
}

export async function splDecimals(mint: string): Promise<number> {
  const cached = decimalsCache.get(mint);
  if (cached !== undefined) return cached;
  const info = await getConnection().getParsedAccountInfo(new PublicKey(mint));
  const data = info.value?.data;
  if (!data || typeof data !== 'object' || !('parsed' in data)) {
    throw new Error(`${LOG_PREFIX} could not read mint ${mint}`);
  }
  const decimals = (data.parsed as { info: { decimals: number } }).info.decimals;
  decimalsCache.set(mint, decimals);
  return decimals;
}

export async function splTotalSupply(mint: string): Promise<bigint> {
  const supply = await getConnection().getTokenSupply(new PublicKey(mint));
  return BigInt(supply.value.amount);
}

/** Total raw balance of a mint across the owner's token accounts. */
export async function splBalance(mint: string, owner: string): Promise<bigint> {
  const accounts = await getConnection().getParsedTokenAccountsByOwner(
    new PublicKey(owner),
    { mint: new PublicKey(mint) },
  );
  let total = 0n;
  for (const { account } of accounts.value) {
    total += BigInt(account.data.parsed.info.tokenAmount.amount as string);
  }
  return total;
}

/** Transfer SPL tokens, creating the destination ATA if needed. */
export async function splTransfer(
  from: Keypair,
  mint: string,
  to: string,
  amount: bigint,
): Promise<string> {
  const connection = getConnection();
  const programId = await getMintProgram(mint);
  const decimals = await splDecimals(mint);
  const mintPk = new PublicKey(mint);
  const toPk = new PublicKey(to);
  const fromAta = getAssociatedTokenAddressSync(mintPk, from.publicKey, true, programId);
  const toAta = getAssociatedTokenAddressSync(mintPk, toPk, true, programId);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(from.publicKey, toAta, toPk, mintPk, programId),
    createTransferCheckedInstruction(fromAta, mintPk, toAta, from.publicKey, amount, decimals, [], programId),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [from], {
    commitment: 'confirmed',
    maxRetries: 3,
  });
  console.log(`${LOG_PREFIX} splTransfer ${amount} of ${mint.slice(0, 8)}… → ${to.slice(0, 8)}… ${sig.slice(0, 16)}…`);
  return sig;
}

/** Burn SPL tokens from the holder's own ATA (true supply burn, not a dead-address park). */
export async function splBurn(from: Keypair, mint: string, amount: bigint): Promise<string> {
  const connection = getConnection();
  const programId = await getMintProgram(mint);
  const decimals = await splDecimals(mint);
  const mintPk = new PublicKey(mint);
  const ata = getAssociatedTokenAddressSync(mintPk, from.publicKey, true, programId);

  const tx = new Transaction().add(
    createBurnCheckedInstruction(ata, mintPk, from.publicKey, amount, decimals, [], programId),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [from], {
    commitment: 'confirmed',
    maxRetries: 3,
  });
  console.log(`${LOG_PREFIX} splBurn ${amount} of ${mint.slice(0, 8)}… ${sig.slice(0, 16)}…`);
  return sig;
}

// ── Jupiter quotes & swaps ───────────────────────────────────
export interface SwapResult {
  txHash: string;      // base58 transaction signature
  amountOut: bigint;   // raw units actually received (balance delta)
}

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: Array<{ swapInfo: { label: string } }>;
  [key: string]: unknown;
}

async function jupFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  const apiKey = process.env.JUPITER_API_KEY;
  if (apiKey) headers['x-api-key'] = apiKey;
  return fetch(`${JUPITER_API}${path}`, { ...init, headers });
}

/** On-route quote from Jupiter — works for bonding-curve and graduated pump.fun tokens alike. */
export async function jupiterQuote(
  inputMint: string,
  outputMint: string,
  amountIn: bigint,
  slippageBps = 300,
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountIn.toString(),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: 'true',
  });
  const res = await jupFetch(`/swap/v1/quote?${params}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${LOG_PREFIX} quote ${inputMint.slice(0, 6)}→${outputMint.slice(0, 6)} failed ${res.status}: ${body.slice(0, 180)}`);
  }
  return (await res.json()) as JupiterQuote;
}

/** Expected output amount for an exact-in swap (compat helper). */
export async function quoteExactInput(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<bigint> {
  const quote = await jupiterQuote(tokenIn, tokenOut, amountIn);
  return BigInt(quote.outAmount);
}

/** Build, sign, send and confirm a Jupiter swap for the given quote. */
async function executeJupiterSwap(account: Keypair, quote: JupiterQuote): Promise<string> {
  const connection = getConnection();
  const res = await jupFetch('/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: account.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: 'high' },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${LOG_PREFIX} swap build failed ${res.status}: ${body.slice(0, 180)}`);
  }
  const { swapTransaction } = (await res.json()) as { swapTransaction: string };

  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
  tx.sign([account]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  const latest = await connection.getLatestBlockhash('confirmed');
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(`${LOG_PREFIX} swap ${sig.slice(0, 16)}… failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

/**
 * Market-buy a token with native SOL via Jupiter.
 * amountOut is measured as the actual token balance delta.
 */
export async function swapSolForToken(
  account: Keypair,
  tokenMint: string,
  amountInLamports: bigint,
  slippageBps = 300,
): Promise<SwapResult> {
  const owner = account.publicKey.toBase58();
  const before = await splBalance(tokenMint, owner);
  const quote = await jupiterQuote(WSOL_MINT, tokenMint, amountInLamports, slippageBps);
  const sig = await executeJupiterSwap(account, quote);
  const after = await splBalance(tokenMint, owner);
  const amountOut = after - before;
  console.log(
    `${LOG_PREFIX} buy ${(Number(amountInLamports) / 1e9).toFixed(4)} SOL → ${amountOut} ${tokenMint.slice(0, 8)}… ` +
    `via ${quote.routePlan[0]?.swapInfo.label ?? '?'} ${sig.slice(0, 16)}…`,
  );
  return { txHash: sig, amountOut };
}

/**
 * Market-sell a token back to native SOL via Jupiter.
 * amountOut is the SOL lamports delta (net of the ~5k lamport tx fee).
 */
export async function swapTokenForSol(
  account: Keypair,
  tokenMint: string,
  amountIn: bigint,
  slippageBps = 300,
): Promise<SwapResult> {
  const owner = account.publicKey.toBase58();
  const before = await getSolBalance(owner);
  const quote = await jupiterQuote(tokenMint, WSOL_MINT, amountIn, slippageBps);
  const sig = await executeJupiterSwap(account, quote);
  const after = await getSolBalance(owner);
  const amountOut = after > before ? after - before : 0n;
  console.log(
    `${LOG_PREFIX} sell ${amountIn} ${tokenMint.slice(0, 8)}… → ${(Number(amountOut) / 1e9).toFixed(4)} SOL ` +
    `via ${quote.routePlan[0]?.swapInfo.label ?? '?'} ${sig.slice(0, 16)}…`,
  );
  return { txHash: sig, amountOut };
}

// ── pump.fun token info & listing verification (Jupiter Tokens v2) ──
export interface JupTokenInfo {
  id: string;                 // mint
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  dev?: string;               // creator wallet
  launchpad?: string;         // e.g. "pump.fun"
  graduatedPool?: string;
  graduatedAt?: string;
  holderCount?: number;
  fdv?: number;
  mcap?: number;
  usdPrice?: number;
  liquidity?: number;
  circSupply?: number;
  totalSupply?: number;
  stats24h?: {
    priceChange?: number;
    buyVolume?: number;
    sellVolume?: number;
    numBuys?: number;
    numSells?: number;
  };
  firstPool?: { id: string; createdAt: string };
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number };
  [key: string]: unknown;
}

/** Look a token up in Jupiter's token registry by mint. Null when unknown. */
export async function getJupToken(mint: string): Promise<JupTokenInfo | null> {
  const res = await jupFetch(`/tokens/v2/search?query=${encodeURIComponent(mint)}`);
  if (!res.ok) throw new Error(`${LOG_PREFIX} token lookup failed ${res.status}`);
  const tokens = (await res.json()) as JupTokenInfo[];
  return tokens.find((t) => t.id === mint) ?? null;
}

/** New + trending pump.fun universe for auto-discovery. */
export async function getRecentPumpTokens(): Promise<JupTokenInfo[]> {
  const res = await jupFetch('/tokens/v2/recent');
  if (!res.ok) throw new Error(`${LOG_PREFIX} recent tokens failed ${res.status}`);
  const tokens = (await res.json()) as JupTokenInfo[];
  return tokens.filter((t) => isPumpFunToken(t.id, t.launchpad));
}

export async function getTrendingTokens(interval: '5m' | '1h' | '6h' | '24h' = '24h'): Promise<JupTokenInfo[]> {
  const res = await jupFetch(`/tokens/v2/toptrending/${interval}`);
  if (!res.ok) throw new Error(`${LOG_PREFIX} trending tokens failed ${res.status}`);
  return (await res.json()) as JupTokenInfo[];
}

function isPumpLaunchpad(launchpad?: string): boolean {
  return !!launchpad && launchpad.toLowerCase().includes('pump');
}

/**
 * Is this a pump.fun coin? Jupiter's launchpad attribution when present,
 * otherwise the pump.fun vanity-mint heuristic: every pump.fun launch
 * mints an address ending in "pump", and graduated coins keep it.
 */
export function isPumpFunToken(mint: string, launchpad?: string): boolean {
  return isPumpLaunchpad(launchpad) || mint.endsWith('pump');
}

export type PumpVerifyStatus = 'verified' | 'not_pump_token' | 'not_found';

export interface PumpVerifyResult {
  status: PumpVerifyStatus;
  /** Token creator (pump.fun dev wallet) when known. */
  creator?: string;
  launchpad?: string;
  /** True once the token graduated off the bonding curve. */
  graduated?: boolean;
  token?: JupTokenInfo;
}

/**
 * Listing gate: the token must be a genuine pump.fun launch (per Jupiter's
 * launchpad attribution). pump.fun has no third-party fee routing,
 * pump.fun has no third-party fee routing, so listing is open to any real
 * pump.fun coin and the creator share is paid to the on-chain dev wallet.
 */
export async function verifyPumpToken(mint: string): Promise<PumpVerifyResult> {
  const token = await getJupToken(mint);
  if (!token) return { status: 'not_found' };
  if (!isPumpFunToken(mint, token.launchpad)) {
    return { status: 'not_pump_token', launchpad: token.launchpad, token };
  }
  return {
    status: 'verified',
    creator: token.dev,
    launchpad: token.launchpad,
    graduated: !!token.graduatedPool || !!token.graduatedAt,
    token,
  };
}

// ── pump.fun creator-reward sharing (the listing deal) ───────
// pump.fun lets a coin's creator share their creator rewards with
// other wallets on-chain ("Share creator rewards"). SCALE's listing
// gate: the coin must share ≥ SCALE_MIN_FEE_SHARE_PCT (default 100%)
// with the protocol pool wallet — same deal the Noxa FeeRouter gate
// enforced on EVM, but on pump.fun's own fee-sharing program.

export type RewardShareStatus =
  | 'verified'        // pool wallet holds ≥ the required share
  | 'partial'         // pool wallet is a shareholder but below the bar
  | 'not_redirected'  // sharing enabled, pool wallet absent
  | 'not_configured'  // sharing never enabled (or inactive)
  | 'not_pump_token'  // not a pump.fun launch at all
  | 'not_found';      // unknown mint

export interface RewardShareResult {
  status: RewardShareStatus;
  /** Percent of creator rewards routed to the given wallet (0-100). */
  walletPct: number;
  shareholders: Array<{ address: string; pct: number }>;
  /** pump.fun dev wallet when known. */
  creator?: string;
  graduated?: boolean;
  token?: JupTokenInfo;
}

/** pump.fun fee-sharing program (verified on-chain; owns every sharing config). */
export const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

function sharingConfigPda(mint: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('sharing-config'), new PublicKey(mint).toBuffer()],
    new PublicKey(PUMP_FEE_PROGRAM_ID),
  )[0];
}

/**
 * Decode a SharingConfig account. Layout (verified against live accounts
 * and the program IDL — anchor account, 8-byte discriminator first):
 *   bump u8 · version u8 · status enum u8 (0=Paused, 1=Active) ·
 *   mint pubkey · admin pubkey · admin_revoked bool ·
 *   shareholders Vec<{ address pubkey, share_bps u16 }>
 * Hand-rolled on purpose: the pump SDK drags in @coral-xyz/anchor,
 * whose CJS/ESM interop breaks under Node 22.
 */
function decodeSharingConfig(data: Buffer): {
  active: boolean;
  shareholders: Array<{ address: string; pct: number }>;
} {
  let o = 8;
  o += 2; // bump, version
  const active = data[o] === 1;
  o += 1;
  o += 64; // mint, admin
  o += 1; // admin_revoked
  const len = data.readUInt32LE(o);
  o += 4;
  const shareholders: Array<{ address: string; pct: number }> = [];
  for (let i = 0; i < len && o + 34 <= data.length; i++) {
    const address = new PublicKey(data.subarray(o, o + 32)).toBase58();
    o += 32;
    const pct = data.readUInt16LE(o) / 100;
    o += 2;
    shareholders.push({ address, pct });
  }
  return { active, shareholders };
}

/**
 * Verify a coin's on-chain creator-reward sharing config routes at
 * least `minPct` percent to `wallet`. Composes the pump.fun launch
 * check so one call gates a listing end-to-end.
 */
export async function verifyPumpRewardShare(
  mint: string,
  wallet: string,
  minPct = 100,
): Promise<RewardShareResult> {
  const base = await verifyPumpToken(mint);
  if (base.status !== 'verified') {
    return {
      status: base.status === 'not_found' ? 'not_found' : 'not_pump_token',
      walletPct: 0,
      shareholders: [],
      creator: base.creator,
      token: base.token,
    };
  }

  const info = await getConnection().getAccountInfo(sharingConfigPda(mint));
  const common = { creator: base.creator, graduated: base.graduated, token: base.token };
  if (!info || !info.owner.toBase58 || info.owner.toBase58() !== PUMP_FEE_PROGRAM_ID) {
    return { status: 'not_configured', walletPct: 0, shareholders: [], ...common };
  }

  const cfg = decodeSharingConfig(info.data);
  if (!cfg.active) {
    return { status: 'not_configured', walletPct: 0, shareholders: [], ...common };
  }

  const walletPct = cfg.shareholders
    .filter((s) => s.address === wallet)
    .reduce((sum, s) => sum + s.pct, 0);

  const clampedMin = Math.min(100, Math.max(1, minPct));
  const status: RewardShareStatus =
    walletPct >= clampedMin ? 'verified' : walletPct > 0 ? 'partial' : 'not_redirected';
  return { status, walletPct, shareholders: cfg.shareholders, ...common };
}

// ── Prices (Jupiter Price v3) ────────────────────────────────
export interface TokenPrice {
  usdPrice: number;
  decimals: number;
  priceChange24h?: number;
}

/** Batch USD prices by mint (≤50 ids per call, batched automatically). */
export async function getUsdPrices(mints: string[]): Promise<Map<string, TokenPrice>> {
  const out = new Map<string, TokenPrice>();
  for (let i = 0; i < mints.length; i += 50) {
    const batch = mints.slice(i, i + 50);
    const res = await jupFetch(`/price/v3?ids=${batch.map(encodeURIComponent).join(',')}`);
    if (!res.ok) {
      console.warn(`${LOG_PREFIX} price batch failed ${res.status}`);
      continue;
    }
    const data = (await res.json()) as Record<string, { usdPrice: number; decimals: number; priceChange24h?: number }>;
    for (const [mint, p] of Object.entries(data)) {
      if (p && typeof p.usdPrice === 'number') {
        out.set(mint, { usdPrice: p.usdPrice, decimals: p.decimals, priceChange24h: p.priceChange24h });
      }
    }
  }
  return out;
}

let _solUsdCache: { price: number; at: number } | null = null;
const SOL_USD_TTL_MS = 60_000;

/** SOL/USD, cached 60s, stale-if-error. */
export async function getSolUsd(): Promise<number> {
  const now = Date.now();
  if (_solUsdCache && now - _solUsdCache.at < SOL_USD_TTL_MS) return _solUsdCache.price;
  try {
    const prices = await getUsdPrices([WSOL_MINT]);
    const sol = prices.get(WSOL_MINT);
    if (sol && sol.usdPrice > 0) {
      _solUsdCache = { price: sol.usdPrice, at: now };
      return sol.usdPrice;
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} getSolUsd failed: ${(err as Error).message}`);
  }
  if (_solUsdCache) return _solUsdCache.price;
  throw new Error(`${LOG_PREFIX} SOL/USD unavailable`);
}
