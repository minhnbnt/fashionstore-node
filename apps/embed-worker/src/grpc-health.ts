import * as grpc from "@grpc/grpc-js";

import { HealthClient } from "./grpc/gen/grpc/health/v1/health_grpc";
import { HealthCheckResponse_ServingStatus } from "./grpc/gen/grpc/health/v1/health_pb";

const host =
  process.env.GRPC_BIND_HOST === "0.0.0.0"
    ? "127.0.0.1"
    : (process.env.GRPC_BIND_HOST ?? "127.0.0.1");
const port = process.env.GRPC_PORT ?? "9091";
const deadline = new Date(Date.now() + 3000);

const client = new HealthClient(`${host}:${port}`, grpc.credentials.createInsecure());

function fail(message: string): void {
  console.error(`health check failed: ${message}`);
  process.exitCode = 1;
  client.close();
}

client.waitForReady(deadline, (readyError) => {
  if (readyError != null) {
    fail(readyError.message);
    return;
  }
  client.check({}, { deadline }, (error, reply) => {
    if (error != null) {
      fail(error.message);
      return;
    }
    if (reply === undefined || reply.status !== HealthCheckResponse_ServingStatus.SERVING) {
      fail(`status ${String(reply?.status)}`);
      return;
    }
    client.close();
  });
});
