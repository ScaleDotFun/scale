// ──────────────────────────────────────────────
// FRONT PROTOCOL — /trending, /search, /info, /listed
// ──────────────────────────────────────────────

import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import * as api from '../lib/api.js';
import {
  bold,
  code,
  escapeMarkdown,
  formatUsd,
  formatPercent,
  formatAddress,
  tierBadge,
} from '../lib/format.js';

/**
 * /trending — top 10 tokens by volume with tier badges
 */
export async function handleTrending(ctx: CommandContext<Context>): Promise<void> {
  try {
    const tokens = await api.getTrendingTokens();

    if (tokens.length === 0) {
      await ctx.reply('📭 No trending tokens right now\\. Check back later\\!', {
        parse_mode: 'MarkdownV2',
      });
      return;
    }

    const lines: string[] = [
      `🔥 ${bold('Trending Tokens')}`,
      ``,
    ];

    for (const token of tokens.slice(0, 10)) {
      const rank = escapeMarkdown(`#${token.rank}`);
      const sym = escapeMarkdown(token.symbol);
      const tier = escapeMarkdown(tierBadge(token.tier));
      const price = escapeMarkdown(formatUsd(token.priceUsd));
      const vol = escapeMarkdown(formatUsd(token.volume24hUsd));
      const change = escapeMarkdown(formatPercent(token.priceChange24hPct));

      lines.push(`${rank} ${bold(sym)} \\[${tier}\\]`);
      lines.push(`   💲 ${price}  📈 ${vol} vol  ${change}`);
      lines.push(``);
    }

    lines.push(`Use /info \\<token\\> for details`);

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/trending] error:', err);
    await ctx.reply('⚠️ Failed to load trending tokens\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /search <query> — search listed tokens by name/symbol
 */
export async function handleSearch(ctx: CommandContext<Context>): Promise<void> {
  const text = ctx.message?.text ?? '';
  const query = text.split(/\s+/).slice(1).join(' ').trim();

  if (!query) {
    await ctx.reply(
      [
        `🔎 ${bold('Usage:')} /search \\<query\\>`,
        ``,
        `Example: ${code('/search DOGE')}`,
        `Search by token name or symbol\\.`,
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  try {
    const result = await api.searchTokens(query);

    if (result.tokens.length === 0) {
      await ctx.reply(
        `🔎 No tokens found matching "${escapeMarkdown(query)}"\\.`,
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }

    const lines: string[] = [
      `🔎 ${bold(`Search: "${escapeMarkdown(query)}" \\(${escapeMarkdown(result.total.toString())} results\\)`)}`,
      ``,
    ];

    for (const token of result.tokens.slice(0, 10)) {
      const sym = escapeMarkdown(token.symbol);
      const name = escapeMarkdown(token.name);
      const tier = escapeMarkdown(tierBadge(token.tier));
      const price = escapeMarkdown(formatUsd(token.priceUsd));
      const change = escapeMarkdown(formatPercent(token.priceChange24hPct));

      lines.push(`${bold(sym)} — ${name} \\[${tier}\\]`);
      lines.push(`   💲 ${price}  ${change}`);
      lines.push(``);
    }

    lines.push(`Use /info \\<token\\> for full details`);

    await ctx.reply(lines.join('\n'), { parse_mode: 'MarkdownV2' });
  } catch (err) {
    console.error('[/search] error:', err);
    await ctx.reply('⚠️ Search failed\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /info <token> — detailed token info
 */
export async function handleInfo(ctx: CommandContext<Context>): Promise<void> {
  const text = ctx.message?.text ?? '';
  const query = text.split(/\s+/).slice(1).join(' ').trim();

  if (!query) {
    await ctx.reply(
      [
        `ℹ️ ${bold('Usage:')} /info \\<token\\>`,
        ``,
        `Example: ${code('/info DOGE')}`,
        `Enter a symbol or contract address\\.`,
      ].join('\n'),
      { parse_mode: 'MarkdownV2' },
    );
    return;
  }

  try {
    const token = await api.getTokenInfo(query);

    const sym = escapeMarkdown(token.symbol);
    const name = escapeMarkdown(token.name);
    const tier = escapeMarkdown(tierBadge(token.tier));
    const addr = escapeMarkdown(token.address);
    const shortAddr = escapeMarkdown(formatAddress(token.address));
    const price = escapeMarkdown(formatUsd(token.priceUsd));
    const mcap = escapeMarkdown(formatUsd(token.marketCapUsd));
    const liq = escapeMarkdown(formatUsd(token.liquidityUsd));
    const vol = escapeMarkdown(formatUsd(token.volume24hUsd));
    const change = escapeMarkdown(formatPercent(token.priceChange24hPct));
    const bonded = token.isBonded ? '✅ Yes' : '❌ No';
    const active = token.isActive ? '✅ Active' : '⛔ Inactive';
    const creator = escapeMarkdown(formatAddress(token.creatorWallet));

    // Determine max leverage from tier
    const maxLev: Record<string, string> = {
      bonded: '10x',
      rising: '5x',
      degen: '3x',
    };

    const msg = [
      `ℹ️ ${bold(`${sym} — ${name}`)}`,
      ``,
      `${bold('Tier:')} ${tier}`,
      `${bold('Status:')} ${escapeMarkdown(active)}`,
      `${bold('Bonded:')} ${escapeMarkdown(bonded)}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `${bold('💲 Price:')} ${price}`,
      `${bold('📊 24h Change:')} ${change}`,
      `${bold('🏦 Market Cap:')} ${mcap}`,
      `${bold('💧 Liquidity:')} ${liq}`,
      `${bold('📈 24h Volume:')} ${vol}`,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `${bold('Max Leverage:')} ${escapeMarkdown(maxLev[token.tier] ?? '3x')}`,
      `${bold('Creator:')} ${code(creator)}`,
      `${bold('Contract:')} ${code(addr)}`,
      ``,
      `🦍 /ape ${sym} \\<amount\\> \\<leverage\\> to trade`,
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 404) {
      await ctx.reply(
        `❌ Token ${bold(escapeMarkdown(query))} not found\\.`,
        { parse_mode: 'MarkdownV2' },
      );
      return;
    }
    console.error('[/info] error:', err);
    await ctx.reply('⚠️ Failed to load token info\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}

/**
 * /listed — all listed tokens with pagination
 */
export async function handleListed(ctx: CommandContext<Context>): Promise<void> {
  await showListedPage(ctx, 1);
}

/**
 * Render a page of listed tokens with pagination keyboard.
 * Exported for use by the pagination callback handler.
 */
export async function showListedPage(
  ctx: CommandContext<Context> | Context,
  page: number,
): Promise<void> {
  try {
    const result = await api.getListedTokens(page, 10);

    if (result.tokens.length === 0 && page === 1) {
      await ctx.reply('📭 No listed tokens yet\\.', { parse_mode: 'MarkdownV2' });
      return;
    }

    const totalPages = Math.ceil(result.total / result.pageSize);

    const lines: string[] = [
      `📋 ${bold(`Listed Tokens \\(${escapeMarkdown(page.toString())}/${escapeMarkdown(totalPages.toString())}\\)`)}`,
      ``,
    ];

    for (const token of result.tokens) {
      const sym = escapeMarkdown(token.symbol);
      const tier = escapeMarkdown(tierBadge(token.tier));
      const price = escapeMarkdown(formatUsd(token.priceUsd));
      const change = escapeMarkdown(formatPercent(token.priceChange24hPct));
      const active = token.isActive ? '' : ' ⛔';

      lines.push(`${bold(sym)} \\[${tier}\\]${escapeMarkdown(active)} — ${price} ${change}`);
    }

    // Pagination keyboard
    const keyboard = new InlineKeyboard();
    if (page > 1) {
      keyboard.text('⬅️ Prev', `page:listed:${page - 1}`);
    }
    if (page < totalPages) {
      keyboard.text('➡️ Next', `page:listed:${page + 1}`);
    }

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'MarkdownV2',
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error('[/listed] error:', err);
    await ctx.reply('⚠️ Failed to load listed tokens\\. Try again\\.', {
      parse_mode: 'MarkdownV2',
    });
  }
}
