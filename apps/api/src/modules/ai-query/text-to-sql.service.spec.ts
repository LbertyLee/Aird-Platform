import { TextToSqlService } from './text-to-sql.service';
import { SqlValidatorService } from './sql-validator.service';
import type { SemanticResolution } from '../semantic/semantic.types';

describe('structured metric retrieval', () => {
  const resolution: SemanticResolution = {
    metrics: [{ indicatorId: 'gdp', code: 'gdp_current_usd', name: 'GDP' }],
    entities: [],
    dimensions: [],
    concepts: [],
    time: { type: 'YEAR', value: 2024 },
    confidence: 1,
    intent: 'metric_query',
  };
  const schemaFields = (names: string[]) =>
    names.map((fieldName) => ({
      fieldName,
      displayName: null,
      dataType: 'string',
      semanticType: null,
    }));

  it('groups aggregate results by all selected dimensions including unit', () => {
    const service = new TextToSqlService(
      {} as never,
      new SqlValidatorService(),
      {} as never,
    );
    const sql = service['buildQuerySql'](
      'version',
      'gdp',
      schemaFields(['year', 'country', 'unit', 'gdp']),
      resolution,
      'SUM',
    );
    expect(sql).toContain('GROUP BY 1, 2, 3');
    expect(sql).toContain('SUM(CASE WHEN');
    expect(sql).toContain('IS NOT NULL');
    expect(new SqlValidatorService().validate(sql).valid).toBe(true);
  });

  it('keeps queries valid without time or entity fields and filters missing values before limiting', () => {
    const service = new TextToSqlService(
      {} as never,
      new SqlValidatorService(),
      {} as never,
    );
    const series = service['buildQuerySql'](
      'version',
      'gdp',
      schemaFields(['gdp']),
      resolution,
      'NONE',
    );
    expect(series).toContain('ORDER BY row_index ASC');
    expect(series).not.toContain('ORDER BY year');
    expect(series.indexOf('IS NOT NULL')).toBeLessThan(
      series.indexOf('LIMIT 100'),
    );
    const aggregate = service['buildQuerySql'](
      'version',
      'gdp',
      schemaFields(['gdp']),
      resolution,
      'AVG',
    );
    expect(aggregate).toContain('AVG(CASE WHEN');
    expect(aggregate).not.toContain('GROUP BY');
  });

  it('tries another mapping after empty values and preserves every requested metric, country and unit', async () => {
    const mapping = (indicatorId: string, version: string, unit: string) => ({
      indicatorId,
      aggregation: 'NONE',
      datasetField: {
        fieldName: indicatorId,
        unit,
        datasetSchema: {
          datasetVersionId: version,
          datasetVersion: { dataset: {} },
        },
      },
    });
    const prisma = {
      indicatorFieldMapping: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            mapping('gdp', 'empty', '亿元'),
            mapping('gdp', 'gdp-version', '亿元'),
            mapping('cpi', 'cpi-version', '%'),
          ]),
      },
      datasetSchema: {
        findUnique: jest.fn().mockResolvedValue({
          datasetVersion: { status: 'ready' },
          fields: ['year', 'country', 'gdp', 'cpi'].map((fieldName) => ({
            fieldName,
          })),
        }),
      },
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce([{ year: '2024', metric_value: null }])
        .mockResolvedValueOnce([
          { year: '2024', entity: '中国', metric_value: '100' },
        ])
        .mockResolvedValueOnce([
          { year: '2024', entity: '中国', metric_value: '2.5' },
        ]),
    };
    const access = {
      resolveAccessibleKnowledgeIds: async () => new Set(),
      isDatasetAccessible: () => true,
    };
    const service = new TextToSqlService(
      prisma as never,
      new SqlValidatorService(),
      access as never,
    );
    const resolution: SemanticResolution = {
      metrics: [
        { indicatorId: 'gdp', code: 'gdp_current_usd', name: 'GDP' },
        { indicatorId: 'cpi', code: 'cpi', name: 'CPI' },
      ],
      entities: ['中国', '美国', '日本', '德国'].map((name) => ({
        name,
        code: name,
        entityId: name,
      })),
      dimensions: [],
      concepts: [],
      time: { type: 'RANGE', start: '2023', end: '2024' },
      confidence: 1,
      intent: 'metric_query',
    };
    const result = await service.execute(resolution, 'user');
    expect(result?.rows).toEqual([
      expect.objectContaining({
        indicatorCode: 'gdp_current_usd',
        value: 100,
        unit: '亿元',
        entity: '中国',
        year: '2024',
        datasetVersionId: 'gdp-version',
      }),
      expect.objectContaining({ indicatorCode: 'cpi', value: 2.5, unit: '%' }),
    ]);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
    expect(prisma.$queryRawUnsafe.mock.calls[1][0]).toContain('德国');
    expect(prisma.$queryRawUnsafe.mock.calls[1][0]).toContain('CASE WHEN');
    expect(
      prisma.indicatorFieldMapping.findMany.mock.calls[0][0].take,
    ).toBeUndefined();
  });
});
