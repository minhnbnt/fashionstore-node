import * as grpc from "@grpc/grpc-js";

import type { SearchEmbedder } from "../service/search-embedding";
import { ImageTooLargeError, InvalidImageError, MODEL_NAME } from "../types";
import type { EmbeddingServiceServer } from "./gen/fashion_clip/v1/embedding_grpc";

export function createEmbeddingService(
  embedder: SearchEmbedder,
  maxConcurrency: number,
): EmbeddingServiceServer {
  let active = 0;
  const embedImage: EmbeddingServiceServer["embedImage"] = (call, callback) => {
    if (active >= maxConcurrency) {
      callback({
        code: grpc.status.RESOURCE_EXHAUSTED,
        details: `quá ${maxConcurrency} RPC đồng thời`,
      });
      return;
    }
    active += 1;
    void (async () => {
      try {
        const vector = await embedder.embed(Buffer.from(call.request.image));
        callback(null, { vector, model: MODEL_NAME });
      } catch (cause: unknown) {
        if (cause instanceof ImageTooLargeError) {
          callback({ code: grpc.status.RESOURCE_EXHAUSTED, details: cause.message });
        } else if (cause instanceof InvalidImageError) {
          callback({ code: grpc.status.INVALID_ARGUMENT, details: cause.message });
        } else {
          callback({ code: grpc.status.INTERNAL, details: String(cause) });
        }
      } finally {
        active -= 1;
      }
    })();
  };
  return { embedImage };
}
