import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  MINIO_ENDPOINT: z.string().url(),
  /** Browser-reachable object storage origin used in generated signed URLs. */
  MINIO_PUBLIC_ENDPOINT: optionalUrl,
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_BUCKET: z.string().min(1),
  MINIO_FALLBACK_BUCKETS: z.string().optional().default(''),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:5174'),
  STORAGE_DRIVER: z.enum(['postgres', 'memory']).default('postgres'),
  STORAGE_FALLBACK_TO_MEMORY: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('false'),
  EXA_API_KEY: z.string().optional(),
  /** Timeout shared by the selected international statistical APIs. */
  INTERNATIONAL_API_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(2000)
    .max(60000)
    .default(12000),
  UN_COMTRADE_API_KEY: z.string().optional().default(''),
  /** JSON map from metric keywords to OECD SDMX CSV dataflow URL templates. */
  OECD_SDMX_QUERY_TEMPLATES_JSON: z.string().optional().default(''),
  DEEPSEEK_SEARCH_API_KEY: z.string().optional().default(''),
  DEEPSEEK_SEARCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(30000),
  EXA_SEARCH_COUNT: z.coerce.number().int().min(1).max(50).default(40),
  EXA_SOURCE_DOMAIN_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50),
  EXA_SOURCE_SEARCH_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(4),
  RESEARCH_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(3600),
  RESEARCH_CACHE_VERSION: z.string().min(1).default('v1'),
  /** Shared credential for chat, OCR, embeddings, and reranking model APIs. */
  AI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: optionalUrl,
  OPENAI_MODEL: z.string().default('qwen3.7-plus-2026-05-26'),
  /** 证据评估、研究结论、跨来源分析和报告生成使用的复杂推理模型。 */
  OPENAI_REASONING_MODEL: z.string().trim().min(1).default('qwen3.8-max'),
  /** 模型计费单价：{ model: { inputYuanPerMillionTokens, outputYuanPerMillionTokens } } */
  LLM_MODEL_PRICING_JSON: z.string().optional().default(''),
  /** 无文本层 PDF（打印件/扫描件）视觉识别模型 */
  PDF_OCR_MODEL: z.string().default('qwen-vl-ocr'),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(7200),
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(604800),
  MILVUS_ADDRESS: z.string().default('127.0.0.1:19530'),
  MILVUS_SCHEMA_CHANGES_ON_START: z.enum(['true', 'false']).optional(),
  EMBEDDING_PROVIDER: z.string().optional().default(''), // openai | dashscope-multimodal；空则按模型名推断
  EMBEDDING_BASE_URL: z.string().url().default('https://api.siliconflow.cn/v1'),
  EMBEDDING_MODEL: z.string().default('BAAI/bge-m3'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(1024),
  /** 单次 embeddings.create input 条数（DashScope text-embedding-v4 上限 10） */
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(64).default(10),
  /** 并行 embedding HTTP 请求数 */
  EMBEDDING_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** 是否启用定时系统备份 */
  BACKUP_ENABLED: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('true'),
  /** 定时备份 cron（默认每天 02:00） */
  BACKUP_CRON: z.string().min(1).default('0 2 * * *'),
  /** 备份保留天数 */
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(14),
  /** MinIO 备份集前缀 */
  BACKUP_PREFIX: z.string().min(1).default('system-backups/'),
  /**
   * 可选：本机额外落盘目录（容器需挂载卷）。
   * 写入 database.dump / env.snapshot.json / manifest.json，便于单机异盘保留。
   */
  BACKUP_LOCAL_DIR: z.string().optional().default(''),
  /** 腾讯云 SMS：访问密钥（CAM），非控制台 App Key */
  TENCENT_SMS_SECRET_ID: z.string().optional().default(''),
  TENCENT_SMS_SECRET_KEY: z.string().optional().default(''),
  TENCENT_SMS_SDK_APP_ID: z.string().optional().default(''),
  TENCENT_SMS_SIGN_NAME: z.string().optional().default(''),
  TENCENT_SMS_TEMPLATE_ID: z.string().optional().default(''),
  TENCENT_SMS_REGION: z.string().optional().default('ap-guangzhou'),
  TENCENT_SMS_CODE_TTL_SEC: z.coerce
    .number()
    .int()
    .min(60)
    .max(1800)
    .default(300),
  TENCENT_SMS_SEND_INTERVAL_SEC: z.coerce
    .number()
    .int()
    .min(30)
    .max(300)
    .default(60),
  /** 未配置 Secret 时的固定验证码；开发环境默认 1111 */
  TENCENT_SMS_PREVIEW_CODE: z.string().optional().default(''),
  /** 支付宝电脑网站支付 */
  ALIPAY_ENABLED: z.enum(['true', 'false']).optional().default('false'),
  ALIPAY_SELLER_ID: z.string().optional().default(''),
  ALIPAY_APP_ID: z.string().optional().default(''),
  ALIPAY_GATEWAY: z
    .string()
    .optional()
    .default('https://openapi.alipaydev.com/gateway.do'),
  ALIPAY_PRIVATE_KEY: z.string().optional().default(''),
  ALIPAY_PRIVATE_KEY_PATH: z.string().optional().default(''),
  ALIPAY_PUBLIC_KEY: z.string().optional().default(''),
  ALIPAY_PUBLIC_KEY_PATH: z.string().optional().default(''),
  ALIPAY_NOTIFY_URL: z.string().optional().default(''),
  ALIPAY_RETURN_URL: z.string().optional().default(''),
  ALIPAY_WEB_RETURN_URL: z.string().optional().default(''),
  ALIPAY_KEY_TYPE: z.enum(['PKCS1', 'PKCS8']).optional().default('PKCS8'),
  ALIPAY_WS_HOST: z.string().optional().default(''),
  /** 微信支付 API v3 直连商户 Native 支付 */
  WECHAT_PAY_ENABLED: z.enum(['true', 'false']).optional().default('false'),
  WECHAT_PAY_APP_ID: z.string().optional().default(''),
  WECHAT_PAY_MCH_ID: z.string().optional().default(''),
  WECHAT_PAY_CERT_SERIAL: z.string().optional().default(''),
  WECHAT_PAY_PUBLIC_KEY_ID: z.string().optional().default(''),
  WECHAT_PAY_PRIVATE_KEY_PATH: z.string().optional().default(''),
  WECHAT_PAY_CERT_PATH: z.string().optional().default(''),
  WECHAT_PAY_PUBLIC_KEY_PATH: z.string().optional().default(''),
  WECHAT_PAY_API_V3_KEY_PATH: z.string().optional().default(''),
  WECHAT_PAY_NOTIFY_URL: z.string().optional().default(''),
  API_PUBLIC_BASE_URL: z.string().optional().default(''),
  WEB_PUBLIC_BASE_URL: z.string().optional().default(''),
  PAYMENT_MOCK_ENABLED: z.enum(['true', 'false']).optional().default('false'),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  return environmentSchema.parse(config);
}
