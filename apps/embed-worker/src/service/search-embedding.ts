import { decodeImage } from "../infrastructure/image";
import { EMBED_DIM, ImageTooLargeError, InvalidImageError, type EmbeddingModel } from "../types";

export class SearchEmbedder {
  private readonly model: EmbeddingModel;
  private readonly maxImageBytes: number;

  constructor(model: EmbeddingModel, maxImageBytes = 8 * 1024 * 1024) {
    this.model = model;
    this.maxImageBytes = maxImageBytes;
  }

  async embed(data: Buffer): Promise<number[]> {
    if (data.length === 0) {
      throw new InvalidImageError("ảnh rỗng");
    }
    if (data.length > this.maxImageBytes) {
      throw new ImageTooLargeError(`ảnh ${data.length} byte vượt ${this.maxImageBytes}`);
    }
    const image = await decodeImage(data);
    const vectors = await this.model.embedImages([image]);
    if (vectors.length === 0) {
      throw new Error("model returned no vector");
    }
    const vector = Array.from(vectors[0]);
    if (vector.length !== EMBED_DIM) {
      throw new Error(`model trả ${vector.length} chiều, cần ${EMBED_DIM}`);
    }
    return vector;
  }
}
