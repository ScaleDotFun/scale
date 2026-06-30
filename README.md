<div align="center">

# ⬡ FRONT PROTOCOL

**Leverage trade any Pump.fun coin up to 10x**

[![Live App](https://img.shields.io/badge/Live-front.fun-f0b90b?style=for-the-badge&logo=vercel&logoColor=white)](https://www.front.fun)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-9945FF?style=for-the-badge&logo=solana&logoColor=white)](https://solana.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<br/>

*The first protocol that lets you leverage trade any Pump.fun memecoin — no CEX, no order books, pure on-chain.*

</div>

---

## ✦ What is Front?

Front Protocol enables leveraged trading on Solana memecoins that graduate from Pump.fun. Users deposit collateral, the protocol fills the rest, and positions auto-close with built-in risk management.

- **2–10x leverage** on any listed Pump.fun token
- **Real-time 1-second charts** powered by Birdeye
- **Custodial wallets** — no browser extension needed
- **Auto-liquidation** — protocol never loses money
- **Token creator rewards** — 30% of fees go to token creators

## ✦ How It Works

```
User deposits 1 SOL collateral
  → Selects 5x leverage
  → Protocol lends 4 SOL
  → 5 SOL position opens on-chain
  → Position monitored for 24h max
  → Auto-closes at liquidation threshold or user exit
```

**Fee Structure:**
- 0.5% flat fee on position size
- 50% → back to protocol pool
- 30% → token creator
- 20% → buy & burn $FRONT

**Profit Distribution:**
- 70% → user (SOL)
- 30% → auto-buy $FRONT (locked 7 days)

## ✦ Architecture

```
front/
├── apps/
│   ├── web/          # React + Vite frontend
│   └── bot/          # Telegram trading bot
├── packages/
│   ├── api/          # Express REST API
│   ├── core/         # Business logic (PnL, revenue, safety)
│   ├── database/     # Prisma + PostgreSQL
│   ├── services/     # Background workers (pricing, liquidation)
│   └── solana/       # On-chain operations (Jupiter, Pump.fun)
└── turbo.json        # Turborepo monorepo config
```

## ✦ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Framer Motion |
| Charts | Lightweight Charts (TradingView) + Birdeye WebSocket |
| Styling | Custom CSS design system (black/gold) |
| API | Express.js, Prisma ORM |
| Database | PostgreSQL, Redis |
| Blockchain | Solana Web3.js, Jupiter Aggregator |
| Bot | grammY (Telegram) |
| Infra | Turborepo, Vercel, Docker |

## ✦ Getting Started

```bash
# Clone
git clone https://github.com/FrontDotFun/front.git
cd front

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your keys

# Run the web app
cd apps/web
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## ✦ Environment Variables

| Variable | Description |
|----------|------------|
| `VITE_BIRDEYE_API_KEY` | Birdeye API key (Business plan for WebSocket) |
| `VITE_API_URL` | Backend API URL |
| `VITE_SOLANA_RPC_URL` | Solana RPC endpoint |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |

## ✦ Token Tiers

| Tier | Max Leverage | Liquidation | Requirements |
|------|-------------|-------------|-------------|
| 🟢 Bonded | 10x | -15% | Bonded on Raydium |
| 🟡 Rising | 5x | -12% | $100K+ MCAP |
| 🔴 Degen | 3x | -10% | Listed on Pump.fun |

## ✦ Safety Model

- **Protocol never loses money** — positions close before collateral is consumed
- **5% safety buffer** on liquidation threshold
- **Insurance fund** for extreme slippage edge cases
- **24h max duration** — all positions auto-close
- **On-chain verifiable** — all fee configs are immutable

## ✦ Links

- 🌐 **App**: [front.fun](https://www.front.fun)
- 🐦 **Twitter**: [@FrontDotFun](https://twitter.com/FrontDotFun)
- 💬 **Telegram**: [t.me/FrontProtocol](https://t.me/FrontProtocol)

---

<div align="center">

**Built for degens, by degens** ⬡

</div>
# Auto-deploy test
