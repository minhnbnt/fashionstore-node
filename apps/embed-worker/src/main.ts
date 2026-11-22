import { loadSettings } from "./config";
import { createContainer } from "./container";
import { createEmbeddingService } from "./grpc/embedding-service";
import { createGrpcServer } from "./grpc/server";
import type { EmbeddingJobProcessor } from "./service/embedding-jobs";

export interface Worker {
  runOnce(): Promise<number>;
  runForever(stop: () => boolean): Promise<void>;
}

type Sleep = (ms: number) => Promise<void>;

export function createWorker(
  processor: EmbeddingJobProcessor,
  batchSize: number,
  options: { errorBackoffMs?: number; sleep?: Sleep } = {},
): Worker {
  const backoff = options.errorBackoffMs ?? 1000;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  return {
    runOnce: () => processor.processBatch(batchSize),
    runForever: async (stop) => {
      while (!stop()) {
        try {
          const processed = await processor.processBatch(batchSize);
          if (processed > 0) {
            console.info(`batch processed: ${processed} job(s)`);
          }
        } catch (cause) {
          console.error(`batch failed, backing off: ${String(cause)}`);
          await sleep(backoff);
        }
      }
    },
  };
}

export async function main(): Promise<void> {
  const settings = loadSettings();
  const container = await createContainer(settings);
  const grpcServer = await createGrpcServer(
    settings,
    createEmbeddingService(container.embedder, settings.grpcMaxConcurrency),
  );
  const port = await grpcServer.start();

  let stopping = false;
  const requestStop = () => {
    stopping = true;
  };
  process.on("SIGTERM", requestStop);
  process.on("SIGINT", requestStop);

  console.info(
    "embedding worker starting: queue=%s batch_size=%d",
    settings.queueName,
    settings.embedBatchSize,
  );
  console.info(`gRPC server nghe ${settings.grpcBindHost}:${port}`);

  try {
    await createWorker(container.processor, settings.embedBatchSize).runForever(() => stopping);
  } finally {
    process.off("SIGTERM", requestStop);
    process.off("SIGINT", requestStop);
    await grpcServer.stop(5);
    await container.close();
  }
}

if (import.meta.main) {
  void main();
}
