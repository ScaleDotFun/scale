<div align="center">

# ▮ SCALE

**Leverage trade any pump.fun memecoin up to 10x — on Solana**

[![Live App](https://img.shields.io/badge/live-scale.fun-c8ff00?style=for-the-badge&logoColor=black)](https://www.scale.fun)
[![Solana](https://img.shields.io/badge/Solana-mainnet-c8ff00?style=for-the-badge)](https://solscan.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-c8ff00?style=for-the-badge)](LICENSE)

<br/>

*Every position is a real Jupiter swap — not a perp, not paper. Your long moves the actual chart.*

</div>

---

## What is SCALE?

SCALE is on-chain leverage for memecoins launched on [pump.fun](https://pump.fun), running on **Solana mainnet**. A trader posts SOL collateral, the protocol's capital pool fronts the rest, and the full leveraged size **market-buys the token via Jupiter** — immediately, on-chain, whether the coin is still on its bonding curve or already graduated. Close in profit and the tokens sell back; close in loss and the pool recovers its capital first. The pool never loses, so it can keep fronting size indefinitely.

- **Up to 10x** on any listed pump.fun coin — real spot buys, no order book, no counterparty
- **Live 1-second charts** streamed from Jupiter's price feed
- **Server-side TP / SL** enforced every 10 seconds by a background monitor
- **Custodial wallets** — email/password or Google sign-in, no browser extension
- **Trustless listings** — pump.fun launches verified against Jupiter's launchpad attribution; trending coins auto-list
- **Max loss is always your collateral** — the pool exits before its capital is at risk

## How it works

```
Trader posts 1 SOL collateral, picks 5x
  → 1 SOL moves to the protocol pool
  → pool adds 4 SOL
  → 5 SOL market-buys the coin via Jupiter
  → real tokens held; position monitored every 10s, 24h max
  → auto-closes on TP / SL / liquidation threshold / timeout, or on user exit
```

**Fee split** (flat fee on position size): 50% deepens the pool · 30% to the coin's creator · 20% market-buys $SCALE and burns it.

**Profit split** on a winning close: 70% cash to the trader · 30% auto-buys $SCALE, locked 7 days.

## Architecture

```
scale/
├── apps/
│   ├── web/          # React + Vite frontend (the PHOSPHOR terminal UI)
│   └── bot/          # Telegram trading bot
├── packages/
│   ├── api/          # Express REST API + live price tick engine
│   ├── core/         # Pure business logic — PnL, revenue splits, safety
│   ├── database/     # Prisma schema + migrations (PostgreSQL)
│   ├── services/     # BullMQ workers — price monitor, closer, burn, lock, discovery
│   └── solana/       # Solana execution layer (web3.js + Jupiter)
└── turbo.json        # Turborepo monorepo config
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Chain | Solana mainnet, @solana/web3.js |
| DEX | Jupiter aggregator — routes bonding-curve and graduated pump.fun coins |
| Launchpad | pump.fun — launches verified via Jupiter token attribution |
| Market data | Jupiter Price/Token APIs + GeckoTerminal (`solana` network) |
| Frontend | React 18, Vite, Lightweight Charts |
| API | Express, Prisma ORM |
| Data stores | PostgreSQL, Redis |
| Workers | BullMQ |
| Infra | Turborepo, Vercel, Railway, Docker |

## Getting started

```bash
git clone https://github.com/ScaleDotFun/scale.git
cd scale

pnpm install
cp .env.example .env        # fill in your values

pnpm --filter @scale/web dev
```

Open the URL Vite prints (defaults to `http://localhost:5173`).

## Key environment variables

| Variable | Description |
|----------|-------------|
| `SOLANA_RPC_URL` | Solana RPC (defaults to the public mainnet RPC — use a dedicated one in production) |
| `PROTOCOL_WALLET_PRIVATE_KEY` | Base58 secret key (or solana-keygen JSON) for the protocol pool wallet |
| `SCALE_TOKEN_MINT` | $SCALE SPL mint (locked-supply stats + buyback/burn) |
| `JUPITER_API_URL` / `JUPITER_API_KEY` | Optional — paid Jupiter tier (defaults to the free lite tier) |
| `COINGECKO_API_KEY` | Optional — routes GeckoTerminal data through CoinGecko Pro |
| `DATABASE_URL` / `REDIS_URL` | PostgreSQL + Redis connection strings |
| `ENCRYPTION_KEY` | 32-byte hex — encrypts custodial wallet keys at rest |

See [`.env.example`](.env.example) for the full list.

## Token tiers

| Tier | Max leverage | Liquidation | Basis |
|------|-------------|-------------|-------|
| Bonded | 10x | −15% | Graduated on pump.fun, deepest liquidity |
| Rising | 5x | −12% | $100K+ market cap |
| Degen | 3x | −10% | Live bonding curve, thin liquidity |

## Safety model

- **The pool recovers its capital first** on every close — it cannot go negative
- **Liquidation threshold shown before entry**, enforced by the price monitor
- **Insurance fund** absorbs extreme-slippage edge cases
- **24h max duration** — every position auto-closes
- **On-chain verifiable** — pool wallet, swaps, burns, and listings are all public on Solscan

## Links

- App — [scale.fun](https://www.scale.fun)
- X — [@ScaleDotFun](https://x.com/ScaleDotFun)
- Explorer — [solscan.io](https://solscan.io)

---

<div align="center">

**Built for degens. The pool never loses.**

</div>
