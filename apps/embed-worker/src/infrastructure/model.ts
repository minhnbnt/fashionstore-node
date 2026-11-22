import {
  CLIPVisionModelWithProjection,
  Tensor,
  env,
  type CLIPVisionModelWithProjection as VisionModelType,
} from "@huggingface/transformers";

import type { Settings } from "../config";
import type { DecodedImage, EmbeddingModel } from "../types";
import { EMBED_DIM } from "../types";
import { preprocessForClip } from "./image";

const CLIP_SIZE = 224;
const CHANNELS = 3;

export class FashionClipModel implements EmbeddingModel {
  private visionModel: VisionModelType | null = null;
  private readonly settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  async load(): Promise<void> {
    if (this.visionModel !== null) {
      return;
    }
    const { modelId, modelRevision, modelCacheDir, localFilesOnly } = this.settings;
    if (localFilesOnly) {
      env.allowRemoteModels = false;
      if (modelCacheDir !== undefined) {
        env.localModelPath = `${modelCacheDir.replace(/\/$/u, "")}/hub/`;
      }
    }
    console.info(`Loading ${modelId} @ ${modelRevision}`);
    this.visionModel = await CLIPVisionModelWithProjection.from_pretrained(modelId, {
      revision: modelRevision,
      cache_dir: modelCacheDir,
      local_files_only: localFilesOnly,
      dtype: "fp32",
      device: "cpu",
      model_file_name: "vision_model",
      session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
    });
  }

  async embedImages(images: DecodedImage[]): Promise<Float32Array[]> {
    if (images.length === 0) {
      await this.load();
      return [];
    }
    const pixelData = new Float32Array(images.length * CHANNELS * CLIP_SIZE * CLIP_SIZE);
    images.forEach((image, index) => {
      pixelData.set(preprocessForClip(image), index * CHANNELS * CLIP_SIZE * CLIP_SIZE);
    });
    return this.embedPixelValues(pixelData, images.length);
  }

  /** Nhận pixel_values CHW đã normalize — dùng cho test parity ở mức model. */
  async embedPixelValues(pixelData: Float32Array, count: number): Promise<Float32Array[]> {
    await this.load();
    if (this.visionModel === null) {
      throw new Error("model is not loaded");
    }
    const pixelValues = new Tensor("float32", pixelData, [count, CHANNELS, CLIP_SIZE, CLIP_SIZE]);
    const { image_embeds } = await this.visionModel({ pixel_values: pixelValues });
    const embeds = image_embeds.data;
    const result: Float32Array[] = [];
    for (let i = 0; i < count; i += 1) {
      const vector = Float32Array.from(embeds.subarray(i * EMBED_DIM, (i + 1) * EMBED_DIM));
      let norm = 0;
      for (const value of vector) {
        norm += value * value;
      }
      const scale = 1 / Math.sqrt(norm);
      for (let j = 0; j < vector.length; j += 1) {
        vector[j] *= scale;
      }
      result.push(vector);
    }
    return result;
  }
}
