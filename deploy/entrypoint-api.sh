#!/bin/sh
set -eu

cd /app/apps/api
PRISMA_BIN=./node_modules/.bin/prisma
if [ ! -x "$PRISMA_BIN" ]; then
  PRISMA_BIN=/app/node_modules/.pnpm/node_modules/.bin/prisma
fi
if [ ! -x "$PRISMA_BIN" ]; then
  PRISMA_BIN=/app/node_modules/.bin/prisma
fi

echo "[api] waiting for database..."
i=0
until node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.\$connect().then(()=>p.\$disconnect()).then(()=>process.exit(0)).catch(()=>process.exit(1));" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 90 ]; then
    echo "[api] database not ready after 90s"
    exit 1
  fi
  sleep 1
done

echo "[api] applying Prisma migrations..."
"$PRISMA_BIN" migrate deploy --schema=prisma/schema.prisma

echo "[api] starting NestJS..."
if [ -f dist/main.js ]; then
  exec node dist/main.js
elif [ -f dist/src/main.js ]; then
  exec node dist/src/main.js
else
  echo "[api] main.js not found under dist/"
  ls -la dist || true
  exit 1
fi
