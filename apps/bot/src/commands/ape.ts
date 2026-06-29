// ──────────────────────────────────────────────
// FRONT PROTOCOL — /ape Command
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  code,
  escapeMarkdown,
  formatSol,
  formatPercent,
  formatUsd,
  tierBadge,
} from '../lib/format.js';

/**
 * /ape <token> <amount_sol> <leverage>
 * Parse, preview, and confirm a leveraged position.
 */
export async function handleApe(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const text = ctx.message?.text ?? '';
  const parts = text.split(/\s+/).slice(1); // strip /ape

  if (parts.length < 3) {
    await ctx.reply(
      [
        `🦍 ${bold('Usage:')} /ape \\<token\\> \\<sol\\> \\<leverage\\>`,
        ``,
        `Example: ${code('/ape DOGE 0.5 5x')}`,
        ``,
        `• ${bold('token')} — symbol or contract address`,
        `• ${bold('sol')} — amount of SOL to use`,
        `• ${bold('leverage')} — 2x to 10x \\(depends on tier\\)`,
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const tokenQuery = parts[0];
  const amountSol = parseFloat(parts[1]);
  const leverageStr = parts[2].replace(/x$/i, '');
  const leverage = parseInt(leverageStr, 10);

  if (isNaN(amountSol) || amountSol <= 0) {
    await ctx.reply('⚠️ Invalid SOL amount\\. Must be a positive number\\.', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  if (isNaN(leverage) || leverage < 2 || leverage > 10) {
    await ctx.reply('⚠️ Invalid leverage\\. Must be between 2x and 10x\\.', {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  try {
    // Fetch token info to validate and display preview
    const token = await api.getTokenInfo(tokenQuery);

    if (!token.isActive) {
      await ctx.reply(
        `⚠️ ${bold(escapeMarkdown(token.symbol))} is not currently active for trading\\.`,
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    const userCapLamports = BigInt(Math.round(amountSol * 1e9));
    const protocolCapLamports = userCapLamports * BigInt(leverage - 1);
    const positionSizeLamports = userCapLamports * BigInt(leverage);

    // Build preview
    const tier = escapeMarkdown(tierBadge(token.tier));
    const sym = escapeMarkdown(token.symbol);
    const price = escapeMarkdown(formatUsd(token.priceUsd));
    const mcap = escapeMarkdown(formatUsd(token.marketCapUsd));
    const userCap = escapeMarkdown(formatSol(userCapLamports));
    const protoCap = escapeMarkdown(formatSol(protocolCapLamports));
    const posSize = escapeMarkdown(formatSol(positionSizeLamports));
    const lev = escapeMarkdown(`${leverage}x`);

    const msg = [
      `🦍 ${bold('Position Preview')}`,
      ``,
      `${bold('Token:')} ${sym} \\(${tier}\\)`,
      `${bold('Price:')} ${price}`,
      `${bold('Market Cap:')} ${mcap}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `${bold('Your Capital:')} ${userCap}`,
      `${bold('Leverage:')} ${lev}`,
      `${bold('Protocol Capital:')} ${protoCap}`,
      `${bold('Position Size:')} ${posSize}`,
      ``,
      `${bold('⏱ Duration:')} Max 24h`,
      `${bold('🔒 Profit Lock:')} 30% → \\$FRONT \\(7d lock\\)`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `${bold('📊 Scenarios')}`,
      `🟢 If 2x → you profit \\~${escapeMarkdown(formatSol(userCapLamports))}`,
      `🟢 If 3x → you profit \\~${escapeMarkdown(formatSol(userCapLamports * 2n))}`,
      `🔴 Max Loss → your ${userCap} \\(capped\\)`,
      ``,
      `⚠️ ${bold('Confirm to ape in?')}`,
    ].join('\n');

    // Encode callback data: token|amount|leverage
    const cbData = `${token.address}|${amountSol}|${leverage}`;
    const keyboard = new InlineKeyboard()
      .text('✅ APE IN', `confirm_ape:${cbData}`)
      .text('❌ CANCEL', 'cancel_ape');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 404) {
      await ctx.reply(
        `❌ Token ${bold(escapeMarkdown(tokenQuery))} not found\\. Check the symbol or address\\.`,
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    console.error('[/ape] error:', err);
    await ctx.reply('⚠️ Failed to generate position preview\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
