import { z } from "zod";

const booleanEnv = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const schema = z.object({
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/fashionstore"),
  S3_ENDPOINT_URL: z.string().default("http://localhost:9000"),
  S3_BUCKET: z.string().default("fashionstore"),
  S3_ACCESS_KEY: z.string().default("fashionstore"),
  S3_SECRET_KEY: z.string().default("passwordpassword"),
  S3_REGION: z.string().default("us-east-1"),
  MODEL_ID: z.string().default("ff13/fashion-clip"),
  MODEL_REVISION: z.string().default("0f99955d944c39bfd9d035a02ac273c7a44a406b"),
  HF_HOME: z.string().optional(),
  LOCAL_FILES_ONLY: booleanEnv,
  QUEUE_NAME: z.string().default("embed_jobs"),
  EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(16),
  MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  VISIBILITY_TIMEOUT_S: z.coerce.number().int().positive().default(60),
  POLL_MAX_SECONDS: z.coerce.number().int().nonnegative().default(5),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(100),
  GRPC_BIND_HOST: z.string().default("127.0.0.1"),
  GRPC_PORT: z.coerce.number().int().min(0).default(9091),
  GRPC_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
  GRPC_MAX_IMAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 1024 * 1024),
});

export interface Settings {
  databaseUrl: string;
  s3EndpointUrl: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Region: string;
  modelId: string;
  modelRevision: string;
  modelCacheDir: string | undefined;
  localFilesOnly: boolean;
  queueName: string;
  embedBatchSize: number;
  maxAttempts: number;
  visibilityTimeoutS: number;
  pollMaxSeconds: number;
  pollIntervalMs: number;
  grpcBindHost: string;
  grpcPort: number;
  grpcMaxConcurrency: number;
  grpcMaxImageBytes: number;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const values = schema.parse(env);
  return {
    databaseUrl: values.DATABASE_URL,
    s3EndpointUrl: values.S3_ENDPOINT_URL,
    s3Bucket: values.S3_BUCKET,
    s3AccessKey: values.S3_ACCESS_KEY,
    s3SecretKey: values.S3_SECRET_KEY,
    s3Region: values.S3_REGION,
    modelId: values.MODEL_ID,
    modelRevision: values.MODEL_REVISION,
    modelCacheDir: values.HF_HOME,
    localFilesOnly: values.LOCAL_FILES_ONLY,
    queueName: values.QUEUE_NAME,
    embedBatchSize: values.EMBED_BATCH_SIZE,
    maxAttempts: values.MAX_ATTEMPTS,
    visibilityTimeoutS: values.VISIBILITY_TIMEOUT_S,
    pollMaxSeconds: values.POLL_MAX_SECONDS,
    pollIntervalMs: values.POLL_INTERVAL_MS,
    grpcBindHost: values.GRPC_BIND_HOST,
    grpcPort: values.GRPC_PORT,
    grpcMaxConcurrency: values.GRPC_MAX_CONCURRENCY,
    grpcMaxImageBytes: values.GRPC_MAX_IMAGE_BYTES,
  };
}
