<div align="center">

# ▮ LOADED

**Leverage trade any Robinhood Chain memecoin up to 10x**

[![Live App](https://img.shields.io/badge/live-loaded.fun-c8ff00?style=for-the-badge&logoColor=black)](https://www.loaded.fun)
[![Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-4663-c8ff00?style=for-the-badge)](https://explorer.chain.robinhood.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-c8ff00?style=for-the-badge)](LICENSE)

<br/>

*Every position is a real on-chain swap — not a perp, not paper. Your long moves the actual chart.*

</div>

---

## What is LOADED?

LOADED is on-chain leverage for memecoins launched on [PONS](https://pons.fun), running on **Robinhood Chain** — an Arbitrum Orbit L2 (chain id `4663`). A trader posts ETH collateral, the protocol's capital pool fronts the rest, and the full leveraged size **market-buys the token on-chain**, routed across the chain's DEXes by the LI.FI aggregator. Close in profit and the tokens sell back; close in loss and the pool recovers its capital first. The pool never loses, so it can keep fronting size indefinitely.

- **Up to 10x** on any listed launchpad coin — real spot buys, no order book, no counterparty
- **Live seconds-resolution charts** built from real on-chain trades
- **Server-side TP / SL** enforced every 10 seconds by a background monitor
- **Custodial wallets** — email/password or Google sign-in, no browser extension
- **Listings are earned, not granted** — a coin lists once its PONS creator fees provably route to the pool
- **Max loss is always your collateral** — the pool exits before its capital is at risk

## How it works

```
Trader posts 1 ETH collateral, picks 5x
  → 1 ETH moves to the protocol pool
  → pool adds 4 ETH
  → 5 ETH market-buys the coin on-chain via the LI.FI aggregator
  → real tokens held; position monitored every 10s, 24h max
  → auto-closes on TP / SL / liquidation threshold / timeout, or on user exit
```

**Fee split** (flat fee on position size): 50% deepens the pool · 30% to the coin's creator · 20% market-buys $LOADED and burns it.

**Profit split** on a winning close: 70% cash to the trader · 30% auto-buys $LOADED, locked 7 days.

## The listing gate

PONS charges 1% per trade and splits it 70/30 in the creator's favour. A creator lists their coin on
LOADED by pointing that creator-fee stream at the protocol pool — PONS exposes
`setCreatorFeeRecipient(address)` on each launch's bonding curve for exactly this.

Because PONS publishes no matching getter, LOADED does not take a creator's word for it: the gate
verifies **economically**, by looking for fee transfers that actually arrive from the coin's own PONS
pool contracts into the pool wallet. A coin whose fees never show up is never listed, and an
unreadable chain returns `unverifiable` rather than a false pass.

## Architecture

```
loaded/
├── apps/
│   ├── web/          # React + Vite frontend (the PHOSPHOR terminal UI)
│   └── bot/          # Telegram trading bot
├── packages/
│   ├── api/          # Express REST API + live price tick engine
│   ├── core/         # Pure business logic — PnL, revenue splits, safety
│   ├── database/     # Prisma schema + migrations (PostgreSQL)
│   ├── evm/          # Robinhood Chain execution layer (viem + LI.FI)
│   └── services/     # BullMQ workers — price monitor, closer, burn, lock, discovery
└── turbo.json        # Turborepo monorepo config
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Chain | Robinhood Chain (Arbitrum Orbit L2, chain id 4663), viem |
| Swaps | LI.FI aggregator — routes across the chain's Uniswap/PONS/other venues |
| Launchpad | PONS — bonding curve graduating into locked Uniswap V4 liquidity |
| Market data | GeckoTerminal (`robinhood` network) |
| Frontend | React 18, Vite, Lightweight Charts |
| API | Express, Prisma ORM |
| Data stores | PostgreSQL, Redis |
| Workers | BullMQ |
| Infra | Turborepo, Vercel, Railway, Docker |

## Getting started

```bash
git clone https://github.com/LoadedDotFun/loaded.git
cd loaded

pnpm install
cp .env.example .env        # fill in your values

pnpm --filter @loaded/web dev
```

Open the URL Vite prints (defaults to `http://localhost:5173`).

## Key environment variables

| Variable | Description |
|----------|-------------|
| `EVM_RPC_URL` | Robinhood Chain RPC (defaults to the public endpoint — use a dedicated one in production) |
| `PROTOCOL_WALLET_PRIVATE_KEY` | `0x` hex private key for the protocol pool wallet |
| `LOADED_TOKEN_MINT` | $LOADED ERC-20 address (locked-supply stats + buyback/burn) — leave empty until launch |
| `LOADED_MIN_FEE_SHARE_PCT` | Share of PONS creator fees that must route to the pool (default 100) |
| `LIFI_API_URL` / `LIFI_API_KEY` | Optional — higher aggregator rate limits |
| `COINGECKO_API_KEY` | Optional — routes GeckoTerminal data through CoinGecko Pro |
| `DATABASE_URL` / `REDIS_URL` | PostgreSQL + Redis connection strings |
| `ENCRYPTION_KEY` | 32-byte hex — encrypts custodial wallet keys at rest |

See [`.env.example`](.env.example) for the full list.

## Token tiers

| Tier | Max leverage | Liquidation | Basis |
|------|-------------|-------------|-------|
| Bonded | 10x | −15% | Graduated off the curve, deepest liquidity |
| Rising | 5x | −12% | $100K+ market cap |
| Degen | 3x | −10% | Live bonding curve, thin liquidity |

## Safety model

- **The pool recovers its capital first** on every close — it cannot go negative
- **Liquidation threshold shown before entry**, enforced by the price monitor
- **Insurance fund** absorbs extreme-slippage edge cases
- **24h max duration** — every position auto-closes
- **Swap results are read from mined transaction receipts**, never from balance guesses
- **On-chain verifiable** — pool wallet, swaps, burns, and listings are all public on the explorer

## Links

- App — [loaded.fun](https://www.loaded.fun)
- X — [@LoadedDotFun](https://x.com/LoadedDotFun)
- Explorer — [explorer.chain.robinhood.com](https://explorer.chain.robinhood.com)

---

<div align="center">

**Built for degens. The pool never loses.**

</div>
