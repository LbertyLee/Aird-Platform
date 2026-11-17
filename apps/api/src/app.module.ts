import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';
import { APP_GUARD } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnvironment } from './config/env.validation';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { AiModule } from './infrastructure/ai/ai.module';
import { MilvusModule } from './infrastructure/milvus/milvus.module';
import { MinioModule } from './infrastructure/minio/minio.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DatasetModule } from './modules/dataset/dataset.module';
import { DictionaryModule } from './modules/dictionary/dictionary.module';
import { IndicatorModule } from './modules/indicator/indicator.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MembershipModule } from './modules/membership/membership.module';
import { PaymentModule } from './modules/payment/payment.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { UserModule } from './modules/user/user.module';
import { VectorSyncModule } from './modules/vector-sync/vector-sync.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { BackupModule } from './modules/backup/backup.module';
import { OperLogModule } from './modules/oper-log/oper-log.module';
import { OperationModule } from './modules/operation/operation.module';
import { ResearchModule } from './research/research.module';
import { DataAnalysisModule } from './modules/data-analysis/data-analysis.module';
import { ExternalSearchModule } from './modules/external-search/external-search.module';
import { SearchOrchestratorModule } from './modules/search/search-orchestrator.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { WorkJobsModule } from './modules/work-jobs/work-jobs.module';
import { AgentModule } from './modules/agent/agent.module';
import { isQueuesEnabled } from './common/utils/queues-enabled';

const queuesEnabled = isQueuesEnabled();
/**
 * 应用根模块：装配基础设施与管理端业务模块。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: [
        'apps/api/.env',
        '.env',
        resolve(__dirname, '../../../.env'),
      ],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          transport:
            config.get('NODE_ENV') === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
      }),
    }),
    ...(queuesEnabled
      ? [
          BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              connection: {
                host: config.getOrThrow<string>('REDIS_HOST'),
                port: config.getOrThrow<number>('REDIS_PORT'),
                password: config.get<string>('REDIS_PASSWORD') || undefined,
                db: config.getOrThrow<number>('REDIS_DB'),
                maxRetriesPerRequest: null,
              },
            }),
          }),
        ]
      : []),
    TerminusModule,
    PrismaModule,
    RedisModule,
    MinioModule,
    MilvusModule,
    AiModule,
    ...(queuesEnabled ? [VectorSyncModule] : []),
    ...(queuesEnabled ? [IngestionModule] : []),
    AuthModule,
    UserModule,
    RbacModule,
    MembershipModule,
    PaymentModule,
    DashboardModule,
    IndicatorModule,
    DictionaryModule,
    DatasetModule,
    KnowledgeModule,
    OperLogModule,
    OperationModule,
    ...(queuesEnabled ? [BackupModule] : []),
    ResearchModule,
    DataAnalysisModule,
    ExternalSearchModule,
    SearchOrchestratorModule,
    AnalysisModule,
    WorkJobsModule,
    AgentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
