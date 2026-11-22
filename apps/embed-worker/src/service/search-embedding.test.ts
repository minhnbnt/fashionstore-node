import sharp from "sharp";
import { describe, expect, it, vi } from "vite-plus/test";

import { ImageTooLargeError, InvalidImageError, type EmbeddingModel } from "../types";
import { SearchEmbedder } from "./search-embedding";

const imageBuffer = await sharp({
  create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
})
  .png()
  .toBuffer();

function fakeModel(dimension = 512) {
  const embedImages = vi.fn().mockResolvedValue([new Float32Array(dimension).fill(1)]);
  const model: EmbeddingModel = { load: vi.fn().mockResolvedValue(undefined), embedImages };
  return { model, embedImages };
}

describe("SearchEmbedder", () => {
  it("buffer rỗng bị từ chối trước khi gọi model", async () => {
    const { model, embedImages } = fakeModel();

    await expect(new SearchEmbedder(model).embed(Buffer.alloc(0))).rejects.toBeInstanceOf(
      InvalidImageError,
    );
    expect(embedImages).not.toHaveBeenCalled();
  });

  it("ảnh quá 8MB bị từ chối", async () => {
    const { model, embedImages } = fakeModel();

    await expect(
      new SearchEmbedder(model).embed(Buffer.alloc(8 * 1024 * 1024 + 1)),
    ).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(embedImages).not.toHaveBeenCalled();
  });

  it("bytes không decode được → InvalidImageError", async () => {
    const { model } = fakeModel();

    await expect(
      new SearchEmbedder(model).embed(Buffer.from([0, 1, 2, 3, 4])),
    ).rejects.toBeInstanceOf(InvalidImageError);
  });

  it("model trả sai chiều → lỗi", async () => {
    const { model } = fakeModel(511);

    await expect(new SearchEmbedder(model).embed(imageBuffer)).rejects.toThrow(/511 chiều/u);
  });

  it("ảnh hợp lệ → 512 số", async () => {
    const { model } = fakeModel();

    const vector = await new SearchEmbedder(model).embed(imageBuffer);

    expect(vector).toHaveLength(512);
    expect(vector[0]).toBe(1);
  });
});
