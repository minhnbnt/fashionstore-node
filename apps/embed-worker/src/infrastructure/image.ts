import { decode as decodeJpeg } from "jpeg-js";
import sharp from "sharp";

import { InvalidImageError, type DecodedImage } from "../types";
import { resizeBicubicPil } from "./pil-resize";

const CLIP_SIZE = 224;
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export async function decodeImage(buffer: Buffer): Promise<DecodedImage> {
  try {
    if (isJpeg(buffer)) {
      // jpeg-js khớp libjpeg của Pillow hơn sharp (~4× ít sai hơn ở raw pixel).
      const decoded = decodeJpeg(buffer, { useTArray: true, formatAsRGBA: false });
      return {
        data: decoded.data,
        width: decoded.width,
        height: decoded.height,
        channels: 3,
      };
    }
    const { data, info } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: 3 };
  } catch (cause) {
    throw new InvalidImageError(`cannot decode image: ${String(cause)}`);
  }
}

function resizeDimensions(width: number, height: number): [number, number] {
  const factor = Math.max(CLIP_SIZE / width, CLIP_SIZE / height);
  return [
    Math.floor(Number((width * factor).toFixed(2))),
    Math.floor(Number((height * factor).toFixed(2))),
  ];
}

/** Trả pixel_values CHW đã normalize, khớp CLIPProcessor của worker Python. */
export function preprocessForClip(image: DecodedImage): Float32Array {
  const [width, height] = resizeDimensions(image.width, image.height);
  const resized = resizeBicubicPil(image.data, image.width, image.height, width, height);
  const left = Math.floor((width - CLIP_SIZE) / 2);
  const top = Math.floor((height - CLIP_SIZE) / 2);
  const output = new Float32Array(3 * CLIP_SIZE * CLIP_SIZE);
  for (let y = 0; y < CLIP_SIZE; y += 1) {
    for (let x = 0; x < CLIP_SIZE; x += 1) {
      const sourceIndex = ((top + y) * width + left + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const normalized = resized[sourceIndex + channel] / 255;
        output[channel * CLIP_SIZE * CLIP_SIZE + y * CLIP_SIZE + x] =
          (normalized - MEAN[channel]) / STD[channel];
      }
    }
  }
  return output;
}
