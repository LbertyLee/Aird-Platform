import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

// Make the fallback flag available while AppModule is being evaluated.
try {
  const envPath = resolve(process.cwd(), 'apps/api/.env');
  const localEnvPath = resolve(process.cwd(), '.env');
  const envText = readFileSync(
    (() => {
      try {
        readFileSync(envPath);
        return envPath;
      } catch {
        return localEnvPath;
      }
    })(),
    'utf8',
  );
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2];
  }
} catch {
  // ConfigModule still provides normal environment loading.
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    credentials: true,
    origin: config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim()),
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI智库数据智能分析平台 API')
    .setDescription('管理端与业务接口文档（中文）')
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '管理端 JWT 访问令牌',
      },
      'bearer',
    )
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(config.getOrThrow<number>('API_PORT'));
}
void bootstrap();
