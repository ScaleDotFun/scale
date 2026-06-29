// ──────────────────────────────────────────────
// FRONT PROTOCOL — /locks Command
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  escapeMarkdown,
  formatSol,
  formatTimestamp,
  formatCountdown,
} from '../lib/format.js';

/**
 * /locks — show all locked $APE with unlock dates
 */
export async function handleLocks(ctx: CommandContext<Context>): Promise<void> {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  try {
    const locks = await api.getUserLocks(telegramId);

    if (locks.length === 0) {
      await ctx.reply(
        [
          `🔓 ${bold('No Locks')}`,
          ``,
          `Profitable trades automatically lock 10% as \\$APE\\.`,
          `Start trading with /ape to accumulate\\!`,
        ].join('\n'),
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    // Separate locked vs unlocked
    const locked = locks.filter((l) => !l.isUnlocked);
    const unlocked = locks.filter((l) => l.isUnlocked);

    // Calculate totals
    const totalLockedLamports = locked.reduce(
      (sum, l) => sum + BigInt(l.amountLamports),
      0n,
    );
    const totalUnlockedLamports = unlocked.reduce(
      (sum, l) => sum + BigInt(l.amountLamports),
      0n,
    );
    const totalLockedApe = locked.reduce(
      (sum, l) => sum + BigInt(l.apeTokens),
      0n,
    );
    const totalUnlockedApe = unlocked.reduce(
      (sum, l) => sum + BigInt(l.apeTokens),
      0n,
    );

    const lines: string[] = [
      `🔒 ${bold('\\$APE Locks')}`,
      ``,
      `${bold('Total Locked:')} ${escapeMarkdown(totalLockedApe.toString())} \\$APE \\(${escapeMarkdown(formatSol(totalLockedLamports))}\\)`,
      `${bold('Total Unlocked:')} ${escapeMarkdown(totalUnlockedApe.toString())} \\$APE \\(${escapeMarkdown(formatSol(totalUnlockedLamports))}\\)`,
      ``,
    ];

    // Group locked by approximate unlock date
    if (locked.length > 0) {
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`${bold('🔐 Active Locks')}`);
      lines.push(``);

      // Sort by unlock date
      const sorted = [...locked].sort(
        (a, b) => new Date(a.unlocksAt).getTime() - new Date(b.unlocksAt).getTime(),
      );

      for (const lock of sorted) {
        const apeAmt = escapeMarkdown(BigInt(lock.apeTokens).toString());
        const solAmt = escapeMarkdown(formatSol(BigInt(lock.amountLamports)));
        const unlocksAt = new Date(lock.unlocksAt);
        const remaining = unlocksAt.getTime() - Date.now();
        const countdown = remaining > 0
          ? escapeMarkdown(formatCountdown(remaining))
          : '✅ Ready';

        lines.push(`• ${apeAmt} \\$APE \\(${solAmt}\\) — unlocks in ${countdown}`);
      }
    }

    if (unlocked.length > 0) {
      lines.push(``);
      lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
      lines.push(`${bold('✅ Unlocked')}`);
      lines.push(``);

      for (const lock of unlocked) {
        const apeAmt = escapeMarkdown(BigInt(lock.apeTokens).toString());
        const solAmt = escapeMarkdown(formatSol(BigInt(lock.amountLamports)));
        const unlockedAt = escapeMarkdown(formatTimestamp(new Date(lock.unlocksAt)));
        lines.push(`• ${apeAmt} \\$APE \\(${solAmt}\\) — unlocked ${unlockedAt}`);
      }
    }

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/locks] error:', err);
    await ctx.reply('⚠️ Failed to load locks\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
