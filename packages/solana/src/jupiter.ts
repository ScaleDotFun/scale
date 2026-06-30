// ──────────────────────────────────────────────
// FRONT PROTOCOL — Jupiter Swap Integration
// ──────────────────────────────────────────────

import {
  type Keypair,
  VersionedTransaction,
} from '@solana/web3.js';
import { createJupiterApiClient, type QuoteResponse } from '@jup-ag/api';
import { getConnection } from './connection.js';

const LOG_PREFIX = '[solana:jupiter]';

/** Wrapped SOL mint address */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Default Jupiter API base URL */
const DEFAULT_JUPITER_API_URL = 'https://api.jup.ag';

/** Max retries for swap execution */
const MAX_RETRIES = 2;

/** Create a configured Jupiter API client */
export function createJupiterClient() {
  const basePath = process.env.JUPITER_API_URL ?? DEFAULT_JUPITER_API_URL;

  console.log(`${LOG_PREFIX} Creating Jupiter client → ${basePath}`);

  const client = createJupiterApiClient({ basePath });
  return client;
}

/** Result of a swap execution */
export interface SwapResult {
  /** Transaction signature */
  txSignature: string;
  /** Amount of output tokens received (in smallest unit) */
  outputAmount: bigint;
}

/**
 * Get a swap quote from Jupiter without executing.
 *
 * @param inputMint - Input token mint address
 * @param outputMint - Output token mint address
 * @param amount - Amount of input token (in smallest unit, as string)
 * @param slippageBps - Slippage tolerance in basis points
 * @returns Quote response from Jupiter, or null on failure
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number,
): Promise<QuoteResponse | null> {
  try {
    const client = createJupiterClient();

    console.log(
      `${LOG_PREFIX} Getting quote: ${inputMint.substring(0, 8)}… → ${outputMint.substring(0, 8)}… amount=${amount} slippage=${slippageBps}bps`,
    );

    const quote = await client.quoteGet({
      inputMint,
      outputMint,
      amount,
      slippageBps,
      swapMode: 'ExactIn',
    });

    console.log(
      `${LOG_PREFIX} Quote received: inAmount=${quote.inAmount} outAmount=${quote.outAmount} priceImpact=${quote.priceImpactPct}`,
    );

    return quote;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to get quote: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Execute a swap by obtaining a quote, building the transaction, signing, and sending.
 *
 * @param inputMint - Input token mint address
 * @param outputMint - Output token mint address
 * @param amount - Amount of input token (in smallest unit)
 * @param slippageBps - Slippage tolerance in basis points
 * @param payerKeypair - Keypair to sign and pay for the transaction
 * @returns Swap result with tx signature and output amount
 */
async function executeSwap(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  slippageBps: number,
  payerKeypair: Keypair,
): Promise<SwapResult> {
  const client = createJupiterClient();
  const connection = getConnection();

  // 1. Get quote
  const quote = await client.quoteGet({
    inputMint,
    outputMint,
    amount: Number(amount),
    slippageBps,
  });

  console.log(
    `${LOG_PREFIX} Swap quote: in=${quote.inAmount} out=${quote.outAmount} impact=${quote.priceImpactPct}%`,
  );

  // Price impact guard — reject swaps that move the market too much
  const priceImpact = parseFloat(quote.priceImpactPct);
  if (priceImpact > 5) {
    throw new Error(
      `Price impact too high: ${priceImpact.toFixed(2)}%. Maximum allowed is 5%. ` +
      `Try a smaller position size or pick a token with more liquidity.`,
    );
  }

  // 2. Get serialized swap transaction
  const swapResponse = await client.swapPost({
    swapRequest: {
      quoteResponse: quote,
      userPublicKey: payerKeypair.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: 'high',
          maxLamports: 1_000_000,
        },
      },
    },
  });

  // 3. Deserialize and sign the transaction
  const swapTransactionBuf = Buffer.from(
    swapResponse.swapTransaction,
    'base64',
  );
  const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
  transaction.sign([payerKeypair]);

  // 4. Send with retries
  let txSignature: string | undefined;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const rawTransaction = transaction.serialize();

      txSignature = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2,
      });

      console.log(
        `${LOG_PREFIX} Transaction sent: ${txSignature} (attempt ${attempt + 1})`,
      );

      // Wait for confirmation
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const confirmation = await connection.confirmTransaction(
        {
          signature: txSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed',
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction confirmed with error: ${JSON.stringify(confirmation.value.err)}`,
        );
      }

      console.log(`${LOG_PREFIX} Transaction confirmed: ${txSignature}`);

      return {
        txSignature,
        outputAmount: BigInt(quote.outAmount),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `${LOG_PREFIX} Swap attempt ${attempt + 1} failed: ${lastError.message}`,
      );

      if (attempt < MAX_RETRIES) {
        // Brief backoff before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw new Error(
    `${LOG_PREFIX} Swap failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
  );
}

/**
 * Buy a token with SOL via Jupiter.
 *
 * @param amountLamports - Amount of SOL to spend (in lamports)
 * @param tokenMint - Mint address of the token to buy
 * @param slippageBps - Slippage tolerance in basis points (e.g. 100 = 1%)
 * @param payerKeypair - Keypair that holds the SOL and signs the transaction
 * @returns Transaction signature and number of tokens received
 */
export async function swapSolToToken(
  amountLamports: bigint,
  tokenMint: string,
  slippageBps: number,
  payerKeypair: Keypair,
): Promise<{ txSignature: string; tokensReceived: bigint }> {
  console.log(
    `${LOG_PREFIX} Swapping ${amountLamports} lamports → ${tokenMint.substring(0, 8)}… (slippage ${slippageBps}bps)`,
  );

  const result = await executeSwap(
    SOL_MINT,
    tokenMint,
    amountLamports,
    slippageBps,
    payerKeypair,
  );

  console.log(
    `${LOG_PREFIX} Swap complete: received ${result.outputAmount} tokens, tx=${result.txSignature}`,
  );

  return {
    txSignature: result.txSignature,
    tokensReceived: result.outputAmount,
  };
}

/**
 * Sell a token for SOL via Jupiter.
 *
 * @param tokenMint - Mint address of the token to sell
 * @param amountTokens - Amount of tokens to sell (in smallest unit)
 * @param slippageBps - Slippage tolerance in basis points
 * @param payerKeypair - Keypair that holds the tokens and signs the transaction
 * @returns Transaction signature and SOL received (in lamports)
 */
export async function swapTokenToSol(
  tokenMint: string,
  amountTokens: bigint,
  slippageBps: number,
  payerKeypair: Keypair,
): Promise<{ txSignature: string; solReceived: bigint }> {
  console.log(
    `${LOG_PREFIX} Swapping ${amountTokens} of ${tokenMint.substring(0, 8)}… → SOL (slippage ${slippageBps}bps)`,
  );

  const result = await executeSwap(
    tokenMint,
    SOL_MINT,
    amountTokens,
    slippageBps,
    payerKeypair,
  );

  console.log(
    `${LOG_PREFIX} Swap complete: received ${result.outputAmount} lamports, tx=${result.txSignature}`,
  );

  return {
    txSignature: result.txSignature,
    solReceived: result.outputAmount,
  };
}
