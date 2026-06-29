// ──────────────────────────────────────────────
// FRONT PROTOCOL — SPL Token Operations
// ──────────────────────────────────────────────

import {
  PublicKey,
  type Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createBurnInstruction,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { getConnection } from './connection.js';

const LOG_PREFIX = '[solana:token]';

/**
 * Burn tokens from the payer's associated token account.
 *
 * @param mint - Token mint address
 * @param amount - Number of tokens to burn (in smallest unit)
 * @param payerKeypair - Keypair that owns the tokens and pays for the transaction
 * @returns Transaction signature
 */
export async function burnToken(
  mint: PublicKey,
  amount: bigint,
  payerKeypair: Keypair,
): Promise<string> {
  const connection = getConnection();

  console.log(
    `${LOG_PREFIX} Burning ${amount} tokens of ${mint.toBase58().substring(0, 8)}…`,
  );

  // Derive the associated token account for the payer
  const ata = await getAssociatedTokenAddress(
    mint,
    payerKeypair.publicKey,
  );

  // Verify the account exists and has sufficient balance
  try {
    const account = await getAccount(connection, ata);
    if (account.amount < amount) {
      throw new Error(
        `Insufficient token balance: have ${account.amount}, need ${amount}`,
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Insufficient token balance')
    ) {
      throw err;
    }
    throw new Error(
      `${LOG_PREFIX} Token account not found for ${mint.toBase58()}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Build the burn instruction
  const burnIx = createBurnInstruction(
    ata,                     // account to burn from
    mint,                    // mint
    payerKeypair.publicKey,  // owner / authority
    amount,                  // amount to burn
  );

  const transaction = new Transaction().add(burnIx);

  const txSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payerKeypair],
    { commitment: 'confirmed' },
  );

  console.log(
    `${LOG_PREFIX} Burn complete: ${amount} tokens, tx=${txSignature}`,
  );

  return txSignature;
}

/**
 * Transfer SPL tokens from the payer to a destination wallet.
 * Automatically creates the destination's associated token account if needed.
 *
 * @param mint - Token mint address
 * @param to - Destination wallet public key
 * @param amount - Number of tokens to transfer (in smallest unit)
 * @param payerKeypair - Keypair that owns the tokens and pays for the transaction
 * @returns Transaction signature
 */
export async function transferToken(
  mint: PublicKey,
  to: PublicKey,
  amount: bigint,
  payerKeypair: Keypair,
): Promise<string> {
  const connection = getConnection();

  console.log(
    `${LOG_PREFIX} Transferring ${amount} of ${mint.toBase58().substring(0, 8)}… → ${to.toBase58().substring(0, 8)}…`,
  );

  // Get or create the source ATA
  const sourceAta = await getAssociatedTokenAddress(
    mint,
    payerKeypair.publicKey,
  );

  // Verify source balance
  try {
    const sourceAccount = await getAccount(connection, sourceAta);
    if (sourceAccount.amount < amount) {
      throw new Error(
        `Insufficient token balance: have ${sourceAccount.amount}, need ${amount}`,
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes('Insufficient token balance')
    ) {
      throw err;
    }
    throw new Error(
      `${LOG_PREFIX} Source token account not found: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Get or create the destination ATA (payer funds creation if needed)
  const destAtaAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payerKeypair,         // payer for account creation
    mint,
    to,
  );

  // Build transfer instruction
  const transferIx = createTransferInstruction(
    sourceAta,               // source ATA
    destAtaAccount.address,  // destination ATA
    payerKeypair.publicKey,  // owner / authority
    amount,                  // amount
  );

  const transaction = new Transaction().add(transferIx);

  const txSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [payerKeypair],
    { commitment: 'confirmed' },
  );

  console.log(
    `${LOG_PREFIX} Transfer complete: ${amount} tokens, tx=${txSignature}`,
  );

  return txSignature;
}

/**
 * Get the SPL token balance for a wallet.
 *
 * @param wallet - Wallet public key
 * @param mint - Token mint address
 * @returns Token balance in smallest unit, or 0n if the account doesn't exist
 */
export async function getTokenBalance(
  wallet: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const connection = getConnection();

  try {
    const ata = await getAssociatedTokenAddress(mint, wallet);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    // Account doesn't exist — balance is zero
    return 0n;
  }
}

/**
 * Get the SOL balance for a wallet.
 *
 * @param wallet - Wallet public key
 * @returns SOL balance in lamports
 */
export async function getSolBalance(wallet: PublicKey): Promise<bigint> {
  const connection = getConnection();

  try {
    const balance = await connection.getBalance(wallet, 'confirmed');
    return BigInt(balance);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to get SOL balance for ${wallet.toBase58()}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0n;
  }
}
