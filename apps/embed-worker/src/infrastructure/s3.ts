import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { Settings } from "../config";
import { ImageStoreError, type ImageStore } from "../types";

export class S3ImageStore implements ImageStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(settings: Settings) {
    this.client = new S3Client({
      endpoint: settings.s3EndpointUrl,
      region: settings.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: settings.s3AccessKey,
        secretAccessKey: settings.s3SecretKey,
      },
    });
    this.bucket = settings.s3Bucket;
  }

  async get(key: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (response.Body === undefined) {
        throw new Error("empty body");
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (cause) {
      throw new ImageStoreError(`S3 get failed for ${key}: ${String(cause)}`);
    }
  }
}
