import { Injectable } from '@nestjs/common';
import { EvidenceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { RagHit } from './rag-query.service';
import type { SqlQueryResult } from './text-to-sql.service';

@Injectable()
export class EvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async saveSqlEvidence(aiQueryId: string, result: SqlQueryResult) {
    return this.prisma.queryEvidence.create({
      data: {
        aiQueryId,
        evidenceType: EvidenceType.sql,
        sourceType: 'dataset_version',
        sourceId: result.datasetVersionId ?? null,
        sql: result.sql,
        content: JSON.stringify(result.rows),
        score: 1,
        metadataJson: { rowCount: result.rows.length } as Prisma.InputJsonValue,
      },
    });
  }

  async saveVectorEvidence(aiQueryId: string, hits: RagHit[]) {
    return Promise.all(
      hits.map((hit) =>
        this.prisma.queryEvidence.create({
          data: {
            aiQueryId,
            evidenceType: EvidenceType.vector,
            sourceType: hit.sourceType,
            sourceId: hit.sourceId,
            content: hit.content,
            score: hit.score,
            metadataJson: {
              chunkId: hit.chunkId,
              ...hit.metadata,
            } as Prisma.InputJsonValue,
          },
        }),
      ),
    );
  }

  async saveExternalEvidence(
    aiQueryId: string,
    items: Array<{
      title: string;
      content: string;
      url?: string;
      score?: number;
      metadata?: Record<string, unknown>;
    }>,
  ) {
    return Promise.all(
      items.map((item) =>
        this.prisma.queryEvidence.create({
          data: {
            aiQueryId,
            evidenceType: EvidenceType.external,
            sourceType: 'exa',
            // Search stores title (+ optional short content). Full page text is
            // fetched later when the user selects the source for analysis.
            content: `${item.title}${item.content ? `\n${item.content}` : ''}`.slice(
              0,
              12_000,
            ),
            score: item.score ?? 0.5,
            metadataJson: {
              url: item.url,
              contentMode: 'deferred',
              ...(item.metadata ?? {}),
            } as Prisma.InputJsonValue,
          },
        }),
      ),
    );
  }
}
