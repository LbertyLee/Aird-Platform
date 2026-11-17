import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../../infrastructure/ai/embedding.service';
import {
  COL_KNOWLEDGE_CHUNKS,
  MilvusService,
} from '../../infrastructure/milvus/milvus.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { KnowledgeAccessScopeService } from '../knowledge/knowledge-access-scope.service';
import type { SemanticResolution } from '../semantic/semantic.types';
import { RerankerService } from './reranker.service';
import { tokenizeTerms } from '../ingestion/keyword-search';
import type { ResearchFilters } from '@agent/contracts';
import {
  attachRelevanceMetadata,
  buildRelevanceMatcher,
  scoreDocumentRelevance,
  shouldKeepDocument,
} from './retrieval-relevance';
import type { ResearchQueryPlan } from '../search/research-query-plan';

export type RagHit = {
  chunkId: string;
  content: string;
  score: number;
  sourceType: 'knowledge';
  sourceId: string;
  metadata?: Record<string, unknown>;
};

type StoredChunk = {
  id: string;
  knowledgeVersionId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  section: string | null;
};

@Injectable()
export class RagQueryService {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly milvus: MilvusService,
    private readonly prisma: PrismaService,
    private readonly accessScope: KnowledgeAccessScopeService,
    private readonly reranker: RerankerService,
  ) {}

  async search(
    query: string,
    resolution: SemanticResolution,
    topK = 8,
    userId?: string,
    filters?: Partial<ResearchFilters>,
    plan?: ResearchQueryPlan,
  ): Promise<RagHit[]> {
    const hits: RagHit[] = [];

    const accessibleIds = await this.accessScope.resolveRagKnowledgeIds(userId, filters?.libraryIds);
    if (!accessibleIds.size) return [];
    const retrievalSettings = await this.prisma.knowledgeItem.findMany({
      where: { id: { in: [...accessibleIds] } },
      select: {
        id: true,
        library: {
          select: {
            recallTopK: true,
            similarityThreshold: true,
            hybridSemanticWeight: true,
            hybridKeywordWeight: true,
          },
        },
      },
    });
    const settingsById = new Map(
      retrievalSettings.map((item) => [
        item.id,
        {
          topK: item.library?.recallTopK ?? topK,
          threshold: item.library?.similarityThreshold ?? 0,
          semanticWeight: item.library?.hybridSemanticWeight ?? 0.7,
          keywordWeight: item.library?.hybridKeywordWeight ?? 0.3,
        },
      ]),
    );
    const configuredTopK = Math.max(
      topK,
      ...[...settingsById.values()].map((setting) => setting.topK),
    );
    // Filter in Milvus, not after recall: inaccessible vectors must not consume
    // the candidate window and lower the current user's recall quality.
    const filter = this.knowledgeIdFilter(accessibleIds);
    const fetchLimit = Math.min(Math.max(configuredTopK * 4, 24), 200);

    const [vectorResult, keywordResult] = await Promise.allSettled([
      (async () => {
        if (!this.embedding.isReady() || !this.milvus.isReady()) return [];
        const vector = await this.embedding.embed(query);
        return this.milvus.search(
          COL_KNOWLEDGE_CHUNKS,
          vector,
          fetchLimit,
          ['knowledge_id', 'knowledge_version_id', 'chunk_index', 'text'],
          filter,
        );
      })(),
      this.keywordSearch(query, accessibleIds, configuredTopK * 6),
    ]);
    const knowledgeHits =
      vectorResult.status === 'fulfilled' ? vectorResult.value : [];
    const keywordHits =
      keywordResult.status === 'fulfilled' ? keywordResult.value : [];
    const chunkKeys = knowledgeHits.map((hit) => ({
      knowledgeId: String(hit.fields.knowledge_id ?? ''),
      chunkIndex: Number(hit.fields.chunk_index ?? 0),
    }));
    const currentVersions = await this.prisma.knowledgeVersion.findMany({
      where: { knowledgeItemId: { in: [...accessibleIds] }, isCurrent: true },
      select: { id: true, knowledgeItemId: true },
    });
    const versionByKnowledgeId = new Map(
      currentVersions.map((v) => [v.knowledgeItemId, v.id]),
    );
    const chunkRows = await this.prisma.documentChunk.findMany({
      where: {
        OR: chunkKeys
          .map((key) => {
            const versionId = versionByKnowledgeId.get(key.knowledgeId);
            return versionId
              ? { knowledgeVersionId: versionId, chunkIndex: key.chunkIndex }
              : null;
          })
          .filter(
            (
              value,
            ): value is { knowledgeVersionId: string; chunkIndex: number } =>
              Boolean(value),
          ),
      },
      select: {
        id: true,
        knowledgeVersionId: true,
        chunkIndex: true,
        content: true,
        pageNumber: true,
        section: true,
      },
    });
    const chunksByKey = new Map(
      chunkRows.map((chunk) => [
        `${chunk.knowledgeVersionId}:${chunk.chunkIndex}`,
        chunk,
      ]),
    );
    for (const hit of knowledgeHits) {
      const knowledgeId = String(hit.fields.knowledge_id ?? '');
      if (!accessibleIds.has(knowledgeId)) {
        continue;
      }
      if (hit.score < (settingsById.get(knowledgeId)?.threshold ?? 0)) {
        continue;
      }
      const chunkIndex = Number(hit.fields.chunk_index ?? 0);
      const versionId = versionByKnowledgeId.get(knowledgeId);
      if (String(hit.fields.knowledge_version_id ?? '') !== versionId) continue;
      const chunk = versionId
        ? chunksByKey.get(`${versionId}:${chunkIndex}`)
        : undefined;
      hits.push({
        chunkId: chunk?.id ?? hit.id,
        content: chunk?.content ?? String(hit.fields.text ?? ''),
        score: this.hybridScore(
          hit.score,
          chunk?.content ?? String(hit.fields.text ?? ''),
          query,
          settingsById.get(knowledgeId),
        ),
        sourceType: 'knowledge',
        sourceId: knowledgeId,
        metadata: {
          pageNumber: chunk?.pageNumber,
          section: chunk?.section,
          chunkIndex,
        },
      });
    }

    const merged = this.rrfMerge(hits, keywordHits);
    // Expand before relevance filtering. Entity names and table headers are
    // commonly stored in the preceding chunk while the numeric observations
    // live in the following chunk; filtering first drops those observations.
    const expanded = await this.expandAdjacent(
      merged.slice(0, 200),
      versionByKnowledgeId,
    );
    const matches = buildRelevanceMatcher(resolution, filters);
    const relevancePlan = plan;
    const candidates = expanded.filter((hit) =>
      relevancePlan
        ? shouldKeepDocument(hit.content, relevancePlan, (text) =>
            matches(text),
          )
        : matches(hit.content),
    );
    const reranked = await this.reranker.rerank(
      query,
      candidates.map((hit) => ({ id: hit.chunkId, text: hit.content })),
      configuredTopK,
    );
    const rankedBase: RagHit[] = reranked.length
      ? reranked.reduce<RagHit[]>((items, result) => {
          const hit = candidates.find((item) => item.chunkId === result.id);
          if (hit && Number.isFinite(result.score)) {
            const relevance = relevancePlan
              ? scoreDocumentRelevance(hit.content, relevancePlan)
              : null;
            const blendedScore = relevance
              ? result.score * 0.65 + relevance.score * 0.35
              : result.score;
            items.push({
              ...hit,
              score: blendedScore,
              metadata: attachRelevanceMetadata(
                { ...hit.metadata, rerankScore: result.score },
                relevance ?? {
                  score: result.score,
                  matchedEntities: [],
                  matchedMetrics: [],
                  matchedPeriods: [],
                },
              ),
            });
          }
          return items;
        }, [])
      : candidates.map((hit) => {
          if (!relevancePlan) return hit;
          const relevance = scoreDocumentRelevance(hit.content, relevancePlan);
          return {
            ...hit,
            score: hit.score * 0.65 + relevance.score * 0.35,
            metadata: attachRelevanceMetadata({ ...hit.metadata }, relevance),
          };
        });
    // RRF scores are intentionally small (roughly 0.01-0.03); applying the
    // reranker threshold to them discards every fallback result when the
    // remote reranker is unavailable. Only threshold normalized reranker
    // scores, while relevance filtering above still removes off-topic hits.
    const ranked = rankedBase
      .filter((hit) => {
        if (hit.metadata?.rerankScore == null) return true;
        // A reranker score is provider-specific and may be a small logit or
        // probability. Relevance filtering already happened above, so only
        // reject a score when it is explicitly invalid/negative.
        return Number.isFinite(hit.score) && hit.score >= 0;
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, configuredTopK);
    await this.recordKnowledgeHits(ranked);
    return ranked;
  }

  /**
   * 限定单个知识库的召回（测试用，不计 hitCount）。
   */
  async searchInLibrary(
    libraryId: string,
    query: string,
    options?: {
      topK?: number;
      similarityThreshold?: number;
    },
  ): Promise<
    Array<
      RagHit & {
        title: string;
        chunkIndex: number;
      }
    >
  > {
    if (!this.embedding.isReady() || !this.milvus.isReady()) return [];

    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        libraryId,
        deletedAt: null,
        publishStatus: 'published',
        vectorStatus: 'ready',
      },
      select: { id: true, title: true },
    });
    if (!items.length) return [];

    const idSet = new Set(items.map((i) => i.id));
    const titleMap = new Map(items.map((i) => [i.id, i.title]));
    const topK = options?.topK ?? 8;
    const threshold = options?.similarityThreshold ?? 0;
    const fetchLimit = Math.min(Math.max(topK * 8, 40), 200);

    const vector = await this.embedding.embed(query);
    const knowledgeHits = await this.milvus.search(
      COL_KNOWLEDGE_CHUNKS,
      vector,
      fetchLimit,
      ['knowledge_id', 'knowledge_version_id', 'chunk_index', 'text'],
    );

    const currentVersions = await this.prisma.knowledgeVersion.findMany({
      where: { knowledgeItemId: { in: [...idSet] }, isCurrent: true },
      select: { id: true, knowledgeItemId: true },
    });
    const versionByKnowledgeId = new Map(
      currentVersions.map((v) => [v.knowledgeItemId, v.id]),
    );
    const chunkRows = await this.prisma.documentChunk.findMany({
      where: {
        OR: knowledgeHits
          .map((hit) => {
            const knowledgeId = String(hit.fields.knowledge_id ?? '');
            const versionId = versionByKnowledgeId.get(knowledgeId);
            return versionId
              ? {
                  knowledgeVersionId: versionId,
                  chunkIndex: Number(hit.fields.chunk_index ?? 0),
                }
              : null;
          })
          .filter(
            (
              value,
            ): value is { knowledgeVersionId: string; chunkIndex: number } =>
              Boolean(value),
          ),
      },
      select: {
        id: true,
        knowledgeVersionId: true,
        chunkIndex: true,
        content: true,
        pageNumber: true,
        section: true,
      },
    });
    const chunksByKey = new Map(
      chunkRows.map((chunk) => [
        `${chunk.knowledgeVersionId}:${chunk.chunkIndex}`,
        chunk,
      ]),
    );

    const hits: Array<RagHit & { title: string; chunkIndex: number }> = [];
    for (const hit of knowledgeHits) {
      const knowledgeId = String(hit.fields.knowledge_id ?? '');
      if (!idSet.has(knowledgeId)) continue;
      if (hit.score < threshold) continue;

      const chunkIndex = Number(hit.fields.chunk_index ?? 0);
      const versionId = versionByKnowledgeId.get(knowledgeId);
      if (String(hit.fields.knowledge_version_id ?? '') !== versionId) continue;
      const chunk = versionId
        ? chunksByKey.get(`${versionId}:${chunkIndex}`)
        : undefined;
      hits.push({
        chunkId: chunk?.id ?? hit.id,
        content: chunk?.content ?? String(hit.fields.text ?? ''),
        score: hit.score,
        sourceType: 'knowledge',
        sourceId: knowledgeId,
        title: titleMap.get(knowledgeId) ?? '未命名文档',
        chunkIndex,
        metadata: {
          pageNumber: chunk?.pageNumber,
          section: chunk?.section,
        },
      });
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** 同一查询内同一知识条目只计 1 次命中 */
  private async recordKnowledgeHits(hits: RagHit[]) {
    const knowledgeIds = [
      ...new Set(
        hits
          .filter((h) => h.sourceType === 'knowledge' && h.sourceId)
          .map((h) => h.sourceId),
      ),
    ];
    if (!knowledgeIds.length) return;

    // raw SQL：避免 Prisma Client 未 re-generate 时字段未识别
    await this.prisma.$executeRawUnsafe(
      `UPDATE "knowledge_items"
       SET "hit_count" = "hit_count" + 1, "updated_at" = NOW()
       WHERE "deleted_at" IS NULL
         AND "id" = ANY($1::text[])`,
      knowledgeIds,
    );
  }

  private async keywordSearch(
    query: string,
    ids: Set<string>,
    limit: number,
  ): Promise<RagHit[]> {
    // Aliases are alternatives, not mandatory words that all must occur.
    const tokens = tokenizeTerms(query)
      .filter((term) => term.length >= 2)
      .map((term) => `'${term.replace(/['\\]/g, '')}'`)
      .join(' | ');
    if (!tokens || !ids.size) return [];
    const rows = await this.prisma.$queryRawUnsafe<
      Array<StoredChunk & { knowledge_id: string; score: number }>
    >(
      `SELECT dc.id, dc.knowledge_version_id AS "knowledgeVersionId", dc.chunk_index AS "chunkIndex",
              dc.content, dc.page_number AS "pageNumber", dc.section,
              kv.knowledge_item_id AS knowledge_id,
              ts_rank_cd(to_tsvector('simple', coalesce(dc.search_text, '')), to_tsquery('simple', $2)) AS score
       FROM document_chunks dc JOIN knowledge_versions kv ON kv.id = dc.knowledge_version_id
       WHERE kv.is_current = true AND kv.knowledge_item_id = ANY($1::text[])
         AND to_tsvector('simple', coalesce(dc.search_text, '')) @@ to_tsquery('simple', $2)
       ORDER BY score DESC LIMIT $3`,
      [...ids],
      tokens,
      Math.min(Math.max(limit, 20), 200),
    );
    // PostgreSQL's simple configuration does not tokenize Chinese text well.
    // If tsquery returns no rows, use a bounded substring fallback so Chinese
    // queries still recall exact terms and can be reranked downstream.
    if (!rows.length) {
      const fallbackTerms = tokenizeTerms(query)
        .filter((term) => term.length >= 2)
        .slice(0, 8);
      if (fallbackTerms.length) {
        const params = [
          [...ids],
          fallbackTerms,
          Math.min(Math.max(limit, 20), 200),
        ];
        const fallbackRows = await this.prisma.$queryRawUnsafe<
          Array<StoredChunk & { knowledge_id: string; score: number }>
        >(
          `SELECT dc.id, dc.knowledge_version_id AS "knowledgeVersionId", dc.chunk_index AS "chunkIndex",
                  dc.content, dc.page_number AS "pageNumber", dc.section,
                  kv.knowledge_item_id AS knowledge_id,
                  (SELECT count(*)::float FROM unnest($2::text[]) term WHERE dc.search_text ILIKE '%' || term || '%') AS score
           FROM document_chunks dc JOIN knowledge_versions kv ON kv.id = dc.knowledge_version_id
           WHERE kv.is_current = true AND kv.knowledge_item_id = ANY($1::text[])
             AND EXISTS (
               SELECT 1 FROM unnest($2::text[]) term
               WHERE dc.search_text ILIKE '%' || term || '%'
             )
           ORDER BY score DESC LIMIT $3`,
          params,
        );
        return fallbackRows.map((row) => ({
          chunkId: row.id,
          content: row.content,
          score: Number(row.score) || 0,
          sourceType: 'knowledge' as const,
          sourceId: row.knowledge_id,
          metadata: {
            pageNumber: row.pageNumber,
            section: row.section,
            chunkIndex: row.chunkIndex,
            retrieval: 'substring',
          },
        }));
      }
    }
    return rows.map((row) => ({
      chunkId: row.id,
      content: row.content,
      score: Number(row.score) || 0,
      sourceType: 'knowledge' as const,
      sourceId: row.knowledge_id,
      metadata: {
        pageNumber: row.pageNumber,
        section: row.section,
        chunkIndex: row.chunkIndex,
        retrieval: 'bm25',
      },
    }));
  }

  private rrfMerge(
    vectorHits: RagHit[],
    keywordHits: RagHit[],
    k = 60,
  ): RagHit[] {
    const map = new Map<string, { hit: RagHit; score: number }>();
    const add = (items: RagHit[], source: 'vector' | 'bm25') =>
      items.forEach((hit, index) => {
        const current = map.get(hit.chunkId);
        const contribution = 1 / (k + index + 1);
        if (current) {
          current.score += contribution;
          current.hit.metadata = {
            ...current.hit.metadata,
            [`${source}Rank`]: index + 1,
          };
        } else {
          map.set(hit.chunkId, {
            hit: {
              ...hit,
              metadata: { ...hit.metadata, [`${source}Rank`]: index + 1 },
            },
            score: contribution,
          });
        }
      });
    add(vectorHits, 'vector');
    add(keywordHits, 'bm25');
    const ranked = [...map.values()].sort((a, b) => b.score - a.score);
    return ranked.map(({ hit, score }, index) => ({
      ...hit,
      score,
      metadata: {
        ...hit.metadata,
        rrfScore: score,
        rrfRank: index + 1,
      },
    }));
  }

  private async expandAdjacent(
    hits: RagHit[],
    versions: Map<string, string>,
  ): Promise<RagHit[]> {
    if (!hits.length) return hits;
    const keys = hits
      .map((hit) => ({
        versionId: versions.get(hit.sourceId),
        index: Number(hit.metadata?.chunkIndex ?? -1),
      }))
      .filter(
        (item): item is { versionId: string; index: number } =>
          Boolean(item.versionId) && item.index >= 0,
      );
    if (!keys.length) return hits;
    const rows = await this.prisma.documentChunk.findMany({
      where: {
        OR: keys.flatMap(({ versionId, index }) => [
          { knowledgeVersionId: versionId, chunkIndex: index - 1 },
          { knowledgeVersionId: versionId, chunkIndex: index },
          { knowledgeVersionId: versionId, chunkIndex: index + 1 },
        ]),
      },
      select: {
        id: true,
        knowledgeVersionId: true,
        chunkIndex: true,
        content: true,
        pageNumber: true,
        section: true,
      },
    });
    const byKey = new Map(
      rows.map((row) => [`${row.knowledgeVersionId}:${row.chunkIndex}`, row]),
    );
    return hits.map((hit) => {
      const versionId = versions.get(hit.sourceId);
      const index = Number(hit.metadata?.chunkIndex ?? -1);
      if (!versionId || index < 0) return hit;
      const neighbors = [-1, 0, 1]
        .map((offset) => byKey.get(`${versionId}:${index + offset}`))
        .filter(Boolean);
      const content =
        neighbors.length > 1
          ? neighbors.map((row) => row!.content).join('\n\n')
          : hit.content;
      return {
        ...hit,
        content,
        metadata: { ...hit.metadata, adjacentChunkCount: neighbors.length },
      };
    });
  }

  private knowledgeIdFilter(ids: Set<string>): string {
    const quotedIds = [...ids].map(
      (id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
    );
    return `knowledge_id in [${quotedIds.join(',')}]`;
  }

  private hybridScore(
    semanticScore: number,
    content: string,
    query: string,
    settings?: { semanticWeight: number; keywordWeight: number },
  ): number {
    const semanticWeight = Math.max(0, settings?.semanticWeight ?? 0.7);
    const keywordWeight = Math.max(0, settings?.keywordWeight ?? 0.3);
    const totalWeight = semanticWeight + keywordWeight;
    if (!totalWeight) return semanticScore;
    const queryTerms = tokenizeTerms(query);
    const normalizedContent = content.toLowerCase();
    const keywordScore = queryTerms.length
      ? queryTerms.filter((term) => normalizedContent.includes(term)).length /
        queryTerms.length
      : 0;
    return (
      (semanticScore * semanticWeight + keywordScore * keywordWeight) /
      totalWeight
    );
  }
}
