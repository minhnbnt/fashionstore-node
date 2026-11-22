import sharp from "sharp";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ImageStoreError,
  MODEL_NAME,
  type EmbeddingModel,
  type ImageStore,
  type JobQueue,
  type ProductImageRepository,
  type QueuedJob,
} from "../types";
import { EmbeddingJobProcessor } from "./embedding-jobs";

const imageBuffer = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
})
  .png()
  .toBuffer();

function job(msgId: string, readCt = 1): QueuedJob {
  return {
    msgId,
    readCt,
    productImageId: `img-${msgId}`,
    productId: "product-1",
    uploadId: `upload-${msgId}`,
    s3Key: `images/${msgId}.png`,
  };
}

function vector(value: number): Float32Array {
  // Model thật trả vector đã L2-normalize; fake cũng phải vậy.
  return new Float32Array(512).fill(value / Math.sqrt(512));
}

interface Fakes {
  queue: JobQueue;
  images: ImageStore;
  model: EmbeddingModel;
  repository: ProductImageRepository;
  calls: {
    archive: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    setError: ReturnType<typeof vi.fn>;
    embed: ReturnType<typeof vi.fn>;
    getImage: ReturnType<typeof vi.fn>;
  };
}

function fakes(jobs: QueuedJob[], options: { imageError?: boolean; stale?: boolean } = {}): Fakes {
  const calls = {
    archive: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(true),
    setError: vi.fn().mockResolvedValue(undefined),
    embed: vi.fn().mockResolvedValue(jobs.map((_, index) => vector(index + 1))),
    getImage: vi.fn().mockImplementation(async (id: string) => ({
      productImageId: id,
      productId: "product-1",
      uploadId: options.stale ? "different-upload" : `upload-${id.slice(4)}`,
      s3Key: "images/a.png",
    })),
  };
  return {
    calls,
    queue: {
      readBatch: vi.fn().mockResolvedValue(jobs),
      archive: calls.archive,
    },
    images: {
      get: options.imageError
        ? vi.fn().mockRejectedValue(new ImageStoreError("boom"))
        : vi.fn().mockResolvedValue(imageBuffer),
    },
    model: { load: vi.fn().mockResolvedValue(undefined), embedImages: calls.embed },
    repository: {
      getImage: calls.getImage,
      upsertEmbedding: calls.upsert,
      setEmbedError: calls.setError,
    },
  };
}

function processor(fakes: Fakes): EmbeddingJobProcessor {
  return new EmbeddingJobProcessor(fakes.queue, fakes.images, fakes.model, fakes.repository);
}

describe("EmbeddingJobProcessor", () => {
  it("batch success: một lần gọi model cho nhiều job, upsert và archive", async () => {
    const fake = fakes([job("1"), job("2")]);
    const processed = await processor(fake).processBatch(16);

    expect(processed).toBe(2);
    expect(fake.calls.embed).toHaveBeenCalledTimes(1);
    expect(fake.calls.embed.mock.calls[0][0]).toHaveLength(2);
    expect(fake.calls.upsert).toHaveBeenCalledTimes(2);
    expect(fake.calls.upsert.mock.calls[0][2]).toBe(MODEL_NAME);
    expect(fake.calls.archive).toHaveBeenCalledTimes(2);
    const stored = fake.calls.upsert.mock.calls[0][1] as Float32Array;
    expect(Math.abs(Math.sqrt(stored.reduce((sum, x) => sum + x * x, 0)) - 1)).toBeLessThan(1e-6);
  });

  it("S3 lỗi ở read_ct 1: để message, không ghi error", async () => {
    const fake = fakes([job("1", 1)], { imageError: true });

    await processor(fake).processBatch(16);

    expect(fake.calls.embed).not.toHaveBeenCalled();
    expect(fake.calls.setError).not.toHaveBeenCalled();
    expect(fake.calls.archive).not.toHaveBeenCalled();
  });

  it("S3 lỗi ở read_ct 3: ghi embed_error rồi archive", async () => {
    const fake = fakes([job("1", 3)], { imageError: true });

    await processor(fake).processBatch(16);

    expect(fake.calls.setError).toHaveBeenCalledTimes(1);
    expect(fake.calls.archive).toHaveBeenCalledTimes(1);
    expect(fake.calls.upsert).not.toHaveBeenCalled();
  });

  it("stale upload_id: archive, không gọi model, không upsert", async () => {
    const fake = fakes([job("1")], { stale: true });

    await processor(fake).processBatch(16);

    expect(fake.calls.archive).toHaveBeenCalledTimes(1);
    expect(fake.calls.embed).not.toHaveBeenCalled();
    expect(fake.calls.upsert).not.toHaveBeenCalled();
  });

  it("ảnh đã xoá: archive, không gọi model", async () => {
    const fake = fakes([job("1")]);
    fake.calls.getImage.mockResolvedValue(null);

    await processor(fake).processBatch(16);

    expect(fake.calls.archive).toHaveBeenCalledTimes(1);
    expect(fake.calls.embed).not.toHaveBeenCalled();
  });

  it("upsert trả false: vẫn archive", async () => {
    const fake = fakes([job("1")]);
    fake.calls.upsert.mockResolvedValue(false);

    await processor(fake).processBatch(16);

    expect(fake.calls.archive).toHaveBeenCalledTimes(1);
  });

  it("model lỗi: job read_ct 3 bị ghi error và archive", async () => {
    const fake = fakes([job("1", 3)]);
    fake.calls.embed.mockRejectedValue(new Error("model boom"));

    await processor(fake).processBatch(16);

    expect(fake.calls.setError).toHaveBeenCalledTimes(1);
    expect(fake.calls.archive).toHaveBeenCalledTimes(1);
    expect(fake.calls.upsert).not.toHaveBeenCalled();
  });

  it("batch rỗng: trả 0, không gọi model", async () => {
    const fake = fakes([]);

    expect(await processor(fake).processBatch(16)).toBe(0);
    expect(fake.calls.embed).not.toHaveBeenCalled();
  });
});
