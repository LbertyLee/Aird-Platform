/**
 * Diagnose latest search vs extraction on the API host (needs DATABASE_URL).
 *
 *   node scripts/inspect-latest-run.mjs
 *   RUN_ID=cmv6... node scripts/inspect-latest-run.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const runIdFilter = process.env.RUN_ID?.trim();

async function main() {
  const run = await prisma.researchRun.findFirst({
    where: {
      status: 'COMPLETED',
      ...(runIdFilter ? { id: runIdFilter } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      query: true,
      usedExa: true,
      matchedLocally: true,
      createdAt: true,
      sourceIds: true,
      resultJson: true,
    },
  });
  if (!run) {
    console.log('No completed research run found.');
    return;
  }

  const resultJson = run.resultJson && typeof run.resultJson === 'object' ? run.resultJson : {};
  const aiQueryId =
    typeof resultJson.aiQueryId === 'string' ? resultJson.aiQueryId : null;
  const stages = Array.isArray(resultJson.stages) ? resultJson.stages : [];
  const plan = resultJson.plan ?? null;

  const sourceIds = Array.isArray(run.sourceIds)
    ? run.sourceIds.filter((id) => typeof id === 'string')
    : [];
  const sources = sourceIds.length
    ? await prisma.researchSource.findMany({
        where: { id: { in: sourceIds } },
        select: {
          id: true,
          title: true,
          origin: true,
          sourceUrl: true,
          textContent: true,
          metadata: true,
          recordCount: true,
        },
      })
    : [];

  const evidence = aiQueryId
    ? await prisma.queryEvidence.findMany({
        where: { aiQueryId },
        orderBy: { createdAt: 'asc' },
        select: {
          evidenceType: true,
          sourceType: true,
          score: true,
          content: true,
          metadataJson: true,
        },
      })
    : [];

  const sessions = await prisma.analysisSession.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, query: true, status: true, createdAt: true, resultJson: true },
  });
  const linkedSessions = sessions.filter((s) => {
    const r = s.resultJson;
    return r && typeof r === 'object' && r.runId === run.id;
  });

  const diagnosis = {
    run: {
      id: run.id,
      query: run.query,
      createdAt: run.createdAt,
      usedExa: run.usedExa,
      matchedLocally: run.matchedLocally,
      aiQueryId,
      plan,
      stages: {
        plan: stages.find((s) => s?.key === 'plan'),
        vector: stages.find((s) => s?.key === 'vector'),
        database: stages.find((s) => s?.key === 'database'),
        exa: stages.filter((s) => s?.key === 'exa'),
      },
    },
    retrieval: {
      sourceCount: sources.length,
      exaSources: sources.filter((s) => s.origin === 'exa').map(summarizeSource),
      localSources: sources.filter((s) => s.origin !== 'exa').map(summarizeSource),
      externalEvidenceCount: evidence.filter((e) => e.evidenceType === 'external').length,
      externalEvidencePreview: evidence
        .filter((e) => e.evidenceType === 'external')
        .slice(0, 5)
        .map((e) => ({
          score: e.score,
          url: e.metadataJson?.url,
          contentChars: e.content?.length ?? 0,
          preview: e.content?.slice(0, 280),
          relevanceScore: e.metadataJson?.relevanceScore,
          matchedEntities: e.metadataJson?.matchedEntities,
        })),
    },
    extraction: linkedSessions.map((s) => summarizeSession(s)),
    howToRead: {
      searchWeak:
        'externalEvidenceCount=0 或 exa stage skipped/failed → 检索阶段无可用外部结果',
      searchOkExtractFail:
        '有 Exa 来源且 preview/正文含数字，但 extraction.observationCount=0 或 warnings 含「校验」「仅有标题」「未发现明确数值」→ 多为正文拉取或 LLM/校验失败',
      wrongTopic:
        '证据 preview 无「中国/美国」或 GDP 数值，但列表仍有来源 → 域名/相关性仍偏题（看 matchedEntities、URL）',
    },
  };

  console.log(JSON.stringify(diagnosis, null, 2));
}

function summarizeSource(s) {
  const meta = s.metadata && typeof s.metadata === 'object' ? s.metadata : {};
  const body = s.textContent ?? '';
  const title = s.title ?? '';
  return {
    id: s.id,
    title: title.slice(0, 100),
    origin: s.origin,
    url: s.sourceUrl,
    contentMode: meta.contentMode,
    contentProvider: meta.contentProvider,
    contentChars: body.length,
    titleOnly: body.trim() === title.trim(),
    hasNumbers: /\d+(?:\.\d+)?\s*(?:亿元|万亿|%|美元|万元)/.test(body.slice(0, 8000)),
    bodyPreview: body.slice(0, 350),
  };
}

function summarizeSession(s) {
  const r = s.resultJson && typeof s.resultJson === 'object' ? s.resultJson : {};
  const observations = Array.isArray(r.observations) ? r.observations : [];
  const sources = Array.isArray(r.sources) ? r.sources : [];
  return {
    sessionId: s.id,
    status: s.status,
    createdAt: s.createdAt,
    observationCount: observations.length,
    queryDimensions: r.queryDimensions,
    warnings: Array.isArray(r.warnings) ? r.warnings.slice(0, 8) : [],
    perSource: sources.map((x) => ({
      title: x?.title?.slice?.(0, 80),
      observationCount: x?.observationCount,
      capability: x?.capability,
      message: x?.message,
    })),
    llmTraces: Array.isArray(r.llmExtractionTraces)
      ? r.llmExtractionTraces.map((t) => ({
          sourceTitle: t?.sourceTitle?.slice?.(0, 60),
          itemCount: t?.itemCount,
          rejectedItemCount: t?.rejectedItemCount,
          error: t?.error,
          documentCharCount: t?.documentCharCount,
        }))
      : [],
  };
}

main()
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
