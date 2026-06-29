// ──────────────────────────────────────────────
// FRONT PROTOCOL — /start Command
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import * as api from '../lib/api.js';
import { bold, code, escapeMarkdown, formatAddress } from '../lib/format.js';

/**
 * Handle the /start command.
 * Welcomes the user, auto-creates a custodial wallet, and lists commands.
 */
export async function handleStart(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) {
    await ctx.reply('⚠️ Could not identify your Telegram account\\.');
    return;
  }

  try {
    const wallet = await api.getOrCreateWallet(telegramId);

    const walletAddr = escapeMarkdown(wallet.walletAddress);
    const shortAddr = escapeMarkdown(formatAddress(wallet.walletAddress));

    const msg = [
      `🦍 ${bold('Welcome to Ape Harder\\!')}`,
      ``,
      `The degen\\-grade leveraged trading protocol for Pump\\.fun memecoins on Solana\\.`,
      ``,
      `${bold('Your Wallet:')} ${code(walletAddr)}`,
      `Deposit SOL to start aping with leverage\\!`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `${bold('📋 Commands')}`,
      ``,
      `${bold('💰 Wallet')}`,
      `/wallet — View your wallet \\& balance`,
      `/deposit — Get your deposit address`,
      `/withdraw — Withdraw SOL`,
      `/balance — Check balances`,
      ``,
      `${bold('🦍 Trading')}`,
      `/ape \\<token\\> \\<sol\\> \\<leverage\\> — Open position`,
      `/positions — View open positions`,
      `/close \\<id\\> — Close a position`,
      `/closeall — Close all positions`,
      ``,
      `${bold('📊 Stats')}`,
      `/history — Trade history`,
      `/pnl — Profit \\& loss summary`,
      `/locks — View locked \\$APE`,
      ``,
      `${bold('🔎 Discovery')}`,
      `/trending — Trending tokens`,
      `/search \\<query\\> — Search tokens`,
      `/info \\<token\\> — Token details`,
      `/listed — All listed tokens`,
      ``,
      `${bold('🔥 Protocol')}`,
      `/burns — Recent \\$APE burns`,
      `/stats — Protocol statistics`,
      `/pool — Capital pool info`,
      ``,
      `${bold('🎨 Creator')}`,
      `/creator — Creator dashboard`,
      `/earnings — Earnings breakdown`,
      `/claim — Claim creator earnings`,
      ``,
      `${bold('⚙️ Settings')}`,
      `/alerts — Toggle trade alerts`,
      `/slippage — Set max slippage`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `LFG 🚀 Start by depositing SOL to ${code(shortAddr)}`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/start] error:', err);
    await ctx.reply('⚠️ Something went wrong setting up your wallet\\. Please try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
