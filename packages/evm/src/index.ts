// ──────────────────────────────────────────────
// SCALE PROTOCOL — Robinhood Chain execution layer (viem)
//
// Robinhood Chain: Arbitrum Orbit L2, chain id 4663, ETH gas.
// DEX: canonical Uniswap V3 (GeckoTerminal dex `uniswap-v3-robinhood`).
// Contract addresses below were verified on-chain in this repo's
// migration work: the trending pools' factory() matches the routers'
// factory(), and SwapRouter02.WETH9() matches the WETH documented at
// docs.robinhood.com/chain/contracts.
// ──────────────────────────────────────────────

import crypto from 'node:crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  encodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey, type PrivateKeyAccount } from 'viem/accounts';

const LOG_PREFIX = '[evm]';

// ── Chain ────────────────────────────────────────────────────
export const ROBINHOOD_RPC =
  process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC] } },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

// ── Canonical contracts (verified on-chain — see header) ────
export const CONTRACTS = {
  WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address,
  UNIV3_FACTORY: '0x1f7D7550B1B028f7571e69A784071F0205fd2EfA' as Address,
  SWAP_ROUTER_02: '0xCaf681a66D020601342297493863E78C959E5cb2' as Address,
} as const;

/** Noxa launches pools at the 1% fee tier. */
export const NOXA_FEE_TIER = 10_000;

// ── Noxa launchpad contracts (Robinhood Chain) ───────────────
// Extracted from Noxa's own frontend chain config and verified live
// on-chain (getLaunchedToken/feeRouting reads succeed for real
// launches like CASHCAT and return exists:false for non-Noxa tokens).
export const NOXA = {
  LAUNCH_FACTORY: '0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB' as Address,
  LAUNCH_LOCKER: '0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85' as Address,
  FEE_ROUTER: '0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417' as Address,
} as const;

export const explorerTxUrl = (hash: string) =>
  `https://robinhoodchain.blockscout.com/tx/${hash}`;
export const explorerAddressUrl = (addr: string) =>
  `https://robinhoodchain.blockscout.com/address/${addr}`;

// ── Clients ──────────────────────────────────────────────────
let _publicClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({ chain: robinhoodChain, transport: http(ROBINHOOD_RPC) });
    console.log(`${LOG_PREFIX} public client → chain ${robinhoodChain.id} rpc=${ROBINHOOD_RPC.slice(0, 40)}…`);
  }
  return _publicClient;
}

function walletClientFor(account: PrivateKeyAccount) {
  return createWalletClient({ account, chain: robinhoodChain, transport: http(ROBINHOOD_RPC) });
}

// ── Key encryption (AES-256-GCM, same format as the legacy layer:
//    iv:authTag:ciphertext hex — existing ENCRYPTION_KEY works) ──
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error(`${LOG_PREFIX} ENCRYPTION_KEY env var is not set`);
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error(`${LOG_PREFIX} ENCRYPTION_KEY must be 32 bytes (64 hex chars)`);
  return key;
}

export function encryptPrivateKey(privateKey: Hex): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(privateKey, 'utf8')), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPrivateKey(encrypted: string): Hex {
  const key = getEncryptionKey();
  const [ivHex, tagHex, dataHex] = encrypted.split(':') as [string, string, string];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const out = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return out.toString('utf8') as Hex;
}

// ── Wallets ──────────────────────────────────────────────────
export interface CustodialWallet {
  address: Address;
  encryptedPrivateKey: string;
}

/** Generate a fresh custodial EVM wallet, private key AES-encrypted. */
export function generateCustodialWallet(): CustodialWallet {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  return { address: account.address, encryptedPrivateKey: encryptPrivateKey(pk) };
}

export function loadCustodialWallet(encryptedKey: string): PrivateKeyAccount {
  return privateKeyToAccount(decryptPrivateKey(encryptedKey));
}

let _protocolAccount: PrivateKeyAccount | null = null;

/**
 * Protocol pool wallet from PROTOCOL_WALLET_PRIVATE_KEY (0x-prefixed
 * 32-byte hex — an EVM key). A leftover Solana base58 key fails with
 * a clear message instead of silently deriving garbage.
 */
export function getProtocolAccount(): PrivateKeyAccount {
  if (_protocolAccount) return _protocolAccount;
  const raw = (process.env.PROTOCOL_WALLET_PRIVATE_KEY || '').trim();
  if (!raw) throw new Error(`${LOG_PREFIX} PROTOCOL_WALLET_PRIVATE_KEY is not set`);
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `${LOG_PREFIX} PROTOCOL_WALLET_PRIVATE_KEY is not an EVM key (need 0x + 64 hex). ` +
      `A Solana base58 key cannot be used on Robinhood Chain — generate an EVM key.`,
    );
  }
  _protocolAccount = privateKeyToAccount(hex as Hex);
  console.log(`${LOG_PREFIX} protocol wallet: ${_protocolAccount.address}`);
  return _protocolAccount;
}

