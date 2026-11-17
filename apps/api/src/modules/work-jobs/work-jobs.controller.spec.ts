import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WorkJobsController } from './work-jobs.controller';
import { WorkJobsService } from './work-jobs.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AnalysisSessionService } from '../analysis/analysis-session.service';
import { ResearchService } from '../../research/research.service';

jest.mock('../analysis/analysis-session.service', () => ({
  AnalysisSessionService: class {},
}));
jest.mock('../../research/research.service', () => ({
  ResearchService: class {},
}));

describe('background task HTTP lifecycle', () => {
  let app: INestApplication;
  let finish: (result: unknown) => void;
  const create = jest.fn();

  beforeEach(async () => {
    const storage = new Map<string, string>();
    create.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const module = await Test.createTestingModule({
      controllers: [WorkJobsController],
      providers: [
        WorkJobsService,
        { provide: AnalysisSessionService, useValue: { create } },
        { provide: ResearchService, useValue: { generateReport: jest.fn() } },
        {
          provide: RedisService,
          useValue: {
            get: async (key: string) => storage.get(key) ?? null,
            set: async (key: string, value: string) => {
              storage.set(key, value);
            },
            setIfAbsent: async (key: string, value: string) => {
              if (storage.has(key)) return false;
              storage.set(key, value);
              return true;
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        req: { user?: { userId: string }; headers: Record<string, string> },
        _res: unknown,
        next: () => void,
      ) => {
        req.user = { userId: req.headers['x-test-user'] || 'owner' };
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns a job while the model is thinking and serves its eventual result', async () => {
    const input = { runId: 'run', query: '中文问题', sourceIds: ['source'] };
    const submitted = await request(app.getHttpServer())
      .post('/work-jobs/analysis')
      .set('X-Request-Id', 'same-request')
      .send(input)
      .expect(201);
    const jobId = submitted.body.jobId;
    const retried = await request(app.getHttpServer())
      .post('/work-jobs/analysis')
      .set('X-Request-Id', 'same-request')
      .send(input)
      .expect(201);
    expect(retried.body.jobId).toBe(jobId);
    expect(create).toHaveBeenCalledTimes(1);
    const running = await request(app.getHttpServer())
      .get(`/work-jobs/${jobId}`)
      .expect(200);
    expect(running.body.status).toBe('running');
    await request(app.getHttpServer())
      .get(`/work-jobs/${jobId}`)
      .set('X-Test-User', 'other')
      .expect(404);
    finish({ id: 'saved-analysis', observations: [1, 2] });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completed = await request(app.getHttpServer())
      .get(`/work-jobs/${jobId}`)
      .expect(200);
    expect(completed.body).toMatchObject({
      status: 'completed',
      result: { id: 'saved-analysis' },
    });
    expect(completed.body).not.toHaveProperty('userId');
  });

  it('retains input validation on the new endpoints', async () => {
    await request(app.getHttpServer())
      .post('/work-jobs/analysis')
      .send({ runId: 'run', query: 'x', sourceIds: ['source'] })
      .expect(400);
    await request(app.getHttpServer())
      .post('/work-jobs/report')
      .send({ query: '报告', sourceIds: 'invalid' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/work-jobs/analysis')
      .set('X-Request-Id', 'invalid/id')
      .send({ runId: 'run', query: '中文问题', sourceIds: ['source'] })
      .expect(400);
    expect(create).not.toHaveBeenCalled();
  });
});
