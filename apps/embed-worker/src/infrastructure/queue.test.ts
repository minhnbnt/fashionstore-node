import type { Pool } from "pg";
import { describe, expect, it, vi } from "vite-plus/test";

import type { QueuedJob } from "../types";
import { PgmqJobQueue } from "./queue";

function message(overrides: Record<string, unknown> = {}) {
  return {
    product_image_id: "img-1",
    product_id: "product-1",
    upload_id: "upload-1",
    s3_key: "images/a.jpg",
    ...overrides,
  };
}

function fakePool(...results: Array<{ rows: unknown[] }>) {
  const query = vi.fn();
  for (const result of results) {
    query.mockResolvedValueOnce(result);
  }
  query.mockResolvedValue({ rows: [] });
  return { pool: { query } as unknown as Pool, query };
}

describe("PgmqJobQueue", () => {
  it("map payload pgmq sang QueuedJob, giữ msgId bigint dạng string", async () => {
    const { pool } = fakePool({
      rows: [
        {
          msg_id: "9007199254740993",
          read_ct: 2,
          message: message(),
        },
      ],
    });
    const queue = new PgmqJobQueue(pool, "embed_jobs", 5, 100);

    const jobs = await queue.readBatch(16, 60);

    expect(jobs).toEqual([
      {
        msgId: "9007199254740993",
        readCt: 2,
        productImageId: "img-1",
        productId: "product-1",
        uploadId: "upload-1",
        s3Key: "images/a.jpg",
      },
    ]);
  });

  it("message hỏng bị archive riêng, message tốt vẫn trả về", async () => {
    const { pool, query } = fakePool({
      rows: [
        { msg_id: "10", read_ct: 1, message: message({ s3_key: undefined }) },
        { msg_id: "11", read_ct: 1, message: message({ product_image_id: "img-2" }) },
      ],
    });
    const queue = new PgmqJobQueue(pool, "embed_jobs", 5, 100);

    const jobs = await queue.readBatch(16, 60);

    expect(jobs.map((job) => job.msgId)).toEqual(["11"]);
    expect(query).toHaveBeenCalledWith("SELECT pgmq.archive($1, $2)", ["embed_jobs", "10"]);
  });

  it("long-poll hỏi lại mỗi interval rồi trả khi có message", async () => {
    const { pool } = fakePool(
      { rows: [] },
      { rows: [] },
      { rows: [{ msg_id: "12", read_ct: 1, message: message() }] },
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const queue = new PgmqJobQueue(pool, "embed_jobs", 5, 100, sleep);

    const jobs = await queue.readBatch(16, 60);

    expect(jobs).toHaveLength(1);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it("hết poll_max_seconds thì trả rỗng sau đúng một lần hỏi", async () => {
    const { pool, query } = fakePool({ rows: [] });
    const queue = new PgmqJobQueue(pool, "embed_jobs", 0, 100);

    expect(await queue.readBatch(16, 60)).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("archive gửi msgId dạng string cho pgmq", async () => {
    const { pool, query } = fakePool();
    const queue = new PgmqJobQueue(pool, "embed_jobs", 5, 100);
    const job = {
      msgId: "9007199254740993",
      readCt: 1,
      productImageId: "img-1",
      productId: "product-1",
      uploadId: "upload-1",
      s3Key: "images/a.jpg",
    } satisfies QueuedJob;

    await queue.archive(job);

    expect(query).toHaveBeenCalledWith("SELECT pgmq.archive($1, $2)", [
      "embed_jobs",
      "9007199254740993",
    ]);
  });
});
