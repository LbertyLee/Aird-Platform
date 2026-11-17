import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  KnowledgeAuditStatus,
  KnowledgePublishStatus,
  VectorSyncStatus,
} from '@prisma/client';
import { Job } from 'bullmq';
import ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { EmbeddingService } from '../../infrastructure/ai/embedding.service';
import { PdfTextExtractor } from '../../research/pdf-text.extractor';
import { MinioService } from '../../infrastructure/minio/minio.service';
import {
  COL_DICTIONARIES,
  COL_KNOWLEDGE_CHUNKS,
  MilvusService,
} from '../../infrastructure/milvus/milvus.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IngestionService } from '../ingestion/ingestion.service';
import { VECTOR_SYNC_QUEUE, type VectorSyncJob } from './vector-sync.types';

const MAX_EXTRACT_CHARS = 120_000;

/**
 * 文本分块（按字符近似切片）。
 */
function chunkText(text: string, size = 800, overlap = 100): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];
  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    chunks.push(cleaned.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

/**
 * 是否可从附件抽取检索文本。
 */
function isExtractable(
  fileName?: string | null,
  mimeType?: string | null,
): boolean {
  const lower = (fileName || '').toLowerCase();
  if (/\.(txt|md|csv|json|docx|xlsx|pdf)$/.test(lower)) return true;
  const mime = (mimeType || '').toLowerCase();
  return (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('csv') ||
    mime.includes('pdf') ||
    mime.includes('wordprocessingml') ||
    mime.includes('spreadsheetml')
  );
}

function formatCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if ('result' in value && value.result !== undefined) {
    return formatCellValue(value.result);
  }
  if ('richText' in value) {
    return value.richText.map((item) => item.text).join('');
  }
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return '';
}

/**
 * 向量同步 Worker。
 */
