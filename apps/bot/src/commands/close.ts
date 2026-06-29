// ──────────────────────────────────────────────
// FRONT PROTOCOL — /close, /closeall Commands
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
} from '../lib/format.js';

/**
 * /close <position_id> — confirm and close a single position
 */
export async function handleClose(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const text = ctx.message?.text ?? '';
  const parts = text.split(/\s+/).slice(1);

  if (parts.length < 1) {
    await ctx.reply(
      [
        `⚠️ ${bold('Usage:')} /close \\<position\\_id\\>`,
        ``,
        `Use /positions to see your open positions and their IDs\\.`,
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  const positionId = parts[0];

  try {
    // Verify the position exists and belongs to user
    const positions = await api.getActivePositions(telegramId);
    const pos = positions.find((p) => p.id === positionId);

    if (!pos) {
      await ctx.reply('❌ Position not found or already closed\\.', {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    const sym = escapeMarkdown(pos.tokenSymbol);
    const pnl = escapeMarkdown(formatPercent(pos.pnlPercent));
    const pnlSol = escapeMarkdown(formatSol(BigInt(pos.pnlLamports)));

    const msg = [
      `📦 ${bold('Close Position')}`,
      ``,
      `${bold('Token:')} ${sym}`,
      `${bold('P\\&L:')} ${pnl} \\(${pnlSol}\\)`,
      `${bold('Leverage:')} ${escapeMarkdown(pos.leverage + 'x')}`,
      ``,
      `⚠️ Are you sure you want to close this position?`,
    ].join('\n');

    const keyboard = new InlineKeyboard()
      .text('✅ Close', `confirm_close:${positionId}`)
      .text('❌ Keep Open', 'cancel_close');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } catch (err) {
    console.error('[/close] error:', err);
    await ctx.reply('⚠️ Failed to load position\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /closeall — list and confirm closing all open positions
 */
export async function handleCloseAll(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const positions = await api.getActivePositions(telegramId);

    if (positions.length === 0) {
      await ctx.reply('📭 You have no open positions\\.', {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    const lines: string[] = [
      `🔴 ${bold('Close All Positions')}`,
      ``,
      `You have ${bold(escapeMarkdown(positions.length.toString()))} open positions:`,
      ``,
    ];

    for (const pos of positions) {
      const sym = escapeMarkdown(pos.tokenSymbol);
      const pnl = escapeMarkdown(formatPercent(pos.pnlPercent));
      lines.push(`• ${sym} ${escapeMarkdown(pos.leverage + 'x')} → ${pnl}`);
    }

    lines.push(``);
    lines.push(`⚠️ This will close ${bold('ALL')} positions\\.`);

    const keyboard = new InlineKeyboard()
      .text('✅ Close All', 'confirm_closeall')
      .text('❌ Cancel', 'cancel_close');

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('[/closeall] error:', err);
    await ctx.reply('⚠️ Failed to load positions\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
