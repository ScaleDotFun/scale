<div align="center">

# ▮ SCALE

**Leverage trade any Noxa memecoin up to 10x — on Robinhood Chain**

[![Live App](https://img.shields.io/badge/live-scale.fun-c8ff00?style=for-the-badge&logoColor=black)](https://www.scale.fun)
[![Robinhood Chain](https://img.shields.io/badge/Robinhood%20Chain-L2%204663-c8ff00?style=for-the-badge)](https://robinhoodchain.blockscout.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-c8ff00?style=for-the-badge)](LICENSE)

<br/>

*Every position is a real Uniswap V3 buy — not a perp, not paper. Your long moves the actual chart.*

</div>

---

## What is SCALE?

SCALE is on-chain leverage for memecoins launched on [Noxa](https://fun.noxa.fi/robinhood/launch), running on **Robinhood Chain** (an Arbitrum Orbit L2, chain id 4663). A trader posts ETH collateral, the protocol's capital pool fronts the rest, and the full leveraged size **market-buys the token on Uniswap V3** — immediately, on-chain. Close in profit and the tokens sell back; close in loss and the pool recovers its capital first. The pool never loses, so it can keep fronting size indefinitely.

- **Up to 10x** on any listed Noxa token — real spot buys, no order book, no counterparty
- **1-second charts** decoded live from Uniswap V3 `Swap` events, straight off the chain
- **Server-side TP / SL** enforced every 10 seconds by a background monitor
- **Custodial wallets** — email/password or Google sign-in, no browser extension
- **Trustless listings** — fee redirects verified against Noxa's own `FeeRouter` contract
- **Max loss is always your collateral** — the pool exits before its capital is at risk

## How it works

```
Trader posts 0.1 ETH collateral, picks 5x
  → 0.1 ETH moves to the protocol pool
  → pool adds 0.4 ETH
  → 0.5 ETH exactInputSingle on Uniswap V3 (SwapRouter02)
  → real tokens held; position monitored every 10s, 24h max
  → auto-closes on TP / SL / liquidation threshold / timeout, or on user exit
```

**Fee split** (flat fee on position size): 50% deepens the pool · 30% to the token creator · 20% market-buys $SCALE and sends it to `0x…dEaD`.

**Profit split** on a winning close: 70% cash to the trader · 30% auto-buys $SCALE, locked 7 days.

## Architecture

```
scale/
├── apps/
│   ├── web/          # React + Vite frontend (the PHOSPHOR terminal UI)
│   └── bot/          # Telegram trading bot
├── packages/
│   ├── api/          # Express REST API + live on-chain tick engine
│   ├── core/         # Pure business logic — PnL, revenue splits, safety
│   ├── database/     # Prisma schema + migrations (PostgreSQL)
│   ├── services/     # BullMQ workers — price monitor, closer, burn, lock, fees
│   └── evm/          # Robinhood Chain execution layer (viem)
└── turbo.json        # Turborepo monorepo config
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Chain | Robinhood Chain (Arbitrum Orbit L2), viem |
| DEX | Uniswap V3 — canonical SwapRouter02 |
| Launchpad | Noxa — LaunchFactory + FeeRouter reads |
| Market data | GeckoTerminal (`robinhood` network) + on-chain swap events |
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
| `ROBINHOOD_RPC_URL` | Robinhood Chain RPC (defaults to the public mainnet RPC) |
| `PROTOCOL_WALLET_PRIVATE_KEY` | EVM key (`0x` + 64 hex) for the protocol pool wallet |
| `FRONT_TOKEN_MINT` | $SCALE ERC-20 address (locked-supply stats + buyback/burn) |
| `COINGECKO_API_KEY` | Optional — routes market data through CoinGecko Pro |
| `DATABASE_URL` / `REDIS_URL` | PostgreSQL + Redis connection strings |
| `ENCRYPTION_KEY` | 32-byte hex — encrypts custodial wallet keys at rest |

See [`.env.example`](.env.example) for the full list.

## Token tiers

| Tier | Max leverage | Liquidation | Basis |
|------|-------------|-------------|-------|
| Bonded | 10x | −15% | Deepest Uniswap V3 liquidity |
| Rising | 5x | −12% | $100K+ market cap |
| Degen | 3x | −10% | Live Noxa pool, thin liquidity |

## Safety model

- **The pool recovers its capital first** on every close — it cannot go negative
- **Liquidation threshold shown before entry**, enforced by the price monitor
- **Insurance fund** absorbs extreme-slippage edge cases
- **24h max duration** — every position auto-closes
- **On-chain verifiable** — pool wallet, swaps, burns, and listing checks are all public

## Links

- App — [scale.fun](https://www.scale.fun)
- X — [@ScaleDotFun](https://x.com/ScaleDotFun)
- Explorer — [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)

---

<div align="center">

**Built for degens. The pool never loses.**

</div>
