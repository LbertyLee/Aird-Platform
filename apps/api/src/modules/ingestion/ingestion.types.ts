export const INGESTION_QUEUE = 'data-ingestion';

export type IngestionJobPayload = {
  jobId: string;
  targetType: 'dataset' | 'knowledge';
  targetId: string;
  versionId: string;
  priority?: number;
  tenantKey?: string;
};

export type DetectedField = {
  fieldName: string;
  displayName?: string;
  dataType: string;
  semanticType?: string;
  nullable: boolean;
  sampleValues: unknown[];
};

export type ParsedIngestionResult = {
  storageType: 'structured' | 'knowledge';
  textContent: string;
  structuredRecords: Record<string, unknown>[];
  metadata: Record<string, unknown>;
};
