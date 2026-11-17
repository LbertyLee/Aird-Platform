import { ConfigService } from '@nestjs/config';
import { DataType, type FieldType } from '@zilliz/milvus2-sdk-node';
import { MilvusService } from './milvus.service';

jest.mock('@zilliz/milvus2-sdk-node', () => ({
  DataType: { VarChar: 21, FloatVector: 101 },
  LoadState: { LoadStateLoaded: 'LoadStateLoaded' },
  MetricType: { COSINE: 'COSINE' },
  MilvusClient: jest.fn(),
}));

describe('MilvusService startup schema safety', () => {
  const fields: FieldType[] = [
    { name: 'name', data_type: DataType.VarChar, max_length: 256 },
  ];

  function createService(existing: boolean) {
    const config = {
      get: (key: string) => (key === 'NODE_ENV' ? 'development' : undefined),
    } as ConfigService;
    const service = new MilvusService(config);
    const client = {
      hasCollection: jest.fn().mockResolvedValue({ value: existing }),
      describeCollection: jest
        .fn()
        .mockResolvedValue({ schema: { fields: [] } }),
      releaseCollection: jest.fn(),
      dropCollection: jest.fn(),
      createCollection: jest.fn(),
      createIndex: jest.fn(),
      loadCollection: jest.fn(),
      getLoadState: jest.fn().mockResolvedValue({ state: 'LoadStateLoaded' }),
    };
    Object.assign(service, { client });
    return { service, client };
  }

  it('does not connect when the API uses memory storage', async () => {
    const config = {
      get: (key: string) => (key === 'STORAGE_DRIVER' ? 'memory' : undefined),
      getOrThrow: jest.fn(),
    } as unknown as ConfigService;
    const service = new MilvusService(config);
    const Client = (
      require('@zilliz/milvus2-sdk-node') as { MilvusClient: jest.Mock }
    ).MilvusClient;
    Client.mockClear();

    await service.onModuleInit();

    expect(Client).not.toHaveBeenCalled();
    expect(service.isReady()).toBe(false);
  });

  it('requires explicit opt-in for startup schema changes in production', () => {
    const config = {
      get: (key: string) => (key === 'NODE_ENV' ? 'production' : undefined),
    } as ConfigService;
    const service = new MilvusService(config);

    expect(
      (service as unknown as { allowStartupSchemaChanges: boolean })
        .allowStartupSchemaChanges,
    ).toBe(false);
  });

  async function ensureCollection(service: MilvusService) {
    await (
      service as unknown as {
        ensureCollection(name: string, fields: FieldType[]): Promise<void>;
      }
    ).ensureCollection('shared_collection', fields);
  }

  it.each([
    ['missing', false],
    ['incompatible', true],
  ])(
    'does not mutate a %s collection during development startup',
    async (_, existing) => {
      const { service, client } = createService(existing);

      await expect(ensureCollection(service)).rejects.toThrow(
        'startup changes are disabled',
      );
      expect(client.createCollection).not.toHaveBeenCalled();
      expect(client.createIndex).not.toHaveBeenCalled();
      expect(client.releaseCollection).not.toHaveBeenCalled();
      expect(client.dropCollection).not.toHaveBeenCalled();
      expect(client.loadCollection).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['LoadStateLoaded', false],
    ['LoadStateNotLoad', true],
  ])(
    'only reads load state %s for an existing compatible collection',
    async (state, rejected) => {
      const { service, client } = createService(true);
      client.describeCollection.mockResolvedValue({
        schema: {
          fields: [
            { name: 'id', data_type: DataType.VarChar, max_length: 128 },
            { name: 'vector', data_type: DataType.FloatVector, dim: 1024 },
            { name: 'name', data_type: DataType.VarChar, max_length: 256 },
          ],
        },
      });
      client.getLoadState.mockResolvedValue({ state });

      if (rejected) {
        await expect(ensureCollection(service)).rejects.toThrow('not loaded');
      } else {
        await expect(ensureCollection(service)).resolves.toBeUndefined();
      }
      expect(client.getLoadState).toHaveBeenCalledTimes(1);
      expect(client.loadCollection).not.toHaveBeenCalled();
      expect(client.createCollection).not.toHaveBeenCalled();
      expect(client.dropCollection).not.toHaveBeenCalled();
    },
  );

  it('accepts compatible collections when describeCollection uses string data_type labels', async () => {
    const { service, client } = createService(true);
    client.describeCollection.mockResolvedValue({
      schema: {
        fields: [
          {
            name: 'id',
            data_type: 'VarChar',
            dataType: DataType.VarChar,
            max_length: '128',
            type_params: [{ key: 'max_length', value: '128' }],
          },
          {
            name: 'vector',
            data_type: 'FloatVector',
            dataType: DataType.FloatVector,
            type_params: [{ key: 'dim', value: '1024' }],
          },
          {
            name: 'name',
            data_type: 'VarChar',
            dataType: DataType.VarChar,
            max_length: '256',
            type_params: [{ key: 'max_length', value: '256' }],
          },
        ],
      },
    });
    client.getLoadState.mockResolvedValue({ state: 'LoadStateLoaded' });

    await expect(ensureCollection(service)).resolves.toBeUndefined();
    expect(client.dropCollection).not.toHaveBeenCalled();
  });

  it('keeps explicit purge able to recreate its collection', async () => {
    const { service, client } = createService(false);
    Object.assign(service, { ready: true });

    await service.purgeCollection('shared_collection', fields);

    expect(client.createCollection).toHaveBeenCalledTimes(1);
    expect(client.createIndex).toHaveBeenCalledTimes(1);
    expect(client.loadCollection).toHaveBeenCalledTimes(1);
  });
});
