import { Injectable } from '@nestjs/common';
import {
  CommonStatus,
  Prisma,
  ResearchRunStatus,
  SensitiveWord,
} from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  HotWordItemDto,
  NoResultWordItemDto,
  SensitiveWordViewDto,
} from './dto/operation-response.dto';
import {
  CreateSensitiveWordDto,
  MarkNoResultDto,
  SearchOpsRangeQueryDto,
  SensitiveWordPageQueryDto,
  SetQuickSearchDto,
  UpdateSensitiveWordDto,
} from './dto/operation.dto';

type QueryAgg = { keyword: string; frequency: number; lastAt: Date };

/**
 * 搜索运营：热门词 / 无结果词 / 敏感词 / 快捷检索。
 */
@Injectable()
export class SearchOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  /**
   * 热门搜索词（按 ResearchRun 聚合）。
   */
  async hotWords(
    query: SearchOpsRangeQueryDto,
  ): Promise<PageResultDto<HotWordItemDto>> {
    const days = query.range === '30d' ? 30 : 7;
    const now = new Date();
    const currentStart = new Date(now);
    currentStart.setDate(currentStart.getDate() - days);
    const prevStart = new Date(currentStart);
    prevStart.setDate(prevStart.getDate() - days);

    const [currentAggs, prevAggs, quickRows] = await Promise.all([
      this.aggregateQueries(currentStart, now),
      this.aggregateQueries(prevStart, currentStart),
      this.prisma.searchQuickKeyword.findMany({
        where: { enabled: true },
        select: { keyword: true },
      }),
    ]);
    const quickSet = new Set(quickRows.map((r) => r.keyword));
    const prevMap = new Map(prevAggs.map((a) => [a.keyword, a.frequency]));

    const ranked = currentAggs
      .sort((a, b) => b.frequency - a.frequency)
      .map((item, index) => {
        const prev = prevMap.get(item.keyword) ?? 0;
        let trendPercent = 0;
        if (prev > 0) {
          trendPercent = Math.round(((item.frequency - prev) / prev) * 100);
        } else if (item.frequency > 0) {
          trendPercent = 100;
        }
        return {
          rank: index + 1,
          keyword: item.keyword,
          frequency: item.frequency,
          trendPercent,
          isQuickSearch: quickSet.has(item.keyword),
        } satisfies HotWordItemDto;
      });

    const skip = (query.page - 1) * query.pageSize;
    const items = ranked.slice(skip, skip + query.pageSize);
    return new PageResultDto(items, ranked.length, query.page, query.pageSize);
  }

  /**
   * 导出热门词 CSV 文本。
   */
  async exportHotWordsCsv(range: '7d' | '30d' = '7d'): Promise<string> {
    const page = await this.hotWords({
      range,
      page: 1,
      pageSize: 100,
    });
    const lines = ['排名,搜索词,检索频次,趋势%'];
    for (const row of page.items) {
      const safe = `"${row.keyword.replace(/"/g, '""')}"`;
      lines.push(
        `${row.rank},${safe},${row.frequency},${row.trendPercent}`,
      );
    }
    return lines.join('\n');
  }

  /**
   * 设为快捷检索。
   */
  async setQuickSearch(dto: SetQuickSearchDto, actorId: string) {
    const keyword = dto.keyword.trim();
    if (!keyword) {
      throw new BusinessException(
        'QUICK_KEYWORD_EMPTY',
        '搜索词不能为空',
        400,
      );
    }
    const row = await this.prisma.searchQuickKeyword.upsert({
      where: { keyword },
      update: { enabled: true },
      create: { keyword, enabled: true, sort: 0 },
    });
    await this.audit.write({
      actorId,
      action: 'set_quick_search',
      resourceType: 'search_quick_keyword',
      resourceId: row.id,
      detail: { keyword },
    });
    return { ok: true, id: row.id, keyword: row.keyword };
  }

  /**
   * 无结果搜索词。
   */
  async noResultWords(
    query: SearchOpsRangeQueryDto,
  ): Promise<PageResultDto<NoResultWordItemDto>> {
    const days = query.range === '30d' ? 30 : 7;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const runs = await this.prisma.researchRun.findMany({
      where: {
        status: ResearchRunStatus.COMPLETED,
        createdAt: { gte: since },
      },
      select: { query: true, sourceIds: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const map = new Map<string, QueryAgg>();
    for (const run of runs) {
      if (!this.isEmptySources(run.sourceIds)) continue;
      const keyword = run.query.trim();
      if (!keyword) continue;
      const prev = map.get(keyword);
      if (prev) {
        prev.frequency += 1;
        if (run.createdAt > prev.lastAt) prev.lastAt = run.createdAt;
      } else {
        map.set(keyword, {
          keyword,
          frequency: 1,
          lastAt: run.createdAt,
        });
      }
    }

    const marks = await this.prisma.searchNoResultMark.findMany({
      where: { keyword: { in: [...map.keys()] } },
    });
    const markMap = new Map(marks.map((m) => [m.keyword, m.handled]));

    const ranked = [...map.values()]
      .sort((a, b) => b.frequency - a.frequency || b.lastAt.getTime() - a.lastAt.getTime())
      .map(
        (item) =>
          ({
            keyword: item.keyword,
            lastSearchedAt: item.lastAt.toISOString(),
            frequency: item.frequency,
            handled: markMap.get(item.keyword) === true,
          }) satisfies NoResultWordItemDto,
      );

    const skip = (query.page - 1) * query.pageSize;
    const items = ranked.slice(skip, skip + query.pageSize);
    return new PageResultDto(items, ranked.length, query.page, query.pageSize);
  }

  /**
   * 标记无结果词已处理。
   */
  async markNoResultHandled(
    keywordRaw: string,
    dto: MarkNoResultDto,
    actorId: string,
  ) {
    const keyword = decodeURIComponent(keywordRaw).trim();
    if (!keyword) {
      throw new BusinessException(
        'NO_RESULT_KEYWORD_EMPTY',
        '搜索词不能为空',
        400,
      );
    }
    const row = await this.prisma.searchNoResultMark.upsert({
      where: { keyword },
      update: { handled: true, note: dto.note ?? null },
      create: { keyword, handled: true, note: dto.note ?? null },
    });
    await this.audit.write({
      actorId,
      action: 'mark_no_result',
      resourceType: 'search_no_result_mark',
      resourceId: row.id,
      detail: { keyword },
    });
    return { ok: true, keyword: row.keyword, handled: row.handled };
  }

  /**
   * 敏感词分页。
   */
  async pageSensitiveWords(
    query: SensitiveWordPageQueryDto,
  ): Promise<PageResultDto<SensitiveWordViewDto>> {
    const where: Prisma.SensitiveWordWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.keyword
        ? { word: { contains: query.keyword, mode: 'insensitive' } }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [rows, total] = await Promise.all([
      this.prisma.sensitiveWord.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.sensitiveWord.count({ where }),
    ]);
    return new PageResultDto(
      rows.map((r) => this.toSensitiveView(r)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * 新增敏感词。
   */
  async createSensitiveWord(dto: CreateSensitiveWordDto, actorId: string) {
    const word = dto.word.trim();
    const exists = await this.prisma.sensitiveWord.findFirst({
      where: { word, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException(
        'SENSITIVE_WORD_EXISTS',
        '敏感词已存在',
        409,
      );
    }
    const row = await this.prisma.sensitiveWord.create({
      data: {
        word,
        category: dto.category,
        status: dto.status ?? CommonStatus.active,
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'sensitive_word',
      resourceId: row.id,
    });
    return this.toSensitiveView(row);
  }

  /**
   * 更新敏感词。
   */
  async updateSensitiveWord(
    id: string,
    dto: UpdateSensitiveWordDto,
    actorId: string,
  ) {
    await this.requireSensitive(id);
    if (dto.word) {
      const word = dto.word.trim();
      const clash = await this.prisma.sensitiveWord.findFirst({
        where: { word, deletedAt: null, NOT: { id } },
      });
      if (clash) {
        throw new BusinessException(
          'SENSITIVE_WORD_EXISTS',
          '敏感词已存在',
          409,
        );
      }
    }
    const row = await this.prisma.sensitiveWord.update({
      where: { id },
      data: {
        ...(dto.word ? { word: dto.word.trim() } : {}),
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'sensitive_word',
      resourceId: id,
    });
    return this.toSensitiveView(row);
  }

  /**
   * 启用 / 停用敏感词。
   */
  async setSensitiveStatus(
    id: string,
    status: CommonStatus,
    actorId: string,
  ) {
    await this.requireSensitive(id);
    const row = await this.prisma.sensitiveWord.update({
      where: { id },
      data: { status },
    });
    await this.audit.write({
      actorId,
      action: status === CommonStatus.active ? 'enable' : 'disable',
      resourceType: 'sensitive_word',
      resourceId: id,
    });
    return this.toSensitiveView(row);
  }

  private async aggregateQueries(
    from: Date,
    to: Date,
  ): Promise<QueryAgg[]> {
    const runs = await this.prisma.researchRun.findMany({
      where: {
        createdAt: { gte: from, lt: to },
        status: {
          in: [ResearchRunStatus.COMPLETED, ResearchRunStatus.FAILED],
        },
      },
      select: { query: true, createdAt: true },
      take: 10000,
    });
    const map = new Map<string, QueryAgg>();
    for (const run of runs) {
      const keyword = run.query.trim();
      if (!keyword) continue;
      const prev = map.get(keyword);
      if (prev) {
        prev.frequency += 1;
        if (run.createdAt > prev.lastAt) prev.lastAt = run.createdAt;
      } else {
        map.set(keyword, { keyword, frequency: 1, lastAt: run.createdAt });
      }
    }
    return [...map.values()];
  }

  private isEmptySources(sourceIds: Prisma.JsonValue): boolean {
    if (sourceIds == null) return true;
    if (Array.isArray(sourceIds)) return sourceIds.length === 0;
    return false;
  }

  private async requireSensitive(id: string): Promise<SensitiveWord> {
    const row = await this.prisma.sensitiveWord.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(
        'SENSITIVE_WORD_NOT_FOUND',
        '敏感词不存在',
        404,
      );
    }
    return row;
  }

  private toSensitiveView(row: SensitiveWord): SensitiveWordViewDto {
    return {
      id: row.id,
      word: row.word,
      category: row.category,
      hitCount: row.hitCount,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