/** True when a valid EVM protocol key is configured. */
export function hasEvmProtocolKey(): boolean {
  const raw = (process.env.PROTOCOL_WALLET_PRIVATE_KEY || '').trim();
  const hex = raw.startsWith('0x') ? raw : `0x${raw}`;
  return /^0x[0-9a-fA-F]{64}$/.test(hex);
}

// ── Balances & transfers ─────────────────────────────────────
export async function getEthBalance(address: string): Promise<bigint> {
  return getPublicClient().getBalance({ address: address as Address });
}

export async function transferEth(
  from: PrivateKeyAccount,
  to: string,
  amountWei: bigint,
): Promise<string> {
  const wallet = walletClientFor(from);
  const hash = await wallet.sendTransaction({ to: to as Address, value: amountWei });
  await getPublicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  return hash;
}

// ── ERC-20 ───────────────────────────────────────────────────
const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

/** Canonical EVM burn sink — tokens sent here are irrecoverable. */
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

export async function erc20Transfer(
  from: PrivateKeyAccount,
  token: string,
  to: string,
  amount: bigint,
): Promise<string> {
  const wallet = walletClientFor(from);
  const hash = await wallet.writeContract({
    address: token as Address, abi: erc20Abi, functionName: 'transfer',
    args: [to as Address, amount],
  });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`${LOG_PREFIX} ERC-20 transfer reverted: ${hash}`);
  return hash;
}

export async function erc20Balance(token: string, owner: string): Promise<bigint> {
  return getPublicClient().readContract({
    address: token as Address, abi: erc20Abi, functionName: 'balanceOf', args: [owner as Address],
  });
}

export async function erc20Decimals(token: string): Promise<number> {
  return getPublicClient().readContract({
    address: token as Address, abi: erc20Abi, functionName: 'decimals',
  });
}

export async function erc20TotalSupply(token: string): Promise<bigint> {
  return getPublicClient().readContract({
    address: token as Address, abi: erc20Abi, functionName: 'totalSupply',
  });
}

// ── Uniswap V3 swaps (SwapRouter02) ──────────────────────────
const routerAbi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
]);

const wethAbi = parseAbi([
  'function withdraw(uint256 wad)',
  'function deposit() payable',
]);

export interface SwapResult {
  txHash: string;
  amountOut: bigint;
}

/**
 * Buy `token` with native ETH via SwapRouter02 (router wraps ETH).
 * amountOutMinimum comes from the caller's price source + slippage.
 */
export async function swapEthForToken(
  account: PrivateKeyAccount,
  token: string,
  amountInWei: bigint,
  minOut: bigint,
  feeTier = NOXA_FEE_TIER,
): Promise<SwapResult> {
  const client = getPublicClient();
  const before = await erc20Balance(token, account.address);

  const wallet = walletClientFor(account);
  const hash = await wallet.sendTransaction({
    to: CONTRACTS.SWAP_ROUTER_02,
    value: amountInWei,
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: CONTRACTS.WETH,
        tokenOut: token as Address,
        fee: feeTier,
        recipient: account.address,
        amountIn: amountInWei,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }],
    }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error(`${LOG_PREFIX} buy swap reverted: ${hash}`);

  const after = await erc20Balance(token, account.address);
  return { txHash: hash, amountOut: after - before };
}

/**
 * Sell `token` back to native ETH: approve → swap to WETH → unwrap.
 */
