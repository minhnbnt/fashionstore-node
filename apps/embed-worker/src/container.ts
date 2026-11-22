import type { Settings } from "./config";
import { Database, PostgresProductImageRepository } from "./infrastructure/db";
import { FashionClipModel } from "./infrastructure/model";
import { PgmqJobQueue } from "./infrastructure/queue";
import { S3ImageStore } from "./infrastructure/s3";
import { EmbeddingJobProcessor } from "./service/embedding-jobs";
import { SearchEmbedder } from "./service/search-embedding";

export interface Container {
  db: Database;
  model: FashionClipModel;
  processor: EmbeddingJobProcessor;
  embedder: SearchEmbedder;
  close(): Promise<void>;
}

export async function createContainer(settings: Settings): Promise<Container> {
  const db = new Database(settings.databaseUrl);
  const images = new S3ImageStore(settings);
  const model = new FashionClipModel(settings);
  // Nạp weights sớm: lỗi cấu hình phải nổ trước khi mở server/poll queue.
  await model.load();

  const embedder = new SearchEmbedder(model, settings.grpcMaxImageBytes);
  const repository = new PostgresProductImageRepository(db);
  const queue = new PgmqJobQueue(
    db.connection,
    settings.queueName,
    settings.pollMaxSeconds,
    settings.pollIntervalMs,
  );
  const processor = new EmbeddingJobProcessor(queue, images, model, repository, {
    maxAttempts: settings.maxAttempts,
    visibilityTimeoutS: settings.visibilityTimeoutS,
  });

  return {
    db,
    model,
    processor,
    embedder,
    close: async () => {
      await db.close();
    },
  };
}
