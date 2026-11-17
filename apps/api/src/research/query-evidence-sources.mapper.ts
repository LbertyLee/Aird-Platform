import { KnowledgeVisibility, type Prisma } from '@prisma/client';
import type { ResearchSearchResponse } from '@agent/contracts';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { ResearchRepository } from './research.repository';
import type { SourceEntity } from './research.types';

type QueryEvidenceRow = {
  id: string;
  aiQueryId: string;
  evidenceType: string;
  sourceType: string;
  sourceId: string | null;
  content: string | null;
  sql: string | null;
  score: number | null;
  metadataJson: Prisma.JsonValue;
};

type KnowledgeCatalogRow = {
  id: string;
  title: string;
  submittedBy: string | null;
  library: {
    name: string;
    visibility: KnowledgeVisibility;
    createdBy: string | null;
  } | null;
};

export type KnowledgeSourceScope = 'platform_public' | 'user';

export function resolveKnowledgeSourceScope(
  item: KnowledgeCatalogRow,
  userId?: string,
): KnowledgeSourceScope {
  if (userId) {
    const libraryOwner = item.library?.createdBy;
    if (libraryOwner === userId || item.submittedBy === userId) {
      return 'user';
    }
  }
  if (item.library?.visibility === KnowledgeVisibility.public) {
    return 'platform_public';
  }
  return 'user';
}

export function buildKnowledgeEvidenceTitle(
  documentTitle: string,
  metadata: Record<string, unknown>,
  fallbackIndex: number,
): string {
  const base = documentTitle.trim() || `知识库文档 ${fallbackIndex + 1}`;
  const page =
    typeof metadata.pageNumber === 'number' ? metadata.pageNumber : null;
  const section =
    typeof metadata.section === 'string' && metadata.section.trim()
      ? metadata.section.trim()
      : null;
  const chunkIndex =
    typeof metadata.chunkIndex === 'number' ? metadata.chunkIndex : null;

  if (page != null) return `${base} · 第 ${page} 页`;
  if (section) return `${base} · ${section}`;
  if (chunkIndex != null) return `${base} · 片段 ${chunkIndex + 1}`;
  return base;
}

export function knowledgeScopeLabel(scope: KnowledgeSourceScope): string {
  return scope === 'platform_public' ? '平台公共知识库' : '我的知识库';
}

export function toResearchSourceResponse(
  source: SourceEntity,
): ResearchSearchResponse['sources'][number] {
  const metadata = source.metadata ?? {};
  const knowledgeScope =
    metadata.knowledgeScope === 'platform_public' ||
    metadata.knowledgeScope === 'user'
      ? metadata.knowledgeScope
      : undefined;
  const libraryName =
    typeof metadata.libraryName === 'string' ? metadata.libraryName : undefined;
  const officialRows =
    Array.isArray(source.structuredData) &&
    (typeof metadata.analysisProvider === 'string' ||
      metadata.provider === 'official-api')
      ? source.structuredData
          .slice(0, 5)
          .filter(
            (row): row is Record<string, unknown> =>
              Boolean(row) && typeof row === 'object' && !Array.isArray(row),
          )
          .map((row) => {
            const entity = String(row.country ?? row.entity ?? '');
            const year = String(row.year ?? row.period ?? '');
            const metric = String(
              row.indicator ?? row.indicatorName ?? row.indicatorCode ?? '数据',
            );
            const value = String(row.value ?? '');
            const unit = String(row.unit ?? '');
            return `${entity}${year ? ` ${year}年` : ''} ${metric}：${value}${unit ? ` ${unit}` : ''}`.trim();
          })
          .join('；')
      : '';

  return {
    id: source.id,
    title: source.title,
    origin: source.origin,
    storageType: source.storageType,
    sourceUrl: source.sourceUrl,
    mimeType: source.mimeType,
    excerpt: officialRows || source.excerpt,
    recordCount: source.recordCount,
    structuredData: source.structuredData,
    score: source.score,
    createdAt: source.createdAt,
    knowledgeScope,
    libraryName,
  };
}

