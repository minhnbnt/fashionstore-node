import * as grpc from "@grpc/grpc-js";

import type { Settings } from "../config";
import { EmbeddingServiceDefinition } from "./gen/fashion_clip/v1/embedding_grpc";
import { HealthDefinition, type HealthServer } from "./gen/grpc/health/v1/health_grpc";
import { HealthCheckResponse_ServingStatus } from "./gen/grpc/health/v1/health_pb";

export interface GrpcServer {
  start(): Promise<number>;
  stop(graceS: number): Promise<void>;
}

export async function createGrpcServer(
  settings: Settings,
  embeddingService: grpc.UntypedServiceImplementation,
): Promise<GrpcServer> {
  const server = new grpc.Server({
    "grpc.max_receive_message_length": settings.grpcMaxImageBytes,
    "grpc.max_send_message_length": settings.grpcMaxImageBytes,
  });
  server.addService(EmbeddingServiceDefinition, embeddingService);

  const health: HealthServer = {
    check: (_call, callback) => {
      callback(null, { status: HealthCheckResponse_ServingStatus.SERVING });
    },
    watch: (call) => {
      call.end();
    },
  };
  server.addService(HealthDefinition, health);

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      `${settings.grpcBindHost}:${settings.grpcPort}`,
      grpc.ServerCredentials.createInsecure(),
      (error, boundPort) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(boundPort);
      },
    );
  });

  return {
    start: async () => port,
    stop: (graceS: number) =>
      new Promise<void>((resolve) => {
        let finished = false;
        const timer = setTimeout(() => {
          if (!finished) {
            server.forceShutdown();
          }
        }, graceS * 1000);
        server.tryShutdown(() => {
          finished = true;
          clearTimeout(timer);
          resolve();
        });
      }),
  };
}
