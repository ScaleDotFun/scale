// ──────────────────────────────────────────────
// FRONT PROTOCOL — /positions Command
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  escapeMarkdown,
  formatSol,
  formatPercent,
  formatCountdown,
  tierBadge,
} from '../lib/format.js';

/**
 * /positions — show all open positions with close buttons
 */
export async function handlePositions(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const positions = await api.getActivePositions(telegramId);

    if (positions.length === 0) {
      await ctx.reply(
        [
          `📭 ${bold('No Open Positions')}`,
          ``,
          `Use /ape to open a leveraged position\\!`,
          `Example: ${escapeMarkdown('/ape DOGE 0.5 5x')}`,
        ].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    const lines: string[] = [
      `🦍 ${bold(`Open Positions \\(${escapeMarkdown(positions.length.toString())}\\)`)}`,
      ``,
    ];

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      const sym = escapeMarkdown(pos.tokenSymbol);
      const tier = escapeMarkdown(tierBadge(pos.tier));
      const lev = escapeMarkdown(`${pos.leverage}x`);
      const entry = escapeMarkdown(pos.entryPriceSol.toFixed(8));
      const posSize = escapeMarkdown(formatSol(BigInt(pos.positionSizeLamports)));
      const pnl = escapeMarkdown(formatPercent(pos.pnlPercent));
      const expiresAt = new Date(pos.expiresAt);
      const remaining = expiresAt.getTime() - Date.now();
      const countdown = escapeMarkdown(formatCountdown(Math.max(0, remaining)));

      lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`${bold(`#${escapeMarkdown((i + 1).toString())} ${sym}`)} \\(${tier}\\)`);
      lines.push(`${bold('Leverage:')} ${lev}`);
      lines.push(`${bold('Entry:')} ${entry} SOL`);
      lines.push(`${bold('Size:')} ${posSize}`);
      lines.push(`${bold('P\\&L:')} ${pnl}`);
      lines.push(`${bold('⏱ Expires:')} ${countdown}`);
      lines.push(``);

      // Add close button per position
      keyboard.text(`❌ Close #${i + 1} ${pos.tokenSymbol}`, `confirm_close:${pos.id}`);
      if (i < positions.length - 1) keyboard.row();
    }

    if (positions.length > 1) {
      keyboard.row().text('🔴 Close All', 'confirm_closeall');
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('[/positions] error:', err);
    await ctx.reply('⚠️ Failed to load positions\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
