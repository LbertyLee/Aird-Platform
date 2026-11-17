import { extractLegacyWord, readLegacyExcel } from './legacy-office';
import {
  CommonStatus,
  DatasetLinkSource,
  DatasetLinkTargetType,
} from '@prisma/client';
import { Injectable, Logger } from '@nestjs/common';
import { extname } from 'node:path';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PdfTextExtractor } from '../../research/pdf-text.extractor';
import {
  matchDictionariesInText,
  matchIndicatorsInText,
} from './dataset-auto-link';

const MAX_EXTRACT_CHARS = 120_000;
const MAX_CANDIDATES = 3000;

export type AutoLinkApplyResult = {
  indicatorIds: string[];
  dictionaryItemIds: string[];
  addedIndicators: number;
  addedDictionaries: number;
  removedAutoIndicators: number;
  removedAutoDictionaries: number;
};

/**
 * 根据数据集标题/描述/附件正文自动挂载指标与字典关联。
 */
@Injectable()
export class DatasetAutoLinkService {
  private readonly logger = new Logger(DatasetAutoLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly pdfText: PdfTextExtractor,
  ) {}

  /**
   * 抽取可用于匹配的语料（元数据 + 附件文本）。
   */
  async buildCorpus(datasetId: string): Promise<string | null> {
    const row = await this.prisma.dataset.findFirst({
      where: { id: datasetId, deletedAt: null },
      select: {
        name: true,
        code: true,
        description: true,
        fileKey: true,
        fileName: true,
        mimeType: true,
      },
    });
    if (!row) return null;

    const parts = [
      row.name,
      row.code,
      row.description ?? '',
    ];
    if (row.fileKey && this.isExtractable(row.fileName, row.mimeType)) {
      try {
        const buf = await this.minio.getObject(row.fileKey);
        const text = await this.extractFileText(buf, row.fileName);
        if (text) parts.push(text.slice(0, MAX_EXTRACT_CHARS));
      } catch (error) {
        this.logger.warn(
          `auto-link extract failed datasetId=${datasetId}: ${String(error)}`,
        );
      }
    }
    return parts.filter(Boolean).join('\n');
  }

