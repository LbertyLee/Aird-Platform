import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ResearchRunStatus,
  SourceOrigin,
  StorageType,
} from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { CreateSourceInput, SourceEntity } from './research.types';
import type { WorldBankQueryCriteria } from './world-bank-data.service';
import {
  browsableExternalUrl,
  externalUrlLookupVariants,
} from '../common/utils/external-search-domain';

export interface CachedResearchRun {
  id: string;
  sourceIds: string[];
  sourceScores: Record<string, number>;
  createdAt: string;
  resultJson?: unknown;
}

export interface CachedResearchBranch {
  sourceIds: string[];
  sourceScores: Record<string, number>;
  createdAt: string;
}

interface MemoryRun {
  id: string;
  userId?: string;
  query: string;
  status: ResearchRunStatus;
  queryFingerprint?: string;
  filters?: Record<string, string[]>;
  cacheExpiresAt?: Date;
  sourceIds?: string[];
  sourceScores?: Record<string, number>;
  createdAt: Date;
  resultJson?: unknown;
}

interface MemoryBranchCache {
  sourceIds: string[];
  sourceScores: Record<string, number>;
  cacheExpiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class ResearchRepository {
  private readonly logger = new Logger(ResearchRepository.name);
  private readonly memorySources = new Map<string, SourceEntity>();
  private readonly memoryRuns = new Map<string, MemoryRun>();
  private readonly memoryBranchCache = new Map<string, MemoryBranchCache>();
  private useMemory: boolean;
  private readonly allowMemoryFallback: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.useMemory = config.get('STORAGE_DRIVER') === 'memory';
    this.allowMemoryFallback =
      config.get<boolean>('STORAGE_FALLBACK_TO_MEMORY') ?? false;
  }

  get storageMode(): 'postgres' | 'memory' {
    return this.useMemory ? 'memory' : 'postgres';
  }

