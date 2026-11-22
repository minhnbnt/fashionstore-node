import { describe, expect, it, vi } from "vite-plus/test";

import { MODEL_NAME, type QueuedJob } from "../types";
import { Database, PostgresProductImageRepository } from "./db";

function fakeDatabase(rows: unknown[], rowCount = 1) {
  const query = vi.fn().mockResolvedValue({ rows, rowCount });
  const db = { connection: { query } } as unknown as Database;
  return { db, query };
}

const job: QueuedJob = {
  msgId: "1",
  readCt: 1,
  productImageId: "img-1",
  productId: "product-1",
  uploadId: "upload-1",
  s3Key: "images/a.jpg",
};

describe("PostgresProductImageRepository", () => {
  it("getImage trả ref và dùng pipeline param $1", async () => {
    const { db, query } = fakeDatabase([
      {
        id: "img-1",
        product_id: "product-1",
        upload_id: "upload-1",
        s3_key: "images/a.jpg",
      },
    ]);

    const result = await new PostgresProductImageRepository(db).getImage("img-1");

    expect(result).toEqual({
      productImageId: "img-1",
      productId: "product-1",
      uploadId: "upload-1",
      s3Key: "images/a.jpg",
    });
    expect(query.mock.calls[0][0]).toContain("FROM product_image pi");
    expect(query.mock.calls[0][1]).toEqual(["img-1"]);
  });

  it("getImage trả null khi row rỗng", async () => {
    const { db } = fakeDatabase([]);
    expect(await new PostgresProductImageRepository(db).getImage("missing")).toBeNull();
  });

  it("upsertEmbedding serialize vector sang literal ::vector", async () => {
    const { db, query } = fakeDatabase([], 1);

    const result = await new PostgresProductImageRepository(db).upsertEmbedding(
      job,
      new Float32Array([0.1, 0.2]),
      MODEL_NAME,
    );

    expect(result).toBe(true);
    expect(query.mock.calls[0][0]).toContain("$3::vector");
    expect(query.mock.calls[0][1][2]).toBe("[0.10000000149011612,0.20000000298023224]");
  });

  it("upsertEmbedding trả false khi guard upload_id không khớp", async () => {
    const { db } = fakeDatabase([], 0);
    const result = await new PostgresProductImageRepository(db).upsertEmbedding(
      job,
      new Float32Array([1]),
      MODEL_NAME,
    );
    expect(result).toBe(false);
  });

  it("setEmbedError xoá vector cũ và ghi lỗi", async () => {
    const { db, query } = fakeDatabase([], 1);

    await new PostgresProductImageRepository(db).setEmbedError(job, "boom");

    expect(query.mock.calls[0][0]).toContain("embedding = NULL");
    expect(query.mock.calls[0][0]).toContain("embed_error = EXCLUDED.embed_error");
    expect(query.mock.calls[0][1]).toEqual(["img-1", "upload-1", "boom"]);
  });
});
