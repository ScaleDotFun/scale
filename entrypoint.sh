#!/bin/sh
# Boot script mirroring the Dockerfile CMD — apply migrations, then start.
set -e

echo "Running Prisma migrations..."
cd /app/packages/database
npx prisma migrate deploy

echo "Starting API server..."
cd /app
exec tsx packages/api/src/server.ts
