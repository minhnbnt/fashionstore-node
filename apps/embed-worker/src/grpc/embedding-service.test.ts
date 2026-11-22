import * as grpc from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SearchEmbedder } from "../service/search-embedding";
import { ImageTooLargeError, InvalidImageError, MODEL_NAME } from "../types";
import { createEmbeddingService } from "./embedding-service";
import type { EmbeddingServiceServer } from "./gen/fashion_clip/v1/embedding_grpc";

function fakeEmbedder(implementation: () => Promise<number[]>): SearchEmbedder {
  return { embed: vi.fn(implementation) } as unknown as SearchEmbedder;
}

function invoke(service: EmbeddingServiceServer, image: Buffer) {
  return new Promise<{ error: grpc.ServiceError | null; value: unknown }>((resolve) => {
    const handler = service.embedImage as unknown as (...args: unknown[]) => void;
    handler(
      { request: { image } },
      (error: grpc.ServiceError | null, value: unknown) => resolve({ error, value }),
      undefined,
    );
  });
}

describe("createEmbeddingService", () => {
  it("success: trả vector và model name", async () => {
    const vector = Array.from({ length: 512 }, () => 0.5);
    const service = createEmbeddingService(
      fakeEmbedder(async () => vector),
      4,
    );

    const { error, value } = await invoke(service, Buffer.from([1, 2, 3]));

    expect(error).toBeNull();
    expect(value).toEqual({ vector, model: MODEL_NAME });
  });

  it("ảnh không hợp lệ → INVALID_ARGUMENT", async () => {
    const service = createEmbeddingService(
      fakeEmbedder(async () => {
        throw new InvalidImageError("bad image");
      }),
      4,
    );

    const { error } = await invoke(service, Buffer.from([1]));

    expect(error?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("ảnh quá lớn → RESOURCE_EXHAUSTED", async () => {
    const service = createEmbeddingService(
      fakeEmbedder(async () => {
        throw new ImageTooLargeError("too large");
      }),
      4,
    );

    const { error } = await invoke(service, Buffer.from([1]));

    expect(error?.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
  });

  it("lỗi model → INTERNAL", async () => {
    const service = createEmbeddingService(
      fakeEmbedder(async () => {
        throw new Error("model boom");
      }),
      4,
    );

    const { error } = await invoke(service, Buffer.from([1]));

    expect(error?.code).toBe(grpc.status.INTERNAL);
  });

  it("vượt max concurrency → RESOURCE_EXHAUSTED", async () => {
    const state: { release?: () => void } = {};
    const pending = new Promise<number[]>((resolve) => {
      state.release = () => resolve(Array.from({ length: 512 }, () => 0));
    });
    const service = createEmbeddingService(
      fakeEmbedder(() => pending),
      1,
    );

    const first = invoke(service, Buffer.from([1]));
    const second = invoke(service, Buffer.from([1]));

    expect((await second).error?.code).toBe(grpc.status.RESOURCE_EXHAUSTED);
    state.release?.();
    expect((await first).error).toBeNull();
  });
});