  async createSource(input: CreateSourceInput): Promise<SourceEntity> {
    const normalizedUrl = input.sourceUrl
      ? browsableExternalUrl(input.sourceUrl)
      : undefined;
    const normalizedInput = { ...input, sourceUrl: normalizedUrl };

    const source = await this.withStorage(
      async () => {
        const data = {
          title: normalizedInput.title,
          origin: this.toPrismaOrigin(normalizedInput.origin),
          storageType: this.toPrismaStorageType(normalizedInput.storageType),
          sourceUrl: normalizedUrl ?? null,
          mimeType: normalizedInput.mimeType,
          textContent: normalizedInput.textContent,
          searchText: normalizedInput.searchText,
          structuredData:
            normalizedInput.structuredData === undefined
              ? undefined
              : (normalizedInput.structuredData as Prisma.InputJsonValue),
          metadata: normalizedInput.metadata as
            Prisma.InputJsonValue | undefined,
          recordCount: normalizedInput.recordCount,
        };

        if (!normalizedUrl) {
          const source = await this.prisma.researchSource.create({ data });
          return this.mapSource(source);
        }

        const variants = externalUrlLookupVariants(
          input.sourceUrl ?? normalizedUrl,
        );
        const matches = await this.prisma.researchSource.findMany({
          where: { sourceUrl: { in: variants } },
          orderBy: { updatedAt: 'desc' },
        });

        if (matches.length) {
          // Prefer the row that already owns the browsable URL so we never
          // rename a bare host onto a www URL that another row already has.
          const canonical =
            matches.find((row) => row.sourceUrl === normalizedUrl) ??
            matches[0];
          const duplicates = matches.filter((row) => row.id !== canonical.id);
          const fullTextDonor =
            matches.find((row) => {
              const meta =
                row.metadata &&
                typeof row.metadata === 'object' &&
                !Array.isArray(row.metadata)
                  ? (row.metadata as Record<string, unknown>)
                  : null;
              return (
                meta?.contentMode === 'full' && Boolean(row.textContent?.trim())
              );
            }) ?? canonical;

          const updateBase = await this.buildSourceUpdatePreservingFullText(
            fullTextDonor.sourceUrl ?? normalizedUrl,
            { ...data, sourceUrl: normalizedUrl },
            normalizedInput.metadata,
          );

          const updated = await this.prisma.$transaction(async (tx) => {
            if (duplicates.length) {
              await tx.researchSource.deleteMany({
                where: { id: { in: duplicates.map((row) => row.id) } },
              });
            }
            return tx.researchSource.update({
              where: { id: canonical.id },
              data: {
                ...updateBase,
                sourceUrl: normalizedUrl,
              },
            });
          });
          return this.mapSource(updated);
        }

        const source = await this.prisma.researchSource.create({ data });
        return this.mapSource(source);
      },
      () => {
        const variants = normalizedUrl
          ? externalUrlLookupVariants(input.sourceUrl ?? normalizedUrl)
          : [];
        const matches = normalizedUrl
          ? [...this.memorySources.values()].filter(
              (source) =>
                source.sourceUrl != null && variants.includes(source.sourceUrl),
            )
          : [];
        const existing =
          matches.find((source) => source.sourceUrl === normalizedUrl) ??
          matches[0];
        for (const duplicate of matches) {
          if (existing && duplicate.id !== existing.id) {
            this.memorySources.delete(duplicate.id);
          }
        }
        const preserveFull =
          existing?.metadata?.contentMode === 'full' &&
          normalizedInput.metadata?.contentMode === 'deferred';
        const source: SourceEntity = {
          id: existing?.id ?? randomUUID(),
          title: normalizedInput.title,
          origin: normalizedInput.origin,
          storageType: normalizedInput.storageType,
          sourceUrl: normalizedUrl ?? null,
          mimeType: normalizedInput.mimeType ?? null,
          excerpt: this.excerpt(
            preserveFull ? existing!.textContent : normalizedInput.textContent,
          ),
          recordCount: normalizedInput.recordCount,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          textContent: preserveFull
            ? existing!.textContent
            : normalizedInput.textContent,
          structuredData:
            normalizedInput.structuredData ?? existing?.structuredData,
          metadata: preserveFull
            ? {
                ...(normalizedInput.metadata ?? {}),
                contentMode: 'full',
                fullTextFetchedAt: existing!.metadata?.fullTextFetchedAt,
              }
            : normalizedInput.metadata,
        };
        this.memorySources.set(source.id, source);
        return source;
      },
    );
    return source;
  }

  /**
   * Avoid wiping hydrated Exa full text when the same URL is hit again by a
   * title-only search (contentMode: deferred).
   */
  private async buildSourceUpdatePreservingFullText(
    sourceUrl: string,
    data: {
      title: string;
      origin: SourceOrigin;
      storageType: StorageType;
      sourceUrl: string | undefined;
      mimeType: string | undefined;
      textContent: string;
      searchText: string;
      structuredData: Prisma.InputJsonValue | undefined;
      metadata: Prisma.InputJsonValue | undefined;
      recordCount: number;
    },
    incomingMetadata?: Record<string, unknown>,
  ) {
    const existing = await this.prisma.researchSource.findUnique({
      where: { sourceUrl },
      select: { textContent: true, searchText: true, metadata: true },
    });
    const existingMeta =
      existing?.metadata &&
      typeof existing.metadata === 'object' &&
      !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : {};
    const preserveFull =
      existingMeta.contentMode === 'full' &&
      incomingMetadata?.contentMode === 'deferred';
    if (!preserveFull) return data;
    return {
      ...data,
      textContent: existing!.textContent,
      searchText: existing!.searchText,
      metadata: {
        ...existingMeta,
        ...incomingMetadata,
        contentMode: 'full',
        fullTextFetchedAt: existingMeta.fullTextFetchedAt,
      } as Prisma.InputJsonValue,
    };
  }

