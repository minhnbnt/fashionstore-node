import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// Cùng bộ env với embed-worker để dev/prod cấu hình một kiểu.
const ENDPOINT = process.env.S3_ENDPOINT_URL ?? "http://localhost:9000";
const BUCKET = process.env.S3_BUCKET ?? "fashionstore";
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? "fashionstore";
const SECRET_KEY = process.env.S3_SECRET_KEY ?? "passwordpassword";
const REGION = process.env.S3_REGION ?? "us-east-1";
const ASSETS_URL = process.env.ASSETS_URL ?? "http://localhost:9000/fashionstore";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

/** Upload một ảnh kết quả (thử đồ) lên S3 với key riêng prefix tryon/,
 *  trả key và URL public ghép từ ASSETS_URL (cùng domain ảnh sản phẩm). */
export async function uploadImage(
  buffer: Buffer,
  contentType: string,
): Promise<{ key: string; url: string }> {
  const key = `tryon/${randomUUID()}.png`;
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  return { key, url: `${ASSETS_URL}/${key}` };
}
