import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export type MinioListedObject = {
  key: string;
  size: number;
  lastModified?: Date;
  bucket: string;
};

/**
 * MinIO / S3 对象存储封装。
 */
@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client!: S3Client;
  private bucket!: string;
  private readBuckets: string[] = [];

  /**
   * @param config 环境配置
   */
  constructor(private readonly config: ConfigService) {}

  /**
   * 初始化 S3 客户端。
   */
  onModuleInit(): void {
    const endpoint = this.config.getOrThrow<string>('MINIO_ENDPOINT');
    this.bucket = this.config.getOrThrow<string>('MINIO_BUCKET');
    this.readBuckets = [
      this.bucket,
      ...this.config
        .getOrThrow<string>('MINIO_FALLBACK_BUCKETS')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ].filter((value, index, values) => values.indexOf(value) === index);
    this.client = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
      },
    });
    this.logger.log(`MinIO client ready → ${endpoint}/${this.bucket}`);
  }

  /** 主写入桶名 */
  getBucket(): string {
    return this.bucket;
  }

  /** 可读桶列表（主桶 + fallback） */
  getReadBuckets(): string[] {
    return [...this.readBuckets];
  }

  /**
   * 上传对象。
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType?: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /**
   * 从本地文件流式上传（适合大备份包）。
   */
  async putObjectFromFile(
    key: string,
    filePath: string,
    contentType?: string,
  ): Promise<void> {
    const fileStat = await stat(filePath);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
        ContentLength: fileStat.size,
      }),
    );
  }

  /**
   * 同账号桶内复制对象到主桶。
   */
  async copyObject(
    sourceBucket: string,
    sourceKey: string,
    destKey: string,
  ): Promise<void> {
    const encodedKey = sourceKey
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        CopySource: `${sourceBucket}/${encodedKey}`,
      }),
    );
  }

  /**
   * 列出指定前缀对象（跨可读桶去重，主桶优先）。
   */
  async listObjects(
    prefix: string,
    options?: { buckets?: string[]; excludePrefix?: string },
  ): Promise<MinioListedObject[]> {
    const buckets = options?.buckets ?? this.readBuckets;
    const excludePrefix = options?.excludePrefix;
    const seen = new Set<string>();
    const result: MinioListedObject[] = [];

    for (const bucket of buckets) {
      let continuationToken: string | undefined;
      do {
        const res = await this.client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        );
        for (const item of res.Contents ?? []) {
          const key = item.Key;
          if (!key || seen.has(key)) continue;
          if (excludePrefix && key.startsWith(excludePrefix)) continue;
          seen.add(key);
          result.push({
            key,
            size: item.Size ?? 0,
            lastModified: item.LastModified,
            bucket,
          });
        }
        continuationToken = res.IsTruncated
          ? res.NextContinuationToken
          : undefined;
      } while (continuationToken);
    }

    return result;
  }

  /**
   * 删除指定前缀下主桶对象。
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    const objects = await this.listObjects(prefix, { buckets: [this.bucket] });
    let deleted = 0;
    for (const obj of objects) {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.key }),
      );
      deleted += 1;
    }
    return deleted;
  }

  /**
   * 判断对象是否存在（任一可读桶）。
   */
  async objectExists(key: string): Promise<boolean> {
    for (const bucket of this.readBuckets) {
      try {
        await this.client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
        return true;
      } catch {
        // try next bucket
      }
    }
    return false;
  }

  /**
   * 下载对象到本地文件（流式，适合大 dump）。
   */
  async downloadObjectToFile(key: string, filePath: string): Promise<void> {
    let lastError: unknown;
    for (const bucket of this.readBuckets) {
      try {
        const res = await this.client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const body = res.Body;
        if (!body) {
          throw new Error(`Empty body for ${bucket}/${key}`);
        }
        await pipeline(body as Readable, createWriteStream(filePath));
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  /**
   * 下载对象为 Buffer。
   */
  async getObject(key: string): Promise<Buffer> {
    let lastError: unknown;
    for (const bucket of this.readBuckets) {
      try {
        const res = await this.client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        const stream = res.Body as Readable;
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  /** 生成可被外部预览服务访问的短时签名地址。 */
  async createPresignedGetUrl(key: string, expiresIn = 300): Promise<string> {
    const endpoint = new URL(
      this.config.get<string>('MINIO_PUBLIC_ENDPOINT') ||
        this.config.getOrThrow<string>('MINIO_ENDPOINT'),
    );
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replaceAll('-', '');
    const amzDate = `${dateStamp}T${now.toISOString().slice(11, 19).replaceAll(':', '')}Z`;
    const region = 'us-east-1';
    const service = 's3';
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const accessKey = this.config.getOrThrow<string>('MINIO_ACCESS_KEY');
    const secretKey = this.config.getOrThrow<string>('MINIO_SECRET_KEY');
    const bucket = this.bucket;
    const canonicalUri = `/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKey}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(Math.min(Math.max(expiresIn, 1), 604800)),
      'X-Amz-SignedHeaders': 'host',
      'response-content-disposition': 'inline',
    });
    const canonicalQuery = [...query.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
      .join('&');
    const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\nhost:${endpoint.host}\n\nhost\nUNSIGNED-PAYLOAD`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');
    return `${endpoint.origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  /**
   * 删除对象（忽略不存在）。
   */
  async deleteObject(key: string): Promise<void> {
    await Promise.all(
      this.readBuckets.map((bucket) =>
        this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
    );
  }
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
