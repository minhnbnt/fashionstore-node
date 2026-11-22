import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const canonical = "../../proto/fashion_clip/v1/embedding.proto";
const copy = "src/grpc/proto/fashion_clip/v1/embedding.proto";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("proto sync", () => {
  it("bản copy khớp proto canonical của worker Python", () => {
    if (!existsSync(canonical)) {
      return;
    }
    expect(sha256(copy)).toBe(sha256(canonical));
  });
});