  /** Persist deferred Exa full text after the user selects the source for analysis. */
  async updateSourceFullText(
    id: string,
    textContent: string,
    metadataPatch?: Record<string, unknown>,
  ): Promise<SourceEntity | null> {
    return this.withStorage(
      async () => {
        const existing = await this.prisma.researchSource.findUnique({
          where: { id },
        });
        if (!existing) return null;
        const previousMeta =
          existing.metadata &&
          typeof existing.metadata === 'object' &&
          !Array.isArray(existing.metadata)
            ? (existing.metadata as Record<string, unknown>)
            : {};
        const updated = await this.prisma.researchSource.update({
          where: { id },
          data: {
            textContent,
            searchText: `${existing.title}\n${textContent}`.slice(0, 200_000),
            metadata: {
              ...previousMeta,
              ...metadataPatch,
              contentMode: 'full',
              fullTextFetchedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        return this.mapSource(updated);
      },
      () => {
        const existing = this.memorySources.get(id);
        if (!existing) return null;
        const next: SourceEntity = {
          ...existing,
          textContent,
          excerpt: this.excerpt(textContent),
          metadata: {
            ...(existing.metadata ?? {}),
            ...metadataPatch,
            contentMode: 'full',
            fullTextFetchedAt: new Date().toISOString(),
          },
        };
        this.memorySources.set(id, next);
        return next;
      },
    );
  }

  async updateSourceMetadata(
    id: string,
    metadataPatch: Record<string, unknown>,
  ): Promise<void> {
    await this.withStorage(
      async () => {
        const existing = await this.prisma.researchSource.findUnique({
          where: { id },
          select: { metadata: true },
        });
        if (!existing) return;
        const previous =
          existing.metadata &&
          typeof existing.metadata === 'object' &&
          !Array.isArray(existing.metadata)
            ? (existing.metadata as Record<string, unknown>)
            : {};
        await this.prisma.researchSource.update({
          where: { id },
          data: {
            metadata: {
              ...previous,
              ...metadataPatch,
            } as Prisma.InputJsonValue,
          },
        });
      },
      () => {
        const existing = this.memorySources.get(id);
        if (!existing) return;
        this.memorySources.set(id, {
          ...existing,
          metadata: { ...(existing.metadata ?? {}), ...metadataPatch },
        });
      },
    );
  }

  async searchSources(query: string): Promise<SourceEntity[]> {
    const tokens = this.tokenize(query);
    return this.withStorage(
      async () => {
        const sources = await this.prisma.researchSource.findMany({
          where: {
            OR: tokens.flatMap((token) => [
              { title: { contains: token, mode: 'insensitive' as const } },
              { searchText: { contains: token, mode: 'insensitive' as const } },
            ]),
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        return this.rankSources(
          sources.map((source) => this.mapSource(source)),
          tokens,
        );
      },
      () => this.rankSources([...this.memorySources.values()], tokens),
    );
  }

  async getSourcesByIds(ids: string[]): Promise<SourceEntity[]> {
    if (ids.length === 0) return [];
    return this.withStorage(
      async () => {
        const sources = await this.prisma.researchSource.findMany({
          where: { id: { in: ids } },
        });
        const mapped = new Map(
          sources.map((source) => {
            const value = this.mapSource(source);
            return [value.id, value];
          }),
        );
        return ids
          .map((id) => mapped.get(id))
          .filter((source): source is SourceEntity => Boolean(source));
      },
      () =>
        ids
          .map((id) => this.memorySources.get(id))
          .filter((source): source is SourceEntity => Boolean(source)),
    );
  }

  async findCachedRun(fingerprint: string): Promise<CachedResearchRun | null> {
    const now = new Date();
    return this.withStorage(
      async () => {
        const run = await this.prisma.researchRun.findFirst({
          where: {
            queryFingerprint: fingerprint,
            status: ResearchRunStatus.COMPLETED,
            cacheExpiresAt: { gt: now },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            sourceIds: true,
            sourceScores: true,
            createdAt: true,
            resultJson: true,
          },
        });
        return run
          ? {
              id: run.id,
              sourceIds: this.stringArray(run.sourceIds),
              sourceScores: this.numberRecord(run.sourceScores),
              createdAt: run.createdAt.toISOString(),
              resultJson: run.resultJson,
            }
          : null;
      },
      () => {
        const run = [...this.memoryRuns.values()]
          .filter(
            (item) =>
              item.queryFingerprint === fingerprint &&
              item.status === ResearchRunStatus.COMPLETED &&
              item.cacheExpiresAt &&
              item.cacheExpiresAt > now,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return run
          ? {
              id: run.id,
              sourceIds: run.sourceIds ?? [],
              sourceScores: run.sourceScores ?? {},
              createdAt: run.createdAt.toISOString(),
              resultJson: run.resultJson,
            }
          : null;
      },
    );
  }

  /** Reuse previously fetched official observations when the public API is unavailable. */
  async findWorldBankStructuredSources(
    criteria: WorldBankQueryCriteria,
  ): Promise<SourceEntity[]> {
    const filter = (sources: SourceEntity[]) =>
      sources
        .filter(
          (source) =>
            source.storageType === 'structured' &&
            source.metadata?.provider === 'world-bank-api',
        )
        .map((source) => this.filterWorldBankRows(source, criteria))
        .filter((source): source is SourceEntity => Boolean(source));

    return this.withStorage(
      async () => {
        const sources = await this.prisma.researchSource.findMany({
          where: { storageType: StorageType.STRUCTURED },
          orderBy: { createdAt: 'desc' },
          take: 100,
        });
        return filter(sources.map((source) => this.mapSource(source)));
      },
      () => filter([...this.memorySources.values()]),
    );
  }

  async findCachedBranch(
    fingerprint: string,
  ): Promise<CachedResearchBranch | null> {
    const now = new Date();
    return this.withStorage(
      async () => {
        const branch = await this.prisma.researchBranchCache.findUnique({
          where: { fingerprint },
          select: {
            sourceIds: true,
            sourceScores: true,
            cacheExpiresAt: true,
            createdAt: true,
          },
        });
        if (!branch || branch.cacheExpiresAt <= now) return null;
        return {
          sourceIds: this.stringArray(branch.sourceIds),
          sourceScores: this.numberRecord(branch.sourceScores),
          createdAt: branch.createdAt.toISOString(),
        };
      },
      () => {
        const branch = this.memoryBranchCache.get(fingerprint);
        if (!branch || branch.cacheExpiresAt <= now) return null;
        return {
          sourceIds: branch.sourceIds,
          sourceScores: branch.sourceScores,
          createdAt: branch.createdAt.toISOString(),
        };
      },
    );
  }

  async cacheBranch(input: {
    fingerprint: string;
    sourceIds: string[];
    sourceScores: Record<string, number>;
    cacheExpiresAt: Date;
  }): Promise<void> {
    await this.withStorage(
      async () => {
        await this.prisma.researchBranchCache.upsert({
          where: { fingerprint: input.fingerprint },
          create: input,
          update: {
            sourceIds: input.sourceIds,
            sourceScores: input.sourceScores,
            cacheExpiresAt: input.cacheExpiresAt,
          },
        });
      },
      () => {
        this.memoryBranchCache.set(input.fingerprint, {
          sourceIds: input.sourceIds,
          sourceScores: input.sourceScores,
          cacheExpiresAt: input.cacheExpiresAt,
          createdAt: new Date(),
        });
      },
    );
  }

  async createRun(input: {
    query: string;
    fingerprint: string;
    filters: Record<string, string[]>;
    userId?: string;
  }): Promise<string> {
    return this.withStorage(
      async () =>
        (
          await this.prisma.researchRun.create({
            data: {
              query: input.query,
              userId: input.userId,
              queryFingerprint: input.fingerprint,
              filters: input.filters,
              status: ResearchRunStatus.RUNNING,
            },
          })
        ).id,
      () => {
        const id = randomUUID();
        this.memoryRuns.set(id, {
          id,
          userId: input.userId,
          query: input.query,
          queryFingerprint: input.fingerprint,
          filters: input.filters,
          status: ResearchRunStatus.RUNNING,
          createdAt: new Date(),
        });
        return id;
      },
    );
  }

  async completeRun(input: {
    id: string;
    matchedLocally: boolean;
    usedExa: boolean;
    sourceIds: string[];
    sourceScores: Record<string, number>;
    cacheExpiresAt: Date;
    reportMarkdown?: string;
    resultJson?: unknown;
  }): Promise<void> {
    await this.withStorage(
      async () => {
        await this.prisma.researchRun.update({
          where: { id: input.id },
          data: {
            status: ResearchRunStatus.COMPLETED,
            matchedLocally: input.matchedLocally,
            usedExa: input.usedExa,
            sourceIds: input.sourceIds,
            sourceScores: input.sourceScores,
            cacheExpiresAt: input.cacheExpiresAt,
            reportMarkdown: input.reportMarkdown,
            resultJson:
              input.resultJson === undefined
                ? undefined
                : (input.resultJson as Prisma.InputJsonValue),
          },
        });
      },
      () => {
        const run = this.memoryRuns.get(input.id);
        if (run) {
          run.status = ResearchRunStatus.COMPLETED;
          run.sourceIds = input.sourceIds;
          run.sourceScores = input.sourceScores;
          run.cacheExpiresAt = input.cacheExpiresAt;
          run.resultJson = input.resultJson;
        }
      },
    );
  }

  async getSourceById(id: string): Promise<SourceEntity | null> {
    return this.withStorage(
      async () => {
        const source = await this.prisma.researchSource.findUnique({
          where: { id },
        });
        return source ? this.mapSource(source) : null;
      },
      () => this.memorySources.get(id) ?? null,
    );
  }

  async listUserRuns(userId: string, limit = 20) {
    return this.withStorage(
      async () => {
        const rows = await this.prisma.researchRun.findMany({
          where: { userId, status: ResearchRunStatus.COMPLETED },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { id: true, query: true, createdAt: true, resultJson: true },
        });
        return rows.map((row) => ({
          id: row.id,
          query: row.query,
          createdAt: row.createdAt.toISOString(),
          result: row.resultJson,
        }));
      },
      () =>
        [...this.memoryRuns.values()]
          .filter(
            (run) =>
              run.status === ResearchRunStatus.COMPLETED &&
              run.userId === userId,
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limit)
          .map((run) => ({
            id: run.id,
            query: run.query,
            createdAt: run.createdAt.toISOString(),
            result: run.resultJson,
          })),
    );
  }

  async deleteUserRun(
    userId: string,
    id: string,
  ): Promise<{ deleted: boolean }> {
    return this.withStorage(
      async () => {
        const result = await this.prisma.researchRun.deleteMany({
          where: { id, userId },
        });
        return { deleted: result.count > 0 };
      },
      () => {
        const run = this.memoryRuns.get(id);
        if (!run || run.userId !== userId) return { deleted: false };
        this.memoryRuns.delete(id);
        return { deleted: true };
      },
    );
  }

  async failRun(id: string, errorMessage: string): Promise<void> {
    await this.withStorage(
      async () => {
        await this.prisma.researchRun.update({
          where: { id },
          data: { status: ResearchRunStatus.FAILED, errorMessage },
        });
      },
      () => {
        const run = this.memoryRuns.get(id);
        if (run) run.status = ResearchRunStatus.FAILED;
      },
    );
  }

  private async withStorage<T>(
    postgresAction: () => Promise<T>,
    memoryAction: () => T | Promise<T>,
  ): Promise<T> {
    if (this.useMemory) return memoryAction();
    try {
      return await postgresAction();
    } catch (error) {
      if (!this.allowMemoryFallback) throw error;
      this.useMemory = true;
      this.logger.warn(
        `PostgreSQL unavailable; switched to development memory storage: ${this.errorMessage(error)}`,
      );
      return memoryAction();
    }
  }

  private mapSource(source: {
    id: string;
    title: string;
    origin: SourceOrigin;
    storageType: StorageType;
    sourceUrl: string | null;
    mimeType: string | null;
    textContent: string;
    structuredData: Prisma.JsonValue | null;
    metadata: Prisma.JsonValue | null;
    recordCount: number;
    createdAt: Date;
  }): SourceEntity {
    return {
      id: source.id,
      title: source.title,
      origin: source.origin.toLowerCase() as SourceEntity['origin'],
      storageType:
        source.storageType.toLowerCase() as SourceEntity['storageType'],
      sourceUrl: source.sourceUrl
        ? browsableExternalUrl(source.sourceUrl)
        : source.sourceUrl,
      mimeType: source.mimeType,
      excerpt: this.excerpt(source.textContent),
      recordCount: source.recordCount,
      createdAt: source.createdAt.toISOString(),
      textContent: source.textContent,
      structuredData: source.structuredData ?? undefined,
      metadata:
        source.metadata && typeof source.metadata === 'object'
          ? (source.metadata as Record<string, unknown>)
          : undefined,
    };
  }

  private filterWorldBankRows(
    source: SourceEntity,
    criteria: WorldBankQueryCriteria,
  ): SourceEntity | undefined {
    if (!Array.isArray(source.structuredData)) return undefined;
    const rows = source.structuredData.filter((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const value = row as Record<string, unknown>;
      const countryCode = String(value.countryCode ?? '');
      const indicatorCode = String(value.indicatorCode ?? '');
      const year = Number(value.year);
      return (
        criteria.countries.includes(countryCode) &&
        criteria.indicatorCodes.includes(indicatorCode) &&
        Number.isFinite(year) &&
        year >= criteria.start &&
        year <= criteria.end
      );
    });
    if (rows.length === 0) return undefined;
    return {
      ...source,
      structuredData: rows,
      recordCount: rows.length,
      textContent: rows.map((row) => JSON.stringify(row)).join('\n'),
    };
  }

  private rankSources(
    sources: SourceEntity[],
    tokens: string[],
  ): SourceEntity[] {
    return sources
      .map((source) => {
        const haystack = `${source.title}\n${source.textContent}`.toLowerCase();
        const title = source.title.toLowerCase();
        const matches = tokens.filter((token) => haystack.includes(token));
        const titleMatches = tokens.filter((token) => title.includes(token));
        const score = Math.min(
          1,
          matches.length / Math.max(tokens.length, 1) +
            titleMatches.length * 0.15,
        );
        return { ...source, score };
      })
      .filter((source) => (source.score ?? 0) >= 0.34)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 20);
  }

  private tokenize(query: string): string[] {
    const segments =
      query.toLowerCase().match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? [];
    const tokens = new Set(segments);
    for (const segment of segments) {
      if (/^[\u3400-\u9fff]+$/.test(segment) && segment.length > 2) {
        for (let index = 0; index < segment.length - 1; index += 1) {
          tokens.add(segment.slice(index, index + 2));
        }
      }
    }
    return [...tokens].slice(0, 12);
  }

  private excerpt(content: string): string {
    return content.replace(/\s+/g, ' ').trim().slice(0, 260);
  }

  private stringArray(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private numberRecord(value: Prisma.JsonValue | null): Record<string, number> {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    );
  }

  private toPrismaOrigin(origin: CreateSourceInput['origin']): SourceOrigin {
    return SourceOrigin[origin.toUpperCase() as keyof typeof SourceOrigin];
  }

  private toPrismaStorageType(
    type: CreateSourceInput['storageType'],
  ): StorageType {
    return StorageType[type.toUpperCase() as keyof typeof StorageType];
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
