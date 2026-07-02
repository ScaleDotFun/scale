# ──────────────────────────────────────────────
# FRONT PROTOCOL — Main Dockerfile
# ──────────────────────────────────────────────

FROM node:22-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9 tsx

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/solana/package.json packages/solana/
COPY packages/services/package.json packages/services/
COPY packages/api/package.json packages/api/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/

RUN cd packages/database && npx prisma generate
RUN cd packages/core && pnpm build
RUN cd packages/solana && pnpm build
RUN cd packages/services && pnpm build

ENV NODE_ENV=production

CMD ["tsx", "packages/api/src/server.ts"]
