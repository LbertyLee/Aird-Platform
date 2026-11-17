import {
  CommonStatus,
  KnowledgeAuditStatus,
  KnowledgePublishStatus,
  KnowledgeVisibility,
  DatasetPublishStatus,
  DatasetVisibility,
} from '@prisma/client';
import { KnowledgeAccessScopeService } from './knowledge-access-scope.service';

describe('KnowledgeAccessScopeService', () => {
  const service = new KnowledgeAccessScopeService({} as never);
  const userId = 'user-1';

  it('buildAccessibleKnowledgeItemWhere includes public and own libraries', () => {
    const where = service.buildAccessibleKnowledgeItemWhere(userId);
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toHaveLength(3);
    expect(where.OR?.[0]).toMatchObject({
      library: { visibility: KnowledgeVisibility.public },
      auditStatus: KnowledgeAuditStatus.approved,
      publishStatus: KnowledgePublishStatus.published,
    });
    expect(where.OR?.[1]).toMatchObject({
      library: { createdBy: userId },
    });
    expect(where.OR?.[2]).toMatchObject({
      submittedBy: userId,
    });
  });

  it('isDatasetAccessible allows public external datasets', () => {
    const accessible = new Set<string>();
    expect(
      service.isDatasetAccessible(
        {
          code: 'world_bank_gdp',
          remark: null,
          visibility: DatasetVisibility.public,
        },
        accessible,
      ),
    ).toBe(true);
  });

  it('isDatasetAccessible denies private external datasets', () => {
    expect(
      service.isDatasetAccessible(
        {
          code: 'private_data',
          remark: null,
          visibility: DatasetVisibility.private,
        },
        new Set<string>(),
      ),
    ).toBe(false);
  });

  it('isDatasetAccessible allows kb datasets linked to accessible knowledge', () => {
    const accessible = new Set(['ki-1']);
    expect(
      service.isDatasetAccessible(
        {
          code: 'kb_research-kb-abc',
          remark: 'knowledgeItemId=ki-1',
          visibility: DatasetVisibility.private,
        },
        accessible,
      ),
    ).toBe(true);
    expect(
      service.isDatasetAccessible(
        {
          code: 'kb_research-kb-xyz',
          remark: 'knowledgeItemId=ki-2',
          visibility: DatasetVisibility.private,
        },
        accessible,
      ),
    ).toBe(false);
  });

  it('extractKnowledgeItemId parses remark', () => {
    expect(service.extractKnowledgeItemId('knowledgeItemId=abc')).toBe('abc');
    expect(service.extractKnowledgeItemId('other')).toBeNull();
  });

  it('buildAccessibleStructuredDatasetWhere includes public external sources', () => {
    const where = service.buildAccessibleStructuredDatasetWhere(
      userId,
      new Set(['ki-1']),
    );
    expect(where.deletedAt).toBeNull();
    expect(where.status).toBe(CommonStatus.active);
    expect(where.publishStatus).toBe(DatasetPublishStatus.published);
    expect(where.OR?.length).toBeGreaterThanOrEqual(1);
  });
});
