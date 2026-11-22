import { describe, expect, it } from "vite-plus/test";

import { loadSettings } from "./config";

describe("loadSettings", () => {
  it("giữ default khớp worker Python", () => {
    const settings = loadSettings({});

    expect(settings.databaseUrl).toBe("postgresql://postgres:postgres@localhost:5432/fashionstore");
    expect(settings.s3Bucket).toBe("fashionstore");
    expect(settings.modelId).toBe("ff13/fashion-clip");
    expect(settings.queueName).toBe("embed_jobs");
    expect(settings.embedBatchSize).toBe(16);
    expect(settings.maxAttempts).toBe(3);
    expect(settings.visibilityTimeoutS).toBe(60);
    expect(settings.pollMaxSeconds).toBe(5);
    expect(settings.pollIntervalMs).toBe(100);
    expect(settings.grpcBindHost).toBe("127.0.0.1");
    expect(settings.grpcPort).toBe(9091);
    expect(settings.grpcMaxConcurrency).toBe(4);
    expect(settings.grpcMaxImageBytes).toBe(8388608);
    expect(settings.localFilesOnly).toBe(false);
  });

  it("đọc override từ env với kiểu đúng", () => {
    const settings = loadSettings({
      DATABASE_URL: "postgres://other/db",
      LOCAL_FILES_ONLY: "true",
      EMBED_BATCH_SIZE: "4",
      HF_HOME: "/models",
    });

    expect(settings.databaseUrl).toBe("postgres://other/db");
    expect(settings.localFilesOnly).toBe(true);
    expect(settings.embedBatchSize).toBe(4);
    expect(settings.modelCacheDir).toBe("/models");
  });
});