  /**
   * 基于语料刷新自动关联：保留手动关联，尊重用户忽略列表。
   */
  async applyAutoLinks(datasetId: string): Promise<AutoLinkApplyResult> {
    const corpus = await this.buildCorpus(datasetId);
    if (corpus == null) {
      return {
        indicatorIds: [],
        dictionaryItemIds: [],
        addedIndicators: 0,
        addedDictionaries: 0,
        removedAutoIndicators: 0,
        removedAutoDictionaries: 0,
      };
    }

    const [indicators, dictionaries, dismissals, existingIndicators, existingDictionaries] =
      await Promise.all([
        this.prisma.indicator.findMany({
          where: { deletedAt: null, status: CommonStatus.active },
          select: { id: true, name: true, code: true },
          take: MAX_CANDIDATES,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.dictionaryItem.findMany({
          where: { deletedAt: null, status: CommonStatus.active },
          select: { id: true, name: true, code: true, aliases: true },
          take: MAX_CANDIDATES,
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.datasetLinkDismissal.findMany({
          where: { datasetId },
          select: { targetType: true, targetId: true },
        }),
        this.prisma.datasetIndicator.findMany({
          where: { datasetId },
          select: { indicatorId: true, source: true },
        }),
        this.prisma.datasetDictionaryItem.findMany({
          where: { datasetId },
          select: { dictionaryItemId: true, source: true },
        }),
      ]);

    const dismissedIndicators = new Set(
      dismissals
        .filter((row) => row.targetType === DatasetLinkTargetType.indicator)
        .map((row) => row.targetId),
    );
    const dismissedDictionaries = new Set(
      dismissals
        .filter((row) => row.targetType === DatasetLinkTargetType.dictionary)
        .map((row) => row.targetId),
    );
    const manualIndicators = new Set(
      existingIndicators
        .filter((row) => row.source === DatasetLinkSource.manual)
        .map((row) => row.indicatorId),
    );
    const manualDictionaries = new Set(
      existingDictionaries
        .filter((row) => row.source === DatasetLinkSource.manual)
        .map((row) => row.dictionaryItemId),
    );

    const matchedIndicators = matchIndicatorsInText(corpus, indicators)
      .map((hit) => hit.id)
      .filter(
        (id) => !dismissedIndicators.has(id) && !manualIndicators.has(id),
      );
    const matchedDictionaries = matchDictionariesInText(corpus, dictionaries)
      .map((hit) => hit.id)
      .filter(
        (id) => !dismissedDictionaries.has(id) && !manualDictionaries.has(id),
      );

    const previousAutoIndicators = existingIndicators
      .filter((row) => row.source === DatasetLinkSource.auto)
      .map((row) => row.indicatorId);
    const previousAutoDictionaries = existingDictionaries
      .filter((row) => row.source === DatasetLinkSource.auto)
      .map((row) => row.dictionaryItemId);

    const nextAutoIndicators = new Set(matchedIndicators);
    const nextAutoDictionaries = new Set(matchedDictionaries);

    await this.prisma.$transaction(async (tx) => {
      await tx.datasetIndicator.deleteMany({
        where: { datasetId, source: DatasetLinkSource.auto },
      });
      await tx.datasetDictionaryItem.deleteMany({
        where: { datasetId, source: DatasetLinkSource.auto },
      });
      if (matchedIndicators.length) {
        await tx.datasetIndicator.createMany({
          data: matchedIndicators.map((indicatorId) => ({
            datasetId,
            indicatorId,
            source: DatasetLinkSource.auto,
          })),
          skipDuplicates: true,
        });
      }
      if (matchedDictionaries.length) {
        await tx.datasetDictionaryItem.createMany({
          data: matchedDictionaries.map((dictionaryItemId) => ({
            datasetId,
            dictionaryItemId,
            source: DatasetLinkSource.auto,
          })),
          skipDuplicates: true,
        });
      }
    });

    const addedIndicators = matchedIndicators.filter(
      (id) => !previousAutoIndicators.includes(id),
    ).length;
    const addedDictionaries = matchedDictionaries.filter(
      (id) => !previousAutoDictionaries.includes(id),
    ).length;
    const removedAutoIndicators = previousAutoIndicators.filter(
      (id) => !nextAutoIndicators.has(id),
    ).length;
    const removedAutoDictionaries = previousAutoDictionaries.filter(
      (id) => !nextAutoDictionaries.has(id),
    ).length;

    return {
      indicatorIds: [
        ...manualIndicators,
        ...matchedIndicators,
      ],
      dictionaryItemIds: [
        ...manualDictionaries,
        ...matchedDictionaries,
      ],
      addedIndicators,
      addedDictionaries,
      removedAutoIndicators,
      removedAutoDictionaries,
    };
  }

  private isExtractable(
    fileName?: string | null,
    mimeType?: string | null,
  ): boolean {
    const lower = (fileName || '').toLowerCase();
    if (/\.(txt|md|csv|json|docx?|xlsx?|pdf)$/.test(lower)) return true;
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

  private async extractFileText(
    buf: Buffer,
    fileName?: string | null,
  ): Promise<string> {
    const extension = extname(fileName || '').toLowerCase();
    if (extension === '.pdf') {
      const parsed = await this.pdfText.extract(buf);
      return parsed.text;
    }
    if (extension === '.doc') return (await extractLegacyWord(buf)).trim();
    if (extension === '.docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value.trim();
    }
    if (extension === '.csv' || extension === '.xlsx' || extension === '.xls') {
      return this.extractSpreadsheetText(buf, extension);
    }
    return buf.toString('utf-8').trim();
  }

  private async extractSpreadsheetText(
    buf: Buffer,
    extension: '.csv' | '.xlsx' | '.xls',
  ): Promise<string> {
    const ExcelJS = (await import('exceljs')).default;
    const { Readable } = await import('node:stream');
    const workbook = extension === '.xls' ? readLegacyExcel(buf) : new ExcelJS.Workbook();
    if (extension === '.csv') {
      await workbook.csv.read(Readable.from(buf));
    } else if (extension === '.xlsx') {
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
          .map((value) => {
            if (value === null || value === undefined) return '';
            if (typeof value === 'object') return '';
            return String(value).trim();
          })
          .filter(Boolean);
        if (cells.length) lines.push(cells.join('\t'));
      });
    }
    return lines.join('\n').trim();
  }
}
