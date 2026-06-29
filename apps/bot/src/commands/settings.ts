// ──────────────────────────────────────────────
// FRONT PROTOCOL — /alerts, /slippage Commands
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import * as api from '../lib/api.js';
import { bold, code, escapeMarkdown } from '../lib/format.js';

/**
 * /alerts [on|off] — toggle trade alerts
 */
export async function handleAlerts(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const text = ctx.message?.text ?? '';
  const arg = text.split(/\s+/)[1]?.toLowerCase();

  if (!arg || (arg !== 'on' && arg !== 'off')) {
    // Show current setting
    try {
      const settings = await api.getUserSettings(telegramId);
      const current = settings.alertsEnabled ? '✅ ON' : '❌ OFF';
      await ctx.reply(
        [
          `🔔 ${bold('Trade Alerts')}`,
          ``,
          `${bold('Current:')} ${escapeMarkdown(current)}`,
          ``,
          `Usage: /alerts on or /alerts off`,
        ].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
    } catch (err) {
      console.error('[/alerts] error:', err);
      await ctx.reply('⚠️ Failed to load settings\\. Try again\\.', {
        parse_mode: 'MarkdownV2',
      });
    }
    return;
  }

  try {
    const enabled = arg === 'on';
    await api.updateUserSettings(telegramId, { alertsEnabled: enabled });

    const emoji = enabled ? '🔔' : '🔕';
    const status = enabled ? 'ON' : 'OFF';

    await ctx.reply(
      `${emoji} Trade alerts turned ${bold(escapeMarkdown(status))}`,
      { parse_mode: 'MarkdownV2' },
    );
  } catch (err) {
    console.error('[/alerts] error:', err);
    await ctx.reply('⚠️ Failed to update alert settings\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /slippage [percent] — set max slippage tolerance
 */
export async function handleSlippage(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const text = ctx.message?.text ?? '';
  const arg = text.split(/\s+/)[1];

  if (!arg) {
    // Show current setting
    try {
      const settings = await api.getUserSettings(telegramId);
      const current = (settings.slippageBps / 100).toFixed(1);
      await ctx.reply(
        [
          `⚡ ${bold('Max Slippage')}`,
          ``,
          `${bold('Current:')} ${escapeMarkdown(current)}%`,
          ``,
          `Usage: ${code('/slippage 1.5')} \\(sets to 1\\.5%\\)`,
          `Range: 0\\.1% to 50%`,
        ].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
    } catch (err) {
      console.error('[/slippage] error:', err);
      await ctx.reply('⚠️ Failed to load settings\\. Try again\\.', {
        parse_mode: 'MarkdownV2',
      });
    }
    return;
  }

  const pct = parseFloat(arg.replace(/%$/, ''));
  if (isNaN(pct) || pct < 0.1 || pct > 50) {
    await ctx.reply(
      `⚠️ Invalid slippage\\. Must be between 0\\.1% and 50%\\.`,
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  try {
    const slippageBps = Math.round(pct * 100);
    await api.updateUserSettings(telegramId, { slippageBps });

    await ctx.reply(
      `⚡ Max slippage set to ${bold(escapeMarkdown(pct.toFixed(1) + '%'))}`,
      { parse_mode: 'MarkdownV2' },
    );
  } catch (err) {
    console.error('[/slippage] error:', err);
    await ctx.reply('⚠️ Failed to update slippage\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
