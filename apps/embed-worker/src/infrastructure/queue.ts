import type { Pool } from "pg";

import type { JobQueue, QueuedJob } from "../types";

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toJob(row: Record<string, unknown>): QueuedJob | null {
  const message = row.message;
  if (!isRecord(message)) {
    return null;
  }
  const { product_image_id, product_id, upload_id, s3_key } = message;
  if (
    typeof product_image_id !== "string" ||
    typeof product_id !== "string" ||
    typeof upload_id !== "string" ||
    typeof s3_key !== "string"
  ) {
    return null;
  }
  if (typeof row.msg_id !== "string" && typeof row.msg_id !== "number") {
    return null;
  }
  return {
    msgId: String(row.msg_id),
    readCt: Number(row.read_ct),
    productImageId: product_image_id,
    productId: product_id,
    uploadId: upload_id,
    s3Key: s3_key,
  };
}

export class PgmqJobQueue implements JobQueue {
  private readonly pool: Pool;
  private readonly queueName: string;
  private readonly pollMaxSeconds: number;
  private readonly pollIntervalMs: number;
  private readonly sleep: Sleep;

  constructor(
    pool: Pool,
    queueName: string,
    pollMaxSeconds: number,
    pollIntervalMs: number,
    sleep: Sleep = defaultSleep,
  ) {
    this.pool = pool;
    this.queueName = queueName;
    this.pollMaxSeconds = pollMaxSeconds;
    this.pollIntervalMs = pollIntervalMs;
    this.sleep = sleep;
  }

  async readBatch(qty: number, visibilityTimeoutS: number): Promise<QueuedJob[]> {
    const deadline = Date.now() + this.pollMaxSeconds * 1000;
    for (;;) {
      const { rows } = await this.pool.query(
        "SELECT msg_id, read_ct, message FROM pgmq.read($1, $2, $3)",
        [this.queueName, visibilityTimeoutS, qty],
      );
      const jobs: QueuedJob[] = [];
      for (const row of rows) {
        const job = toJob(row);
        if (job === null) {
          console.warn(`malformed message ${String(row.msg_id)}, archiving`);
          await this.archiveById(String(row.msg_id));
          continue;
        }
        jobs.push(job);
      }
      if (jobs.length > 0) {
        return jobs;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return [];
      }
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }
  }

  async archive(job: QueuedJob): Promise<void> {
    await this.archiveById(job.msgId);
  }

  private async archiveById(msgId: string): Promise<void> {
    await this.pool.query("SELECT pgmq.archive($1, $2)", [this.queueName, msgId]);
  }
}
