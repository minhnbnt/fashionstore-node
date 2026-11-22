import { describe, expect, it, vi } from "vite-plus/test";

import { createWorker } from "./main";
import type { EmbeddingJobProcessor } from "./service/embedding-jobs";

function fakeProcessor(failures = 0) {
  let calls = 0;
  const processBatch = vi.fn().mockImplementation(async () => {
    calls += 1;
    if (calls <= failures) {
      throw new Error("transient");
    }
    return calls;
  });
  return {
    processBatch,
    processor: { processBatch } as unknown as EmbeddingJobProcessor,
  };
}

describe("createWorker", () => {
  it("runOnce gọi processBatch với batchSize", async () => {
    const fake = fakeProcessor();
    const worker = createWorker(fake.processor, 7);

    expect(await worker.runOnce()).toBe(1);
    expect(fake.processBatch).toHaveBeenCalledWith(7);
  });

  it("stop ngay từ đầu thì không gọi processor", async () => {
    const fake = fakeProcessor();
    const worker = createWorker(fake.processor, 16, { sleep: vi.fn() });

    await worker.runForever(() => true);

    expect(fake.processBatch).not.toHaveBeenCalled();
  });

  it("stop sau 2 vòng thì gọi đúng 2 lần", async () => {
    const fake = fakeProcessor();
    const worker = createWorker(fake.processor, 16, { sleep: vi.fn() });
    let loops = 0;

    await worker.runForever(() => {
      loops += 1;
      return loops > 2;
    });

    expect(fake.processBatch).toHaveBeenCalledTimes(2);
  });

  it("processor ném lỗi thì vẫn tiếp tục vòng sau", async () => {
    const fake = fakeProcessor(1);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const worker = createWorker(fake.processor, 16, { errorBackoffMs: 5, sleep });
    let loops = 0;

    await worker.runForever(() => {
      loops += 1;
      return loops > 2;
    });

    expect(fake.processBatch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
  });
});
