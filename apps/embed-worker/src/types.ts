export const EMBED_DIM = 512;
export const MODEL_NAME = "fashion-clip-vit-b32";

export interface DecodedImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3;
}

export interface QueuedJob {
  msgId: string;
  readCt: number;
  productImageId: string;
  productId: string;
  uploadId: string;
  s3Key: string;
}

export interface ProductImageRef {
  productImageId: string;
  productId: string;
  uploadId: string;
  s3Key: string;
}

export class ImageStoreError extends Error {
  override name = "ImageStoreError";
}

export class InvalidImageError extends Error {
  override name = "InvalidImageError";
}

export class ImageTooLargeError extends Error {
  override name = "ImageTooLargeError";
}

export interface ImageStore {
  get(key: string): Promise<Buffer>;
}

export interface EmbeddingModel {
  load(): Promise<void>;
  embedImages(images: DecodedImage[]): Promise<Float32Array[]>;
}

export interface ProductImageRepository {
  getImage(productImageId: string): Promise<ProductImageRef | null>;
  upsertEmbedding(job: QueuedJob, vector: Float32Array, model: string): Promise<boolean>;
  setEmbedError(job: QueuedJob, error: string): Promise<void>;
}

export interface JobQueue {
  readBatch(qty: number, visibilityTimeoutS: number): Promise<QueuedJob[]>;
  archive(job: QueuedJob): Promise<void>;
}
