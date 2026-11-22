import * as grpc from "@grpc/grpc-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { loadSettings } from "../config";
import type { SearchEmbedder } from "../service/search-embedding";
import { InvalidImageError, MODEL_NAME } from "../types";
import { createEmbeddingService } from "./embedding-service";
import { EmbeddingServiceClient } from "./gen/fashion_clip/v1/embedding_grpc";
import { HealthClient } from "./gen/grpc/health/v1/health_grpc";
import { HealthCheckResponse_ServingStatus } from "./gen/grpc/health/v1/health_pb";
import { createGrpcServer, type GrpcServer } from "./server";

let server: GrpcServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.stop(0.1);
    server = null;
  }
});

function embeddingClient(port: number): EmbeddingServiceClient {
  return new EmbeddingServiceClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
}

function healthClient(port: number): HealthClient {
  return new HealthClient(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
}

const embedder = {
  embed: vi.fn().mockResolvedValue(Array.from({ length: 512 }, () => 0.25)),
} as unknown as SearchEmbedder;

describe("createGrpcServer", () => {
  it("EmbedImage trả 512 chiều, health trả SERVING", async () => {
    const settings = loadSettings({ GRPC_PORT: "0" });
    server = await createGrpcServer(
      settings,
      createEmbeddingService(embedder, settings.grpcMaxConcurrency),
    );
    const port = await server.start();
    const client = embeddingClient(port);

    const reply = await new Promise<{ vector: number[]; model: string }>((resolve, reject) => {
      client.embedImage({ image: Buffer.from([1, 2, 3]) }, (error, value) => {
        if (error != null || value === undefined) {
          reject(error ?? new Error("empty reply"));
          return;
        }
        resolve({ vector: value.vector, model: value.model });
      });
    });
    expect(reply.vector).toHaveLength(512);
    expect(reply.model).toBe(MODEL_NAME);

    const status = await new Promise<number>((resolve, reject) => {
      healthClient(port).check({}, (error, value) => {
        if (error != null || value === undefined) {
          reject(error ?? new Error("empty reply"));
          return;
        }
        resolve(value.status);
      });
    });
    expect(status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it("ảnh không hợp lệ → INVALID_ARGUMENT", async () => {
    const failing = {
      embed: vi.fn().mockRejectedValue(new InvalidImageError("boom")),
    } as unknown as SearchEmbedder;
    const settings = loadSettings({ GRPC_PORT: "0" });
    server = await createGrpcServer(settings, createEmbeddingService(failing, 4));
    const port = await server.start();

    const error = await new Promise<grpc.ServiceError | null>((resolve) => {
      embeddingClient(port).embedImage({ image: Buffer.alloc(0) }, (rpcError) => resolve(rpcError));
    });
    expect(error?.code).toBe(grpc.status.INVALID_ARGUMENT);
  });

  it("stop() đóng server", async () => {
    const settings = loadSettings({ GRPC_PORT: "0" });
    server = await createGrpcServer(settings, createEmbeddingService(embedder, 4));
    const port = await server.start();
    await server.stop(0.1);
    server = null;

    const error = await new Promise<grpc.ServiceError | null>((resolve) => {
      embeddingClient(port).embedImage({ image: Buffer.from([1]) }, (rpcError) =>
        resolve(rpcError),
      );
    });
    expect(error?.code).toBe(grpc.status.UNAVAILABLE);
  });
});
