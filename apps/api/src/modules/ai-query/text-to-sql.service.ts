import { Injectable, Logger } from '@nestjs/common';
import type { ResearchFilters } from '@agent/contracts';
import { CommonStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { KnowledgeAccessScopeService } from '../knowledge/knowledge-access-scope.service';
import type { SemanticResolution } from '../semantic/semantic.types';
import { SqlValidatorService } from './sql-validator.service';

export type SqlQueryResult = {
  sql: string;
  rows: Record<string, unknown>[];
  datasetVersionId?: string;
  fieldNames: string[];
};

type SchemaField = {
  fieldName: string;
  displayName: string | null;
  dataType: string;
  semanticType: string | null;
};

const TIME_FIELD_CANDIDATES = [
  '年份',
  '年',
  'year',
  'Year',
  'YEAR',
  'date',
  'Date',
  '时间',
  'period',
];

const ENTITY_FIELD_CANDIDATES = [
  '国家',
  '地区',
  '区域',
  '省份',
  '城市',
  'country',
  'Country',
  'region',
  'Region',
  'area',
];

@Injectable()
export class TextToSqlService {
  private readonly logger = new Logger(TextToSqlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: SqlValidatorService,
    private readonly accessScope: KnowledgeAccessScopeService,
  ) {}

  async execute(
    resolution: SemanticResolution,
    userId?: string,
    filters?: Partial<ResearchFilters>,
  ): Promise<SqlQueryResult | null> {
    const mappings = await this.findFieldMappings(
      resolution.metrics.map((m) => m.indicatorId),
      userId,
      filters,
    );
    if (!mappings.length) return null;

    const rows: Record<string, unknown>[] = [];
    const statements: string[] = [];
    const fieldNames = new Set<string>();
    let firstVersionId: string | undefined;
    for (const metric of resolution.metrics) {
      // A stale/empty mapping must not prevent trying another published version.
      for (const mapping of mappings.filter(
        (item) => item.indicatorId === metric.indicatorId,
      )) {
        const versionId = mapping.datasetField.datasetSchema.datasetVersionId;
        const schema = await this.prisma.datasetSchema.findUnique({
          where: { datasetVersionId: versionId },
          include: {
            fields: true,
            datasetVersion: { include: { dataset: true } },
          },
        });
        if (!schema || schema.datasetVersion.status !== 'ready') continue;

        const metricField = mapping.datasetField.fieldName;
        const aggregation = (mapping.aggregation || 'NONE').toUpperCase();
        const sql = this.buildQuerySql(
          versionId,
          metricField,
          schema.fields,
          resolution,
          aggregation,
        );
        const check = this.validator.validate(sql);
        if (!check.valid) {
          this.logger.warn(`SQL 校验失败: ${check.reason}; sql=${sql}`);
          continue;
        }

        try {
          const found =
            await this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
          const usable = (Array.isArray(found) ? found : []).filter(
            (row) =>
              row.metric_value != null &&
              String(row.metric_value).trim() !== '' &&
              Number.isFinite(Number(row.metric_value)),
          );
          if (!usable.length) continue;
          usable.forEach((row) =>
            rows.push({
              ...row,
              indicatorCode: metric.code,
              indicatorName: metric.name,
              value: Number(row.metric_value),
              unit: row.unit ?? mapping.datasetField.unit ?? undefined,
              datasetVersionId: versionId,
            }),
          );
          statements.push(sql);
          firstVersionId ??= versionId;
          schema.fields.forEach((field) => fieldNames.add(field.fieldName));
          break;
        } catch (err) {
          this.logger.warn(
            `SQL 执行失败: ${err instanceof Error ? err.message : String(err)}; sql=${sql}`,
          );
          continue;
        }
      }
    }
    return rows.length
      ? {
          sql: statements.join(';\n'),
          rows,
          datasetVersionId: firstVersionId,
          fieldNames: [...fieldNames],
        }
      : null;
  }

  private buildQuerySql(
    datasetVersionId: string,
    metricField: string,
    fields: SchemaField[],
    resolution: SemanticResolution,
    aggregation: string,
  ): string {
    const fieldNames = fields.map((f) => f.fieldName);
    const safeMetric = this.quoteJsonKey(metricField);
    const timeField = this.pickField(fieldNames, TIME_FIELD_CANDIDATES, [
      'time',
      'year',
      'date',
      '年份',
    ]);
    const entityField = this.pickField(fieldNames, ENTITY_FIELD_CANDIDATES, [
      'dimension',
      'region',
      'country',
      'geo',
      '国家',
      '地区',
    ]);

    const where: string[] = [
      `dataset_version_id = '${this.escapeLiteral(datasetVersionId)}'`,
    ];

    if (timeField) {
      const timeExpr = `substring(data->>${this.quoteJsonKey(timeField)} from '[12][0-9]{3}')`;
      if (resolution.time.type === 'YEAR' && resolution.time.value != null) {
        where.push(`${timeExpr} = '${resolution.time.value}'`);
      } else if (
        resolution.time.type === 'RANGE' &&
        resolution.time.start &&
        resolution.time.end
      ) {
        where.push(
          `${timeExpr}::int BETWEEN ${Number(resolution.time.start)} AND ${Number(resolution.time.end)}`,
        );
      }
    }

    const entityNames = [
      ...resolution.entities.map((e) => e.name),
      ...resolution.dimensions
        .filter((d) =>
          /region|country|geo|area|国家|地区/i.test(`${d.type}${d.name}`),
        )
        .map((d) => d.name),
    ].filter(Boolean);
    if (entityField && entityNames.length) {
      const likes = entityNames.map(
        (name) =>
          `data->>${this.quoteJsonKey(entityField)} ILIKE '%${this.escapeLiteral(name)}%'`,
      );
      where.push(`(${likes.join(' OR ')})`);
    }

    const rawMetric = `replace(replace(trim(data->>${safeMetric}), ',', ''), '，', '')`;
    const numericMetric = `CASE WHEN ${rawMetric} ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' THEN (${rawMetric})::numeric END`;
    // Filter before LIMIT so empty cells cannot crowd out valid observations.
    where.push(`(${numericMetric}) IS NOT NULL`);
    const whereSql = where.join('\n        AND ');
    const unitField = this.pickField(
      fieldNames,
      ['unit', 'units', '单位', '计量单位'],
      [],
    );
    const dimensions = [
      ...(timeField
        ? [
            `substring(data->>${this.quoteJsonKey(timeField)} from '[12][0-9]{3}') AS year`,
          ]
        : []),
      ...(entityField
        ? [`data->>${this.quoteJsonKey(entityField)} AS entity`]
        : []),
      ...(unitField ? [`data->>${this.quoteJsonKey(unitField)} AS unit`] : []),
    ];
    // 中文表常见「按年明细」；NONE 或时间区间查询时返回逐年序列，避免错误 SUM
    const useSeries =
      aggregation === 'NONE' || resolution.time.type === 'RANGE';

    if (useSeries) {
      return `
      SELECT
        ${[...dimensions, `${numericMetric} AS metric_value`].join(',\n        ')}
      FROM dataset_records
      WHERE ${whereSql}
      ${timeField ? 'ORDER BY year ASC' : 'ORDER BY row_index ASC'}
      LIMIT 100
    `.trim();
    }

    const aggFn =
      aggregation === 'AVG'
        ? 'AVG'
        : aggregation === 'MAX'
          ? 'MAX'
          : aggregation === 'MIN'
            ? 'MIN'
            : aggregation === 'COUNT'
              ? 'COUNT'
              : 'SUM';

    return `
      SELECT ${[...dimensions, `${aggFn}(${numericMetric}) AS metric_value`].join(', ')}
      FROM dataset_records
      WHERE ${whereSql}
      ${dimensions.length ? `GROUP BY ${dimensions.map((_, index) => index + 1).join(', ')}` : ''}
      LIMIT 100
    `.trim();
  }

  private pickField(
    fieldNames: string[],
    exactCandidates: string[],
    semanticHints: string[],
  ): string | undefined {
    const exact = exactCandidates.find((c) => fieldNames.includes(c));
    if (exact) return exact;
    const lowerMap = new Map(fieldNames.map((f) => [f.toLowerCase(), f]));
    for (const c of exactCandidates) {
      const hit = lowerMap.get(c.toLowerCase());
      if (hit) return hit;
    }
    return fieldNames.find((f) =>
      semanticHints.some((h) => f.toLowerCase().includes(h.toLowerCase())),
    );
  }

  /** PostgreSQL jsonb 文本取值：data->>'key'，key 用单引号字面量 */
  private quoteJsonKey(key: string): string {
    return `'${this.escapeLiteral(key)}'`;
  }

  private escapeLiteral(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async findFieldMappings(indicatorIds: string[], userId?: string, filters?: Partial<ResearchFilters>) {
    if (!indicatorIds.length) return [];
    const rows = await this.prisma.indicatorFieldMapping.findMany({
      where: {
        indicatorId: { in: indicatorIds },
        status: CommonStatus.active,
        datasetField: {
          datasetSchema: {
            datasetVersion: {
              status: 'ready',
              dataset: {
                status: CommonStatus.active,
                publishStatus: 'published',
                deletedAt: null,
                ...(!userId ? { visibility: 'public' as const } : {}),
              },
            },
          },
        },
      },
      include: {
        datasetField: {
          include: {
            datasetSchema: {
              include: {
                datasetVersion: {
                  include: {
                    dataset: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { confidence: 'desc' }],
    });

    if (filters?.libraryIds?.length) {
      const ids = await this.accessScope.resolveRagKnowledgeIds(userId, filters.libraryIds);
      return rows.filter((row) => {
        const id = this.accessScope.extractKnowledgeItemId(row.datasetField.datasetSchema.datasetVersion.dataset.remark);
        return Boolean(id && ids.has(id));
      });
    }

    if (!userId) {
      return rows;
    }

    const accessibleKnowledgeIds =
      await this.accessScope.resolveAccessibleKnowledgeIds(userId);
    return rows.filter((row) => {
      const dataset = row.datasetField.datasetSchema.datasetVersion.dataset;
      return this.accessScope.isDatasetAccessible(
        dataset,
        accessibleKnowledgeIds,
      );
    });
  }
}