async function loadKnowledgeCatalog(
  prisma: PrismaService,
  knowledgeIds: string[],
): Promise<Map<string, KnowledgeCatalogRow>> {
  if (!knowledgeIds.length) return new Map();
  const rows = await prisma.knowledgeItem.findMany({
    where: { id: { in: knowledgeIds } },
    select: {
      id: true,
      title: true,
      submittedBy: true,
      library: {
        select: { name: true, visibility: true, createdBy: true },
      },
    },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

function externalEvidenceTitle(content: string | null, index: number): string {
  const title = content?.split('\n', 1)[0]?.trim();
  return title || `Exa 搜索结果 #${index + 1}`;
}

export async function mapQueryEvidenceToSources(
  evidence: QueryEvidenceRow[],
  deps: {
    repository: ResearchRepository;
    prisma: PrismaService;
    userId?: string;
  },
): Promise<SourceEntity[]> {
  const knowledgeIds = [
    ...new Set(
      evidence
        .filter(
          (row) =>
            row.evidenceType === 'vector' && row.sourceType === 'knowledge',
        )
        .map((row) => row.sourceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const catalog = await loadKnowledgeCatalog(deps.prisma, knowledgeIds);

  const sources = await Promise.all(
    evidence.map(async (item, index) => {
      const metadata = (item.metadataJson ?? {}) as Record<string, unknown>;
      const isExternal = item.evidenceType === 'external';
      const isSql = item.evidenceType === 'sql';
      const officialRows =
        isExternal && Array.isArray(metadata.structuredData)
          ? metadata.structuredData
          : undefined;
      const isKnowledgeVector =
        item.evidenceType === 'vector' && item.sourceType === 'knowledge';

      let title: string;
      let knowledgeScope: KnowledgeSourceScope | undefined;
      let libraryName: string | undefined;

      if (isSql) {
        title = 'PostgreSQL 结构化查询结果';
      } else if (isExternal) {
        title =
          typeof metadata.displayTitle === 'string' &&
          metadata.displayTitle.trim()
            ? metadata.displayTitle
            : externalEvidenceTitle(item.content, index);
      } else if (isKnowledgeVector && item.sourceId) {
        const doc = catalog.get(item.sourceId);
        knowledgeScope = doc
          ? resolveKnowledgeSourceScope(doc, deps.userId)
          : 'platform_public';
        libraryName = doc?.library?.name?.trim() || undefined;
        title = doc
          ? buildKnowledgeEvidenceTitle(doc.title, metadata, index)
          : `知识库文档 ${index + 1}`;
      } else {
        title = `检索片段 ${index + 1}`;
      }

      const persisted = await deps.repository.createSource({
        title,
        origin: isExternal ? 'exa' : isSql ? 'local' : 'upload',
        storageType: isSql || officialRows ? 'structured' : 'knowledge',
        sourceUrl:
          isExternal && typeof metadata.url === 'string'
            ? metadata.url
            : undefined,
        mimeType: isSql || officialRows ? 'application/json' : 'text/plain',
        textContent: item.content ?? item.sql ?? '',
        searchText: `${title}\n${item.content ?? item.sql ?? ''}`,
        structuredData:
          officialRows ??
          (isSql && item.content
            ? (JSON.parse(item.content) as unknown)
            : undefined),
        metadata: {
          aiQueryId: item.aiQueryId,
          evidenceId: item.id,
          evidenceType: item.evidenceType,
          ...metadata,
          ...(isKnowledgeVector && item.sourceId
            ? { knowledgeItemId: item.sourceId }
            : {}),
          ...(isSql ? { datasetVersionId: item.sourceId } : {}),
          ...(knowledgeScope ? { knowledgeScope } : {}),
          ...(libraryName ? { libraryName } : {}),
        },
        recordCount: officialRows
          ? officialRows.length
          : isSql && item.content
            ? (JSON.parse(item.content) as unknown[]).length
            : isKnowledgeVector
              ? 1
              : 0,
      });
      return { ...persisted, score: item.score ?? undefined };
    }),
  );

  return [...new Map(sources.map((source) => [source.id, source])).values()];
}
