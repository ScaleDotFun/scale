#!/bin/sh
set -e

echo "Running Prisma migrations..."
cd /app/packages/database
npx prisma migrate deploy

echo "Starting API server..."
cd /app
exec node packages/api/dist/server.js
