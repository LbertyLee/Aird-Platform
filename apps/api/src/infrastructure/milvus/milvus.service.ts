import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DataType,
  LoadState,
  MetricType,
  MilvusClient,
  type FieldType,
  type RowData,
} from '@zilliz/milvus2-sdk-node';

/** 指标向量库 */
export const COL_INDICATORS = 'aird_indicators';
/** 字典向量库 */
export const COL_DICTIONARIES = 'aird_dictionaries';
/** @deprecated 数据集不再向量化；启动时会尝试删除遗留 collection */
export const COL_DATASET_CHUNKS = 'aird_dataset_chunks';
/** 知识条目分块向量库 */
export const COL_KNOWLEDGE_CHUNKS = 'aird_knowledge_chunks';

export type VectorHit = {
  id: string;
  score: number;
  fields: Record<string, unknown>;
};

/**
 * Milvus 客户端：ensure collection、upsert、delete、search。
 */
@Injectable()
export class MilvusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MilvusService.name);
  private client!: MilvusClient;
  private dim = 1024;
  private ready = false;
  private readonly searchTimeoutMs: number;
  private readonly allowStartupSchemaChanges: boolean;

  /**
   * @param config 环境配置
   */
  constructor(private readonly config: ConfigService) {
    this.searchTimeoutMs = Math.max(
      1_000,
      config.get<number>('MILVUS_SEARCH_TIMEOUT_MS') ?? 15_000,
    );
    const schemaChanges = config.get<string>('MILVUS_SCHEMA_CHANGES_ON_START');
    // Collection creation/recreation is destructive. Require an explicit opt-in
    // even in production so a shared Milvus instance cannot be changed by boot.
    this.allowStartupSchemaChanges = schemaChanges === 'true';
  }

  /**
   * 连接并确保业务 collection 存在。
   */
  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('STORAGE_DRIVER') === 'memory') {
      this.ready = false;
      this.logger.log('Milvus startup skipped because STORAGE_DRIVER=memory');
      return;
    }
    const address = this.config.getOrThrow<string>('MILVUS_ADDRESS');
    this.dim = this.config.getOrThrow<number>('EMBEDDING_DIM');
    this.client = new MilvusClient({ address });
    try {
      await this.client.checkHealth();
      await this.ensureCollections();
      if (this.allowStartupSchemaChanges) {
        await this.dropLegacyDatasetChunks();
      }
      this.ready = true;
      this.logger.log(`Milvus ready → ${address}`);
    } catch (err) {
      this.ready = false;
      this.logger.error(`Milvus init failed: ${String(err)}`);
    }
  }

  /**
   * 关闭连接。
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.closeConnection();
    } catch {
      // ignore
    }
  }

  /**
   * 是否可用。
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * 确保业务 collection 已创建并加载。
   */
  private async ensureCollections(): Promise<void> {
    await this.ensureCollection(COL_INDICATORS, [
      { name: 'name', data_type: DataType.VarChar, max_length: 256 },
      { name: 'code', data_type: DataType.VarChar, max_length: 128 },
      { name: 'category', data_type: DataType.VarChar, max_length: 128 },
    ]);
    await this.ensureCollection(COL_DICTIONARIES, [
      { name: 'type', data_type: DataType.VarChar, max_length: 64 },
      { name: 'code', data_type: DataType.VarChar, max_length: 128 },
      { name: 'name', data_type: DataType.VarChar, max_length: 256 },
    ]);
    await this.ensureCollection(COL_KNOWLEDGE_CHUNKS, [
      { name: 'knowledge_id', data_type: DataType.VarChar, max_length: 64 },
      {
        name: 'knowledge_version_id',
        data_type: DataType.VarChar,
        max_length: 64,
      },
      { name: 'chunk_index', data_type: DataType.Int64 },
      { name: 'text', data_type: DataType.VarChar, max_length: 4096 },
    ]);
  }

  /**
   * 删除遗留的数据集分块向量库（数据集模块不再向量化）。
   */
  private async dropLegacyDatasetChunks(): Promise<void> {
    const has = await this.client.hasCollection({
      collection_name: COL_DATASET_CHUNKS,
    });
    if (!has.value) return;
    try {
      await this.client.releaseCollection({
        collection_name: COL_DATASET_CHUNKS,
      });
    } catch {
      // 未加载时忽略
    }
    await this.client.dropCollection({
      collection_name: COL_DATASET_CHUNKS,
    });
    this.logger.warn(`Dropped legacy Milvus collection ${COL_DATASET_CHUNKS}`);
  }

  /**
   * Milvus SDK may return `data_type` as enum number or string label; prefer numeric `dataType`.
   */
  private normalizeFieldDataType(field: {
    data_type?: DataType | string;
    dataType?: number;
  }): number | undefined {
    if (typeof field.dataType === 'number') return field.dataType;
    if (typeof field.data_type === 'number') return field.data_type;
    if (typeof field.data_type === 'string') {
      const mapped = DataType[field.data_type as keyof typeof DataType];
      if (typeof mapped === 'number') return mapped;
    }
    return undefined;
  }

  /**
   * 创建并加载单个 collection。
   */
  private async ensureCollection(
    name: string,
    extraFields: FieldType[],
    allowSchemaChanges = this.allowStartupSchemaChanges,
  ): Promise<void> {
    const has = await this.client.hasCollection({ collection_name: name });
    const expectedFields: FieldType[] = [
      {
        name: 'id',
        data_type: DataType.VarChar,
        is_primary_key: true,
        max_length: 128,
      },
      {
        name: 'vector',
        data_type: DataType.FloatVector,
        dim: this.dim,
      },
      ...extraFields,
    ];

    // Collection schemas are immutable in Milvus.  A collection created by an
    // older API may still exist while new ingestion code sends additional
    // scalar fields (for example knowledge_version_id); in that case Milvus
    // rejects every insert with the unhelpful "some field does not exist"
    // error. Recreate only the incompatible collection during startup so the
    // application converges to the schema expected by the running code.
    if (has.value) {
      const description = await this.client.describeCollection({
        collection_name: name,
      });
      const actualFields = description.schema?.fields ?? [];
      const actualByName = new Map(
        actualFields.map((field) => [field.name, field]),
      );
      const incompatible = expectedFields.some((expected) => {
        const actual = actualByName.get(expected.name);
        const actualType = actual
          ? this.normalizeFieldDataType(actual)
          : undefined;
        if (
          !actual ||
          actualType === undefined ||
          actualType !== expected.data_type
        )
          return true;
        const params = new Map(
          (actual.type_params ?? []).map(
            (param) => [param.key, String(param.value)] as const,
          ),
        );
        if (
          expected.max_length &&
          String(params.get('max_length') ?? actual.max_length ?? '') !==
            String(expected.max_length)
        )
          return true;
        if (
          expected.dim &&
          String(params.get('dim') ?? actual.dim ?? '') !== String(expected.dim)
        )
          return true;
        return false;
      });
      const unexpected = actualFields.some(
        (actual) =>
          !expectedFields.some((expected) => expected.name === actual.name),
      );
      if (
        incompatible ||
        unexpected ||
        actualFields.length !== expectedFields.length
      ) {
        if (!allowSchemaChanges) {
          throw new Error(
            `Milvus collection ${name} has an incompatible schema; startup changes are disabled`,
          );
        }
        try {
          await this.client.releaseCollection({ collection_name: name });
        } catch {
          // Collection may not be loaded; dropping it below is still safe.
        }
        await this.client.dropCollection({ collection_name: name });
        this.logger.warn(`Recreated incompatible Milvus collection ${name}`);
        has.value = false;
      }
    }
    if (!has.value) {
      if (!allowSchemaChanges) {
        throw new Error(
          `Milvus collection ${name} is missing; startup changes are disabled`,
        );
      }
      await this.client.createCollection({
        collection_name: name,
        fields: expectedFields,
      });
      await this.client.createIndex({
        collection_name: name,
        field_name: 'vector',
        index_name: 'vector_idx',
        index_type: 'AUTOINDEX',
        metric_type: MetricType.COSINE,
      });
      this.logger.log(`Created Milvus collection ${name}`);
    }
    if (allowSchemaChanges) {
      await this.client.loadCollection({ collection_name: name });
    } else {
      const loadState = await this.client.getLoadState({
        collection_name: name,
      });
      if (loadState.state !== LoadState.LoadStateLoaded) {
        throw new Error(
          `Milvus collection ${name} is not loaded; startup changes are disabled`,
        );
      }
    }
  }

  /**
   * Upsert 单条向量记录。
   */
  async upsert(collection: string, rows: RowData[]): Promise<void> {
    this.assertReady();
    if (!rows.length) return;
    await this.client.upsert({
      collection_name: collection,
      data: rows,
    });
    await this.client.flushSync({ collection_names: [collection] });
  }

  /**
   * 按主键删除。
   */
  async deleteByIds(collection: string, ids: string[]): Promise<void> {
    this.assertReady();
    if (!ids.length) return;
    const quoted = ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');
    await this.client.delete({
      collection_name: collection,
      filter: `id in [${quoted}]`,
    });
  }

  /**
   * 按标量过滤删除（如 dataset_id == "xxx"）。
   */
  async deleteByFilter(collection: string, filter: string): Promise<void> {
    this.assertReady();
    await this.client.delete({
      collection_name: collection,
      filter,
    });
  }

  /**
   * 清空并重建 collection（删除全部向量数据）。
   */
  async purgeCollection(name: string, extraFields: FieldType[]): Promise<void> {
    this.assertReady();
    const has = await this.client.hasCollection({ collection_name: name });
    if (has.value) {
      try {
        await this.client.releaseCollection({ collection_name: name });
      } catch {
        // 未加载时忽略
      }
      await this.client.dropCollection({ collection_name: name });
      this.logger.warn(`Dropped Milvus collection ${name}`);
    }
    await this.ensureCollection(name, extraFields, true);
  }

  /**
   * 清空知识分块向量库，并清理遗留的数据集分块 collection。
   */
  async purgeChunkCollections(): Promise<{ knowledge: boolean }> {
    await this.purgeCollection(COL_KNOWLEDGE_CHUNKS, [
      { name: 'knowledge_id', data_type: DataType.VarChar, max_length: 64 },
      {
        name: 'knowledge_version_id',
        data_type: DataType.VarChar,
        max_length: 64,
      },
      { name: 'chunk_index', data_type: DataType.Int64 },
      { name: 'text', data_type: DataType.VarChar, max_length: 4096 },
    ]);
    await this.dropLegacyDatasetChunks();
    return { knowledge: true };
  }

  /**
   * 向量检索。
   */
  async search(
    collection: string,
    vector: number[],
    topK: number,
    outputFields: string[],
    filter?: string,
  ): Promise<VectorHit[]> {
    this.assertReady();
    const res = await Promise.race([
      this.client.search({
        collection_name: collection,
        data: [vector],
        limit: topK,
        output_fields: outputFields,
        metric_type: MetricType.COSINE,
        filter,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Milvus search timeout after ${this.searchTimeoutMs}ms`,
              ),
            ),
          this.searchTimeoutMs,
        ).unref(),
      ),
    ]);
    const results = (res.results ?? []) as Array<Record<string, unknown>>;
    return results.map((row) => ({
      id: String(row.id ?? row['id']),
      score: Number(row.score ?? row['score'] ?? 0),
      fields: row,
    }));
  }

  private assertReady(): void {
    if (!this.ready) {
      throw new Error('Milvus is not ready');
    }
  }
}
