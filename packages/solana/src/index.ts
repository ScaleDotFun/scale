// ──────────────────────────────────────────────
// FRONT PROTOCOL — Solana Package Barrel Export
// ──────────────────────────────────────────────

// Connection management
export {
  getConnection,
  getCluster,
  getCommitment,
  resetConnection,
} from './connection.js';

// Wallet management
export {
  getProtocolWallet,
  generateBotWallet,
  encryptPrivateKey,
  decryptPrivateKey,
  loadBotWallet,
  base58Decode,
  base58Encode,
} from './wallet.js';
export type { BotWalletResult } from './wallet.js';

// Jupiter swap integration
export {
  createJupiterClient,
  getSwapQuote,
  swapSolToToken,
  swapTokenToSol,
  SOL_MINT,
} from './jupiter.js';
export type { SwapResult } from './jupiter.js';

// SPL token operations
export {
  burnToken,
  transferToken,
  getTokenBalance,
  getSolBalance,
} from './token.js';

// Price feeds
export {
  getTokenPrice,
  getMultipleTokenPrices,
  getTokenMarketData,
} from './price.js';
export type { TokenPrice } from './price.js';

// Pump.fun integration
export {
  getTokenInfo,
  verifyTokenCreator,
  verifyFeeRedirect,
  isTokenBonded,
} from './pumpfun.js';
export type { PumpFunTokenInfo } from './pumpfun.js';