export async function swapTokenForEth(
  account: PrivateKeyAccount,
  token: string,
  amountIn: bigint,
  minOutWei: bigint,
  feeTier = NOXA_FEE_TIER,
): Promise<SwapResult> {
  const client = getPublicClient();
  const wallet = walletClientFor(account);

  // 1. approve router
  const allowance = await client.readContract({
    address: token as Address, abi: erc20Abi, functionName: 'allowance',
    args: [account.address, CONTRACTS.SWAP_ROUTER_02],
  });
  if (allowance < amountIn) {
    const approveHash = await wallet.writeContract({
      address: token as Address, abi: erc20Abi, functionName: 'approve',
      args: [CONTRACTS.SWAP_ROUTER_02, amountIn],
    });
    await client.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 });
  }

  // 2. swap token → WETH
  const wethBefore = await erc20Balance(CONTRACTS.WETH, account.address);
  const swapHash = await wallet.writeContract({
    address: CONTRACTS.SWAP_ROUTER_02,
    abi: routerAbi,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: token as Address,
      tokenOut: CONTRACTS.WETH,
      fee: feeTier,
      recipient: account.address,
      amountIn,
      amountOutMinimum: minOutWei,
      sqrtPriceLimitX96: 0n,
    }],
  });
  const receipt = await client.waitForTransactionReceipt({ hash: swapHash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error(`${LOG_PREFIX} sell swap reverted: ${swapHash}`);
  const wethAfter = await erc20Balance(CONTRACTS.WETH, account.address);
  const got = wethAfter - wethBefore;

  // 3. unwrap WETH → ETH
  if (got > 0n) {
    const unwrapHash = await wallet.writeContract({
      address: CONTRACTS.WETH, abi: wethAbi, functionName: 'withdraw', args: [got],
    });
    await client.waitForTransactionReceipt({ hash: unwrapHash, timeout: 60_000 });
  }

  return { txHash: swapHash, amountOut: got };
}

// ── Noxa launchpad reads (fee-redirect verification) ─────────
const noxaFactoryAbi = parseAbi([
  'struct LaunchedToken { address token; address deployer; address pairedToken; address positionManager; uint256 positionId; uint256 dexId; uint256 launchConfigId; uint256 restrictionsEndBlock; uint256 supply; bool isToken0; uint24 poolFee; bool exists; uint256 initialBuyAmount; }',
  'function getLaunchedToken(address token) view returns (LaunchedToken)',
]);

const noxaFeeRouterAbi = parseAbi([
  'function feeRouting(address token) view returns ((uint256 protocolShare, address[] receivers, uint8[] percents, bool overridden) routing)',
]);

export interface NoxaLaunch {
  exists: boolean;
  deployer: string;
  poolFee: number;
  positionId: bigint;
}

/** Launch record from Noxa's factory — exists:false for non-Noxa tokens. */
export async function noxaLaunchedToken(token: string): Promise<NoxaLaunch> {
  const r = await getPublicClient().readContract({
    address: NOXA.LAUNCH_FACTORY, abi: noxaFactoryAbi,
    functionName: 'getLaunchedToken', args: [token as Address],
  });
  return { exists: r.exists, deployer: r.deployer, poolFee: r.poolFee, positionId: r.positionId };
}

export interface NoxaFeeRouting {
  protocolShare: bigint;
  receivers: string[];
  percents: number[];
  /** false + zero-address receiver = creator never configured routing */
  overridden: boolean;
}

/** Effective creator-fee routing for a token, straight from Noxa's FeeRouter. */
export async function noxaFeeRouting(token: string): Promise<NoxaFeeRouting> {
  const r = await getPublicClient().readContract({
    address: NOXA.FEE_ROUTER, abi: noxaFeeRouterAbi,
    functionName: 'feeRouting', args: [token as Address],
  });
  return {
    protocolShare: r.protocolShare,
    receivers: [...r.receivers],
    percents: [...r.percents],
    overridden: r.overridden,
  };
}

export type NoxaVerifyStatus =
  | 'verified'          // wallet receives ≥ minPct of the creator fee share
  | 'partial'           // wallet is a receiver but below minPct
  | 'not_redirected'    // routing exists but wallet isn't a receiver
  | 'not_configured'    // creator never set fee routing
  | 'not_noxa_token';   // token wasn't launched via Noxa

export interface NoxaVerifyResult {
  status: NoxaVerifyStatus;
  /** percent of the creator fee share routed to `wallet` (0-100) */
  walletPct: number;
  /** current receivers with their percents, for actionable errors */
  receivers: Array<{ address: string; pct: number }>;
  deployer: string | null;
}

/**
 * The real anti-fake gate: verifies on-chain that `token` is a genuine
 * Noxa launch AND that its creator-fee routing sends at least `minPct`
 * percent of the creator share to `wallet`. Reads Noxa's own contracts —
 * nothing self-reported, nothing faked.
 */
export async function verifyNoxaFeeRedirect(
  token: string,
  wallet: string,
  minPct = 51,
): Promise<NoxaVerifyResult> {
  const launch = await noxaLaunchedToken(token);
  if (!launch.exists) {
    return { status: 'not_noxa_token', walletPct: 0, receivers: [], deployer: null };
  }

  const routing = await noxaFeeRouting(token);
  const receivers = routing.receivers.map((address, i) => ({
    address,
    pct: routing.percents[i] ?? 0,
  }));

  const zero = '0x0000000000000000000000000000000000000000';
  const configured = routing.overridden ||
    receivers.some((r) => r.address.toLowerCase() !== zero);
  if (!configured) {
    return { status: 'not_configured', walletPct: 0, receivers: [], deployer: launch.deployer };
  }

  const walletPct = receivers
    .filter((r) => r.address.toLowerCase() === wallet.toLowerCase())
    .reduce((sum, r) => sum + r.pct, 0);

  const real = receivers.filter((r) => r.address.toLowerCase() !== zero);
  if (walletPct >= minPct) {
    return { status: 'verified', walletPct, receivers: real, deployer: launch.deployer };
  }
  if (walletPct > 0) {
    return { status: 'partial', walletPct, receivers: real, deployer: launch.deployer };
  }
  return { status: 'not_redirected', walletPct: 0, receivers: real, deployer: launch.deployer };
}
