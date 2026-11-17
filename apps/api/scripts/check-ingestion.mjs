import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const items = await p.knowledgeItem.findMany({
  where: { deletedAt: null },
  orderBy: { updatedAt: 'desc' },
  take: 5,
  select: {
    id: true,
    title: true,
    fileName: true,
    auditStatus: true,
    publishStatus: true,
    vectorStatus: true,
    vectorError: true,
    chunkCount: true,
    updatedAt: true,
  },
});
console.log('ITEMS', JSON.stringify(items, null, 2));
const jobs = await p.ingestionJob.findMany({
  orderBy: { createdAt: 'desc' },
  take: 10,
});
console.log('JOBS', JSON.stringify(jobs, null, 2));
const vers = await p.knowledgeVersion.findMany({
  orderBy: { createdAt: 'desc' },
  take: 5,
});
console.log('VERSIONS', JSON.stringify(vers, null, 2));
await p.$disconnect();
