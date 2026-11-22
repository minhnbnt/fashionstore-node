import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import { loadSettings } from "../config";
import { EMBED_DIM } from "../types";
import { decodeImage } from "./image";
import { FashionClipModel } from "./model";

function cosine(a: Float32Array, b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function newModel(): FashionClipModel {
  return new FashionClipModel(loadSettings({ LOCAL_FILES_ONLY: "false" }));
}

const enabled = process.env.RUN_PARITY === "1";
const paritySuite = enabled ? describe : describe.skip;
const fixtureDir = "test-fixtures";

paritySuite("parity model ONNX với torch", () => {
  it("cùng pixel_values thì vector khớp gần đúng bit", async () => {
    const buffer = readFileSync(`${fixtureDir}/pixel-values.bin`);
    const pixelValues = new Float32Array(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    );
    const expected = JSON.parse(
      readFileSync(`${fixtureDir}/python-pixel-vector.json`, "utf8"),
    ) as number[];

    const [vector] = await newModel().embedPixelValues(pixelValues, 1);

    expect(vector).toHaveLength(EMBED_DIM);
    expect(cosine(vector, expected)).toBeGreaterThanOrEqual(0.99999);
  }, 600_000);
});

paritySuite("parity end-to-end ảnh → vector", () => {
  it("batch 16 ảnh nằm trong ngưỡng drift đã đo", async () => {
    const files = readdirSync(`${fixtureDir}/images`).sort();
    const expected = JSON.parse(
      readFileSync(`${fixtureDir}/python-vectors.json`, "utf8"),
    ) as number[][];
    expect(files).toHaveLength(16);

    const images = [];
    for (const file of files) {
      images.push(await decodeImage(readFileSync(`${fixtureDir}/images/${file}`)));
    }
    const vectors = await newModel().embedImages(images);

    expect(vectors).toHaveLength(16);
    const scores = vectors.map((vector, index) => cosine(vector, expected[index]));
    console.info("cosines:", scores.map((score) => score.toFixed(6)).join(" "));
    // Ngưỡng 0.9975 = min thực đo 0.99798 trừ margin nhỏ.
    // Driver JPEG pure-JS khác libjpeg của Pillow; xem design doc §9.
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0.9975);
    }
  }, 600_000);
});
