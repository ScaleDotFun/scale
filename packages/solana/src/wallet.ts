// ──────────────────────────────────────────────
// FRONT PROTOCOL — Wallet Management
// ──────────────────────────────────────────────

import { Keypair } from '@solana/web3.js';
import crypto from 'node:crypto';

const LOG_PREFIX = '[solana:wallet]';

/** AES-256-GCM constants */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Decode a base58-encoded string to a Uint8Array.
 * Implements standard base58 (Bitcoin alphabet) decoding.
 */
function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = BigInt(ALPHABET.length);

  let num = 0n;
  for (const char of str) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base58 character: "${char}"`);
    }
    num = num * BASE + BigInt(idx);
  }

  // Convert bigint to bytes
  const hex = num.toString(16).padStart(2, '0');
  const paddedHex = hex.length % 2 ? '0' + hex : hex;
  const bytes = Buffer.from(paddedHex, 'hex');

  // Count leading zeros (base58 '1' = 0x00)
  let leadingZeros = 0;
  for (const char of str) {
    if (char === '1') {
      leadingZeros++;
    } else {
      break;
    }
  }

  const result = new Uint8Array(leadingZeros + bytes.length);
  result.set(bytes, leadingZeros);
  return result;
}

/**
 * Encode a Uint8Array to a base58 string.
 */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const BASE = BigInt(ALPHABET.length);

  // Count leading zeros
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      leadingZeros++;
    } else {
      break;
    }
  }

  // Convert bytes to bigint
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  // Convert to base58
  let result = '';
  while (num > 0n) {
    const remainder = Number(num % BASE);
    num = num / BASE;
    result = ALPHABET[remainder] + result;
  }

  // Add leading '1's for each leading zero byte
  return '1'.repeat(leadingZeros) + result;
}

/**
 * Resolve the 32-byte encryption key from the `ENCRYPTION_KEY` environment variable.
 * The key must be a 64-character hex string representing 32 bytes.
 *
 * @throws Error if `ENCRYPTION_KEY` is not set or is not exactly 32 bytes (64 hex chars)
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      `${LOG_PREFIX} ENCRYPTION_KEY env var is not set. Required for wallet encryption.`,
    );
  }

  const keyBuffer = Buffer.from(raw, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error(
      `${LOG_PREFIX} ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars). Got ${keyBuffer.length} bytes.`,
    );
  }

  return keyBuffer;
}

/**
 * Load the protocol's main wallet from the `PROTOCOL_WALLET_PRIVATE_KEY` env var.
 * The private key must be base58 encoded (standard Solana CLI format).
 *
 * @returns The protocol's Keypair
 * @throws Error if the env var is not set or contains an invalid key
 */
export function getProtocolWallet(): Keypair {
  const raw = process.env.PROTOCOL_WALLET_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      `${LOG_PREFIX} PROTOCOL_WALLET_PRIVATE_KEY env var is not set`,
    );
  }

  try {
    const secretKey = base58Decode(raw);
    const keypair = Keypair.fromSecretKey(secretKey);
    console.log(
      `${LOG_PREFIX} Loaded protocol wallet: ${keypair.publicKey.toBase58()}`,
    );
    return keypair;
  } catch (err) {
    throw new Error(
      `${LOG_PREFIX} Failed to load protocol wallet: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Encrypt a Solana secret key using AES-256-GCM.
 *
 * Output format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * @param secretKey - The 64-byte Solana secret key to encrypt
 * @returns Encrypted string in iv:authTag:ciphertext hex format
 */
export function encryptPrivateKey(secretKey: Uint8Array): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(secretKey)),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted private key string back to a Uint8Array.
 *
 * @param encrypted - The encrypted string in `iv:authTag:ciphertext` hex format
 * @returns The decrypted 64-byte Solana secret key
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decryptPrivateKey(encrypted: string): Uint8Array {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error(
      `${LOG_PREFIX} Invalid encrypted key format. Expected iv:authTag:ciphertext`,
    );
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error(`${LOG_PREFIX} Invalid IV length: ${iv.length}, expected ${IV_LENGTH}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(
      `${LOG_PREFIX} Invalid auth tag length: ${authTag.length}, expected ${AUTH_TAG_LENGTH}`,
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return new Uint8Array(decrypted);
  } catch (err) {
    throw new Error(
      `${LOG_PREFIX} Decryption failed — wrong key or tampered data: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Result of generating a new bot wallet */
export interface BotWalletResult {
  publicKey: string;
  encryptedPrivateKey: string;
}

/**
 * Generate a new Keypair for a Telegram bot user.
 * The secret key is immediately encrypted; the raw key is never persisted.
 *
 * @returns Public key (base58) and encrypted private key
 */
export function generateBotWallet(): BotWalletResult {
  const keypair = Keypair.generate();
  const encryptedPrivateKey = encryptPrivateKey(keypair.secretKey);

  console.log(
    `${LOG_PREFIX} Generated bot wallet: ${keypair.publicKey.toBase58()}`,
  );

  return {
    publicKey: keypair.publicKey.toBase58(),
    encryptedPrivateKey,
  };
}

/**
 * Load a bot wallet from its encrypted private key.
 *
 * @param encryptedKey - The encrypted private key string
 * @returns Reconstructed Keypair
 */
export function loadBotWallet(encryptedKey: string): Keypair {
  const secretKey = decryptPrivateKey(encryptedKey);
  const keypair = Keypair.fromSecretKey(secretKey);
  console.log(
    `${LOG_PREFIX} Loaded bot wallet: ${keypair.publicKey.toBase58()}`,
  );
  return keypair;
}

export { base58Decode, base58Encode };
