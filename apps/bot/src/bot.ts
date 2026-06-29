// ──────────────────────────────────────────────
// FRONT PROTOCOL — Telegram Bot Entry Point
// ──────────────────────────────────────────────

import 'dotenv/config';
import { Bot } from 'grammy';

// ── Command handlers ──
import { handleStart } from './commands/start.js';
import { handleWallet, handleDeposit, handleWithdraw, handleBalance } from './commands/wallet.js';
import { handleApe } from './commands/ape.js';
import { handleClose, handleCloseAll } from './commands/close.js';
import { handlePositions } from './commands/positions.js';
import { handleHistory, handlePnL } from './commands/history.js';
import { handleLocks } from './commands/locks.js';
import { handleTrending, handleSearch, handleInfo, handleListed } from './commands/discovery.js';
import { handleCreator, handleEarnings, handleClaim } from './commands/creator.js';
import { handleBurns, handleStats, handlePool } from './commands/stats.js';
import { handleAlerts, handleSlippage } from './commands/settings.js';

// ── Callback query handler ──
import { handleCallbackQuery } from './callbacks/index.js';

// ──────────────────────────────────────────────
// Bot initialization
// ──────────────────────────────────────────────

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN env var is required');
  process.exit(1);
}

const bot = new Bot(token);

// ──────────────────────────────────────────────
// Register command handlers
// ──────────────────────────────────────────────

// Core
bot.command('start', handleStart);
bot.command('help', handleStart); // alias

// Wallet
bot.command('wallet', handleWallet);
bot.command('deposit', handleDeposit);
bot.command('withdraw', handleWithdraw);
bot.command('balance', handleBalance);

// Trading
bot.command('ape', handleApe);
bot.command('close', handleClose);
bot.command('closeall', handleCloseAll);
bot.command('positions', handlePositions);

// History & P&L
bot.command('history', handleHistory);
bot.command('pnl', handlePnL);
bot.command('locks', handleLocks);

// Token Discovery
bot.command('trending', handleTrending);
bot.command('search', handleSearch);
bot.command('info', handleInfo);
bot.command('listed', handleListed);

// Creator
bot.command('creator', handleCreator);
bot.command('earnings', handleEarnings);
bot.command('claim', handleClaim);

// Protocol Stats
bot.command('burns', handleBurns);
bot.command('stats', handleStats);
bot.command('pool', handlePool);

// Settings
bot.command('alerts', handleAlerts);
bot.command('slippage', handleSlippage);

// ──────────────────────────────────────────────
// Callback query handler (inline keyboards)
// ──────────────────────────────────────────────

bot.on('callback_query:data', handleCallbackQuery);

// ──────────────────────────────────────────────
// Error handler
// ──────────────────────────────────────────────

bot.catch((err) => {
  const ctx = err.ctx;
  const e = err.error;

  console.error(`[bot] Error handling update ${ctx.update.update_id}:`);

  if (e instanceof Error) {
    console.error(`  ${e.name}: ${e.message}`);
    console.error(e.stack);
  } else {
    console.error('  Unknown error:', e);
  }

  // Best-effort reply to user
  ctx
    .reply('⚠️ Something went wrong\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    })
    .catch(() => {
      // Silently ignore if we can't even reply
    });
});

// ──────────────────────────────────────────────
// Start the bot
// ──────────────────────────────────────────────

console.log('🚀 Front Protocol Bot starting...');

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} is running (long polling)`);
    console.log(`   API: ${process.env.API_URL ?? 'http://localhost:3001'}`);
  },
});

// ──────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\n🛑 Received ${signal}, shutting down...`);
  bot.stop();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
