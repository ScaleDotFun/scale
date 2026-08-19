// ──────────────────────────────────────────────
// SCALE PROTOCOL — Environment Variable Validation
// ──────────────────────────────────────────────
//
// Validates required environment variables at startup.
// Fails fast with a clear error if critical vars are missing.
//

const LOG_PREFIX = '[env]';

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
  sensitive?: boolean;
}

const ENV_VARS: EnvVar[] = [
  // Database
  { name: 'DATABASE_URL', required: true, description: 'PostgreSQL connection string', sensitive: true },
  { name: 'REDIS_URL', required: true, description: 'Redis connection string', sensitive: true },

  // Auth
  { name: 'JWT_SECRET', required: true, description: 'JWT signing secret', sensitive: true },

  // Solana
  { name: 'SOLANA_RPC_URL', required: false, description: 'Solana RPC endpoint (defaults to the public mainnet-beta RPC)' },
  { name: 'PROTOCOL_WALLET_PRIVATE_KEY', required: false, description: 'Protocol pool wallet private key — trading disabled until set', sensitive: true },
  { name: 'PROTOCOL_WALLET', required: false, description: 'Protocol pool wallet public address (read-only fallback) — trading disabled until the private key is set' },

  // Token
  { name: 'SCALE_TOKEN_MINT', required: false, description: '$SCALE token mint address' },

  // External APIs
  { name: 'JUPITER_API_URL', required: false, description: 'Jupiter API base URL (defaults to the public lite endpoint)' },
  { name: 'JUPITER_API_KEY', required: false, description: 'Jupiter API key for higher rate limits', sensitive: true },
  { name: 'FEE_WALLET', required: false, description: 'Fee wallet address for protocol revenue' },

  // Telegram
  { name: 'TELEGRAM_BOT_TOKEN', required: false, description: 'Telegram bot token', sensitive: true },

  // Server
  { name: 'API_PORT', required: false, description: 'API server port (default: 3001)' },
  { name: 'API_URL', required: false, description: 'API base URL' },

  // Google OAuth
  { name: 'GOOGLE_CLIENT_ID', required: false, description: 'Google OAuth client ID' },

  // Encryption
  { name: 'ENCRYPTION_KEY', required: false, description: 'Encryption key for bot wallets', sensitive: true },
];

/**
 * Validate all environment variables at startup.
 * Throws if any required vars are missing.
 */
export function validateEnv(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of ENV_VARS) {
    const value = process.env[v.name];

    if (v.required && !value) {
      missing.push(`  ✗ ${v.name} — ${v.description}`);
    } else if (!v.required && !value) {
      warnings.push(`  ⚠ ${v.name} — ${v.description} (optional, not set)`);
    } else {
      // Mask sensitive values in log
      const display = v.sensitive
        ? `${value!.substring(0, 4)}${'*'.repeat(Math.max(0, value!.length - 4))}`
        : value;
      console.log(`${LOG_PREFIX} ✓ ${v.name} = ${display}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(`${LOG_PREFIX} Optional vars not set:`);
    warnings.forEach((w) => console.warn(w));
  }

  if (!process.env.PROTOCOL_WALLET_PRIVATE_KEY) {
    console.warn(
      `${LOG_PREFIX} ⚠ PROTOCOL_WALLET_PRIVATE_KEY is not set — trading is disabled until it is.`,
    );
  }

  if (missing.length > 0) {
    console.error(`\n${LOG_PREFIX} ❌ FATAL: Missing required environment variables:\n`);
    missing.forEach((m) => console.error(m));
    console.error(`\n${LOG_PREFIX} Set these in .env or your deployment config.\n`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} ✅ All required environment variables present`);
}
