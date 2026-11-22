import { decodeImage } from "../infrastructure/image";
import {
  InvalidImageError,
  MODEL_NAME,
  type DecodedImage,
  type EmbeddingModel,
  ImageStoreError,
  type ImageStore,
  type JobQueue,
  type ProductImageRepository,
  type QueuedJob,
} from "../types";

interface ProcessorOptions {
  maxAttempts?: number;
  visibilityTimeoutS?: number;
}

export class EmbeddingJobProcessor {
  private readonly jobs: JobQueue;
  private readonly images: ImageStore;
  private readonly model: EmbeddingModel;
  private readonly repository: ProductImageRepository;
  private readonly maxAttempts: number;
  private readonly visibilityTimeoutS: number;

  constructor(
    jobs: JobQueue,
    images: ImageStore,
    model: EmbeddingModel,
    repository: ProductImageRepository,
    options: ProcessorOptions = {},
  ) {
    this.jobs = jobs;
    this.images = images;
    this.model = model;
    this.repository = repository;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.visibilityTimeoutS = options.visibilityTimeoutS ?? 60;
  }

  async processBatch(batchSize: number): Promise<number> {
    const jobs = await this.jobs.readBatch(batchSize, this.visibilityTimeoutS);
    if (jobs.length === 0) {
      return 0;
    }

    const ready: Array<[QueuedJob, DecodedImage]> = [];
    for (const job of jobs) {
      const current = await this.repository.getImage(job.productImageId);
      if (current === null) {
        console.info(`job ${job.msgId}: image row is gone, archiving`);
        await this.jobs.archive(job);
        continue;
      }
      if (current.uploadId !== job.uploadId) {
        console.info(`job ${job.msgId}: image was replaced, archiving stale job`);
        await this.jobs.archive(job);
        continue;
      }

      const image = await this.openImage(job);
      if (image !== null) {
        ready.push([job, image]);
        continue;
      }
      if (job.readCt < this.maxAttempts) {
        continue;
      }
      const error = `embedding failed after ${job.readCt} attempts: image missing or undecodable`;
      await this.repository.setEmbedError(job, error);
      await this.jobs.archive(job);
      console.warn(`job ${job.msgId} failed permanently: ${error}`);
    }

    if (ready.length > 0) {
      let vectors: Float32Array[];
      try {
        vectors = await this.model.embedImages(ready.map(([, image]) => image));
      } catch (cause) {
        const reason = String(cause);
        console.error(`model failed for ${ready.length} image(s): ${reason}`);
        await this.failPending(
          ready.map(([job]) => job),
          `model failed: ${reason}`,
        );
        return jobs.length;
      }
      if (vectors.length !== ready.length) {
        throw new Error(`model returned ${vectors.length} vectors for ${ready.length} images`);
      }
      for (let i = 0; i < ready.length; i += 1) {
        const [job] = ready[i];
        if (!(await this.repository.upsertEmbedding(job, vectors[i], MODEL_NAME))) {
          console.info(`job ${job.msgId}: stale at write time, dropped`);
        }
        await this.jobs.archive(job);
      }
      console.info(`embedded ${ready.length} image(s)`);
    }
    return jobs.length;
  }

  private async failPending(jobs: QueuedJob[], reason: string): Promise<void> {
    for (const job of jobs) {
      if (job.readCt < this.maxAttempts) {
        continue;
      }
      const error = `embedding failed after ${job.readCt} attempts: ${reason}`;
      await this.repository.setEmbedError(job, error);
      await this.jobs.archive(job);
      console.warn(`job ${job.msgId} failed permanently: ${error}`);
    }
  }

  private async openImage(job: QueuedJob): Promise<DecodedImage | null> {
    try {
      const data = await this.images.get(job.s3Key);
      return await decodeImage(data);
    } catch (cause: unknown) {
      if (cause instanceof InvalidImageError || cause instanceof ImageStoreError) {
        console.warn(`job ${job.msgId}: cannot open ${job.s3Key}: ${String(cause)}`);
        return null;
      }
      throw cause;
    }
  }
}
