import { Pool } from "pg";

import type { ProductImageRef, ProductImageRepository, QueuedJob } from "../types";

export class Database {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  get connection(): Pool {
    return this.pool;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function serializeVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

export class PostgresProductImageRepository implements ProductImageRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getImage(productImageId: string): Promise<ProductImageRef | null> {
    const { rows } = await this.db.connection.query(
      `SELECT pi.id, pi.product_id, pi.upload_id, u.s3_key
       FROM product_image pi
       JOIN upload u ON u.id = pi.upload_id
       WHERE pi.id = $1`,
      [productImageId],
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      productImageId: row.id,
      productId: row.product_id,
      uploadId: row.upload_id,
      s3Key: row.s3_key,
    };
  }

  async upsertEmbedding(job: QueuedJob, vector: Float32Array, model: string): Promise<boolean> {
    const result = await this.db.connection.query(
      `INSERT INTO product_embedding
          (product_image_id, product_id, upload_id, embedding, model)
       SELECT pi.id, pi.product_id, pi.upload_id, $3::vector, $4
       FROM product_image pi
       WHERE pi.id = $1 AND pi.upload_id = $2
       ON CONFLICT (product_image_id) DO UPDATE SET
          embedding = EXCLUDED.embedding,
          upload_id = EXCLUDED.upload_id,
          model = EXCLUDED.model,
          embed_error = NULL,
          updated_at = now()`,
      [job.productImageId, job.uploadId, serializeVector(vector), model],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async setEmbedError(job: QueuedJob, error: string): Promise<void> {
    await this.db.connection.query(
      `INSERT INTO product_embedding
          (product_image_id, product_id, upload_id, embed_error)
       SELECT pi.id, pi.product_id, pi.upload_id, $3
       FROM product_image pi
       WHERE pi.id = $1 AND pi.upload_id = $2
       ON CONFLICT (product_image_id) DO UPDATE SET
          embedding = NULL,
          upload_id = EXCLUDED.upload_id,
          embed_error = EXCLUDED.embed_error,
          updated_at = now()`,
      [job.productImageId, job.uploadId, error],
    );
  }
}
