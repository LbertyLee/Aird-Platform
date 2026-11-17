import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import OpenAI from 'openai';

const p = new PrismaClient();
const jobId = 'cmtma8jwp001fqaa0e2ubizvk';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 16379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
});

async function main() {
  const job = await p.ingestionJob.findUnique({ where: { id: jobId } });
  console.log('--- DB JOB ---');
  console.log(JSON.stringify(job, null, 2));
  console.log('ageSec', job ? Math.round((Date.now() - new Date(job.updatedAt).getTime()) / 1000) : null);

  const keys = await redis.keys('*ingestion*');
  console.log('--- REDIS KEYS ---', keys.slice(0, 50));
  for (const k of keys.slice(0, 30)) {
    const t = await redis.type(k);
    let preview = '';
    if (t === 'string') preview = await redis.get(k);
    else if (t === 'list') preview = `llen=${await redis.llen(k)}`;
    else if (t === 'zset') preview = `zcard=${await redis.zcard(k)}`;
    else if (t === 'hash') preview = JSON.stringify(await redis.hgetall(k)).slice(0, 400);
    else if (t === 'set') preview = `scard=${await redis.scard(k)}`;
    console.log(t, k, preview?.slice?.(0, 300) ?? preview);
  }

  // BullMQ active/wait/failed for common queue names
  for (const q of ['ingestion', 'ingestion-queue', 'vector-sync']) {
    for (const suffix of ['active', 'wait', 'paused', 'delayed', 'failed', 'completed', 'meta', 'stalled-check', 'id']) {
      const k = `bull:${q}:${suffix}`;
      const exists = await redis.exists(k);
      if (!exists) continue;
      const t = await redis.type(k);
      console.log('BULL', k, t);
      if (t === 'list') {
        const n = await redis.llen(k);
        const items = await redis.lrange(k, 0, 5);
        console.log('  llen', n, items.map((x) => x.slice(0, 120)));
      } else if (t === 'zset') {
        console.log('  zcard', await redis.zcard(k));
      } else if (t === 'hash') {
        console.log('  hash', JSON.stringify(await redis.hgetall(k)).slice(0, 500));
      }
    }
  }

  console.log('--- EMBEDDING PING ---');
  const apiKey = process.env.AI_API_KEY;
  const baseURL = process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL;
  const model = process.env.EMBEDDING_MODEL || 'text-embedding-v4';
  console.log({ baseURL, model, hasKey: Boolean(apiKey) });
  const client = new OpenAI({ apiKey, baseURL });
  const t0 = Date.now();
  try {
    const ctrl = AbortSignal.timeout(20000);
    // openai sdk may not take abort easily; race with timeout
    const res = await Promise.race([
      client.embeddings.create({ model, input: ['hello stuck job test'] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('embed timeout 20s')), 20000)),
    ]);
    console.log('embed ok ms=', Date.now() - t0, 'dim=', res.data[0].embedding.length);
  } catch (e) {
    console.log('embed FAIL ms=', Date.now() - t0, String(e));
  }

  console.log('--- MILVUS TCP ---');
  const net = await import('net');
  await new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port: 19530, timeout: 5000 }, () => {
      console.log('milvus tcp ok');
      sock.destroy();
      resolve();
    });
    sock.on('error', (e) => {
      console.log('milvus tcp error', e.message);
      resolve();
    });
    sock.on('timeout', () => {
      console.log('milvus tcp timeout');
      sock.destroy();
      resolve();
    });
  });

  await redis.quit();
  await p.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await redis.quit(); } catch {}
  try { await p.$disconnect(); } catch {}
  process.exit(1);
});