@Processor(VECTOR_SYNC_QUEUE, { lockDuration: 10 * 60 * 1000 })
export class VectorSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(VectorSyncProcessor.name);

  /**
   * @param prisma Prisma
   * @param embedding Embedding
   * @param milvus Milvus
   * @param minio MinIO
   * @param pdfText PDF 文本抽取
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly milvus: MilvusService,
    private readonly minio: MinioService,
    private readonly pdfText: PdfTextExtractor,
    private readonly ingestion: IngestionService,
  ) {
    super();
  }

  /**
   * 处理同步任务。
   */
  async process(job: Job<VectorSyncJob>): Promise<void> {
    const data = job.data;
    try {
      if (data.action === 'delete') {
        await this.handleDelete(data.entity, data.id);
        return;
      }
      await this.handleUpsert(data.entity, data.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `vector-sync failed ${data.entity}/${data.id}: ${message}`,
      );
      await this.markFailed(data.entity, data.id, message);
      throw err;
    }
  }

  private async handleDelete(
    entity: VectorSyncJob['entity'],
    id: string,
  ): Promise<void> {
    if (!this.milvus.isReady()) return;
    if (entity === 'indicator') {
      return;
    }
    if (entity === 'dictionary') {
      await this.milvus.deleteByIds(COL_DICTIONARIES, [id]);
      return;
    }
    await this.milvus.deleteByFilter(
      COL_KNOWLEDGE_CHUNKS,
      `knowledge_id == "${id}"`,
    );
  }

  private async handleUpsert(
    entity: VectorSyncJob['entity'],
    id: string,
  ): Promise<void> {
    if (!this.embedding.isReady() || !this.milvus.isReady()) {
      throw new Error('Embedding or Milvus not ready');
    }
    if (entity === 'indicator') {
      return;
    }
    if (entity === 'dictionary') {
      await this.syncDictionary(id);
      return;
    }
    // Compatibility for jobs already queued before the ingestion unification.
    // Knowledge writes must always create a version and DocumentChunk records.
    await this.ingestion.reingestKnowledgeItem(id);
  }

  private async syncDictionary(id: string): Promise<void> {
    const row = await this.prisma.dictionaryItem.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) return;
    await this.prisma.dictionaryItem.update({
      where: { id },
      data: { vectorStatus: VectorSyncStatus.processing, vectorError: null },
    });
    const text = [
      row.name,
      row.code,
      row.type,
      ...(row.aliases ?? []),
      row.description ?? '',
    ].join('\n');
    const vector = await this.embedding.embed(text);
    await this.milvus.upsert(COL_DICTIONARIES, [
      {
        id: row.id,
        vector,
        type: row.type.slice(0, 64),
        code: row.code.slice(0, 128),
        name: row.name.slice(0, 256),
      },
    ]);
    await this.prisma.dictionaryItem.update({
      where: { id },
      data: { vectorStatus: VectorSyncStatus.ready, vectorError: null },
    });
  }

  private async syncKnowledge(id: string): Promise<void> {
    const row = await this.prisma.knowledgeItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: { select: { name: true, code: true } },
        tags: { include: { tag: { select: { name: true, code: true } } } },
      },
    });
    if (!row) return;

    if (
      row.auditStatus !== KnowledgeAuditStatus.approved ||
      row.publishStatus !== KnowledgePublishStatus.published
    ) {
      this.logger.warn(
        `knowledge ${id} skip upsert: audit=${row.auditStatus} publish=${row.publishStatus}`,
      );
      await this.milvus.deleteByFilter(
        COL_KNOWLEDGE_CHUNKS,
        `knowledge_id == "${id}"`,
      );
      await this.prisma.knowledgeItem.update({
        where: { id },
        data: {
          vectorStatus: VectorSyncStatus.pending,
          vectorError: '未审核通过或未发布，跳过向量化',
          chunkCount: 0,
          vectorSyncedAt: null,
        },
      });
      return;
    }

    await this.prisma.knowledgeItem.update({
      where: { id },
      data: { vectorStatus: VectorSyncStatus.processing, vectorError: null },
    });

    const tagLabels = row.tags
      .map((link) => [link.tag.name, link.tag.code].filter(Boolean).join(' '))
      .filter(Boolean);
    const meta = [
      row.category ? `分类: ${row.category.name} (${row.category.code})` : '',
      tagLabels.length ? `标签: ${tagLabels.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const parts: string[] = [
      `标题: ${row.title}`,
      `编码: ${row.code}`,
      row.summary ? `摘要: ${row.summary}` : '',
      row.content ? `正文: ${row.content}` : '',
      meta,
    ];

    if (row.fileKey && isExtractable(row.fileName, row.mimeType)) {
      try {
        const buf = await this.minio.getObject(row.fileKey);
        const extracted = await this.extractFileText(
          buf,
          row.fileName,
          row.mimeType,
        );
        if (extracted) {
          parts.push(extracted.slice(0, MAX_EXTRACT_CHARS));
        }
      } catch (err) {
        this.logger.warn(`knowledge ${id} file extract failed: ${String(err)}`);
      }
    }

    const fullText = parts.filter(Boolean).join('\n');
    const library = row.libraryId
      ? await this.prisma.knowledgeLibrary.findFirst({
          where: { id: row.libraryId, deletedAt: null },
          select: { chunkSize: true, chunkOverlap: true },
        })
      : null;
    const chunkSize = library?.chunkSize ?? 800;
    const chunkOverlap = Math.min(
      library?.chunkOverlap ?? 120,
      Math.max(0, chunkSize - 1),
    );
    let chunks = chunkText(fullText, chunkSize, chunkOverlap);
    await this.milvus.deleteByFilter(
      COL_KNOWLEDGE_CHUNKS,
      `knowledge_id == "${id}"`,
    );

    if (!chunks.length) {
      chunks = [`${row.title}\n${row.code}${meta ? `\n${meta}` : ''}`];
    } else if (meta) {
      chunks = chunks.map((chunk) => `${meta}\n${chunk}`);
    }

    const vectors = await this.embedding.embedMany(chunks);
    const rows = chunks.map((text, index) => ({
      id: `${id}_${index}`,
      vector: vectors[index],
      knowledge_id: id,
      chunk_index: index,
      text: text.slice(0, 4000),
    }));
    await this.milvus.upsert(COL_KNOWLEDGE_CHUNKS, rows);
    await this.prisma.knowledgeItem.update({
      where: { id },
      data: {
        vectorStatus: VectorSyncStatus.ready,
        vectorError: null,
        chunkCount: rows.length,
        vectorSyncedAt: new Date(),
      },
    });
  }

  private async extractFileText(
    buf: Buffer,
    fileName?: string | null,
    mimeType?: string | null,
  ): Promise<string> {
    const extension = extname(fileName || '').toLowerCase();
    const mime = (mimeType || '').toLowerCase();
    if (
      extension === '.pdf' ||
      mime === 'application/pdf' ||
      mime.includes('pdf')
    ) {
      const parsed = await this.pdfText.extract(buf);
      return parsed.text;
    }
    if (extension === '.docx') {
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value.trim();
    }
    if (extension === '.csv' || extension === '.xlsx') {
      return this.extractSpreadsheetText(buf, extension);
    }
    return buf.toString('utf-8').trim();
  }

  private async extractSpreadsheetText(
    buf: Buffer,
    extension: '.csv' | '.xlsx',
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    if (extension === '.csv') {
      await workbook.csv.read(Readable.from(buf));
    } else {
      const excelBuffer = buf as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0];
      await workbook.xlsx.load(excelBuffer);
    }
    const lines: string[] = [];
    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow((row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        const cells = values
          .map((value) => formatCellValue(value as ExcelJS.CellValue).trim())
          .filter(Boolean);
        if (cells.length) lines.push(cells.join('\t'));
      });
    }
    return lines.join('\n').trim();
  }

  private async markFailed(
    entity: VectorSyncJob['entity'],
    id: string,
    message: string,
  ): Promise<void> {
    const data = {
      vectorStatus: VectorSyncStatus.failed,
      vectorError: message.slice(0, 1000),
    };
    try {
      if (entity === 'indicator') {
        return;
      }
      if (entity === 'dictionary') {
        await this.prisma.dictionaryItem.updateMany({
          where: { id },
          data,
        });
        return;
      }
      await this.prisma.knowledgeItem.updateMany({
        where: { id },
        data,
      });
    } catch {
      // ignore
    }
  }
}
