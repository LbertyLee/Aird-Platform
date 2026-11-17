import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { MilvusClient, DataType, MetricType } from '@zilliz/milvus2-sdk-node';

const COL = 'knowledge_chunks';
const knowledgeId = 'cmtma8j2a0018qaa03hi78guq';
const address = process.env.MILVUS_ADDRESS || 'localhost:19530';
const dim = Number(process.env.EMBEDDING_DIM || 1024);

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT || 16379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
});

function timed(label, p, ms = 30000) {
  const t0 = Date.now();
  return Promise.race([
    p.then((v) => {
      console.log(label, 'ok', Date.now() - t0, 'ms');
      return v;
    }),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label} TIMEOUT ${ms}ms`)), ms),
    ),
  ]);
}

async function main() {
  console.log('AI_API_KEY set =', Boolean(process.env.AI_API_KEY));
  console.log('EMBEDDING_BASE_URL raw =', process.env.EMBEDDING_BASE_URL);
  console.log('MILVUS_ADDRESS =', address);

  const lock = await redis.get('bull:data-ingestion:16:lock');
  const ttl = await redis.pttl('bull:data-ingestion:16:lock');
  const active = await redis.lrange('bull:data-ingestion:active', 0, -1);
  const stalled = await redis.smembers('bull:data-ingestion:stalled');
  const job16 = await redis.hgetall('bull:data-ingestion:16');
  console.log('--- BULL JOB 16 ---');
  console.log({ lock, ttl, active, stalled, processedOn: job16.processedOn, attemptsMade: job16.attemptsMade, name: job16.name, data: job16.data });

  const client = new MilvusClient({ address, timeout: 15_000 });
  try {
    await timed('milvus.checkHealth', client.checkHealth(), 15000);
    await timed('milvus.hasCollection', client.hasCollection({ collection_name: COL }), 15000);
    await timed('milvus.loadCollection', client.loadCollection({ collection_name: COL }), 30000);
    await timed(
      'milvus.delete',
      client.delete({
        collection_name: COL,
        filter: `knowledge_id == "${knowledgeId}"`,
      }),
      30000,
    );
    const dummy = Array.from({ length: dim }, () => 0.01);
    await timed(
      'milvus.upsert',
      client.upsert({
        collection_name: COL,
        data: [
          {
            id: `${knowledgeId}_debug`,
            vector: dummy,
            knowledge_id: knowledgeId,
            chunk_index: 999,
            text: 'debug',
          },
        ],
      }),
      30000,
    );
    await timed(
      'milvus.flushSync',
      client.flushSync({ collection_names: [COL] }),
      60000,
    );
    await timed(
      'milvus.delete debug row',
      client.delete({
        collection_name: COL,
        filter: `id in ["${knowledgeId}_debug"]`,
      }),
      30000,
    );
  } catch (e) {
    console.error('MILVUS FAIL', e);
  } finally {
    try {
      await client.closeConnection();
    } catch {}
  }

  await redis.quit();
}

main().catch(async (e) => {
  console.error(e);
  try { await redis.quit(); } catch {}
  process.exit(1);
});
