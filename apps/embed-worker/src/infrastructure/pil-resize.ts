// Bicubic resample port từ Pillow src/libImaging/Resample.c (a = -0.5).
// Cần thiết để vector Node khớp worker Python: sharp/libvips resize khác Pillow.

const PRECISION_BITS = 22;

interface Coefficients {
  bounds: Int32Array;
  k: Int32Array;
  ksize: number;
}

function bicubicKernel(value: number): number {
  const x = Math.abs(value);
  const a = -0.5;
  if (x < 1) {
    return ((a + 2) * x - (a + 3)) * x * x + 1;
  }
  if (x < 2) {
    return (((x - 5) * x + 8) * x - 4) * a;
  }
  return 0;
}

function coefficients(inSize: number, outSize: number): Coefficients {
  const scale = inSize / outSize;
  const filterScale = Math.max(1, scale);
  const support = 2 * filterScale;
  const inverseFilterScale = 1 / filterScale;
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Float64Array(outSize * ksize);

  for (let out = 0; out < outSize; out += 1) {
    const center = (out + 0.5) * scale;
    let weightSum = 0;
    let start = Math.trunc(center - support + 0.5);
    if (start < 0) {
      start = 0;
    }
    let end = Math.trunc(center + support + 0.5);
    if (end > inSize) {
      end = inSize;
    }
    const count = end - start;
    for (let i = 0; i < count; i += 1) {
      const weight = bicubicKernel((i + start - center + 0.5) * inverseFilterScale);
      kk[out * ksize + i] = weight;
      weightSum += weight;
    }
    if (weightSum !== 0) {
      for (let i = 0; i < count; i += 1) {
        kk[out * ksize + i] /= weightSum;
      }
    }
    bounds[out * 2] = start;
    bounds[out * 2 + 1] = count;
  }

  const quantized = new Int32Array(kk.length);
  for (let i = 0; i < kk.length; i += 1) {
    const scaled =
      kk[i] < 0 ? -0.5 + kk[i] * (1 << PRECISION_BITS) : 0.5 + kk[i] * (1 << PRECISION_BITS);
    quantized[i] = Math.trunc(scaled);
  }
  return { bounds, k: quantized, ksize };
}

function clip8(value: number): number {
  const index = value >> PRECISION_BITS;
  if (index < 0) {
    return 0;
  }
  if (index > 255) {
    return 255;
  }
  return index;
}

/** Resize ảnh RGB (HWC, 3 channels) bằng đúng kernel/quantize của Pillow BICUBIC. */
export function resizeBicubicPil(
  src: Uint8Array | Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
): Uint8Array {
  const horizontal = coefficients(srcWidth, outWidth);
  const vertical = coefficients(srcHeight, outHeight);
  const temp = new Uint8Array(outWidth * srcHeight * 3);

  for (let y = 0; y < srcHeight; y += 1) {
    for (let outX = 0; outX < outWidth; outX += 1) {
      const start = horizontal.bounds[outX * 2];
      const count = horizontal.bounds[outX * 2 + 1];
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 1 << (PRECISION_BITS - 1);
        for (let i = 0; i < count; i += 1) {
          sum +=
            src[(y * srcWidth + start + i) * 3 + channel] *
            horizontal.k[outX * horizontal.ksize + i];
        }
        temp[(y * outWidth + outX) * 3 + channel] = clip8(sum);
      }
    }
  }

  const out = new Uint8Array(outWidth * outHeight * 3);
  for (let outY = 0; outY < outHeight; outY += 1) {
    const start = vertical.bounds[outY * 2];
    const count = vertical.bounds[outY * 2 + 1];
    for (let x = 0; x < outWidth; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 1 << (PRECISION_BITS - 1);
        for (let i = 0; i < count; i += 1) {
          sum +=
            temp[((start + i) * outWidth + x) * 3 + channel] *
            vertical.k[outY * vertical.ksize + i];
        }
        out[(outY * outWidth + x) * 3 + channel] = clip8(sum);
      }
    }
  }
  return out;
}
