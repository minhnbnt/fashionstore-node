import { tool } from "ai";
import { z } from "zod";

import { uploadImage } from "../../storage/s3";

export const TRYON_SPACE = "fashn-ai/fashn-vton-1.5";

const FAILED_MESSAGE = "Tạo ảnh thử đồ thất bại, vui lòng thử lại sau.";

function httpImage(message: string) {
  return z
    .url()
    .refine(
      function (value) {
        return value.startsWith("http://") || value.startsWith("https://");
      },
      { message: "Chỉ nhận link ảnh http(s)." },
    )
    .describe(message);
}

export const tryOnInputSchema = z.object({
  personImageUrl: httpImage("Link ảnh khách đính kèm, lấy từ ngữ cảnh hệ thống"),
  garmentImageUrl: httpImage(
    "Link ảnh garment thử đồ của sản phẩm, lấy từ getProductDetail (garmentImageUrl)",
  ),
  category: z.enum(["tops", "bottoms", "one-pieces"]).describe("Loại trang phục của sản phẩm"),
  garmentPhotoType: z
    .enum(["model", "flat-lay"])
    .describe("Kiểu ảnh sản phẩm: người mẫu mặc (model) hay ảnh trải phẳng (flat-lay)"),
});

export type TryOnToolInput = z.infer<typeof tryOnInputSchema>;

export interface TryOnToolOutput {
  image: {
    key: string;
    url: string;
  };
}

/** Kết quả Space trả về dạng dữ liệu lạ, hoặc thiếu url thì coi như tạo ảnh thất bại. */
function extractResultUrl(data: unknown): string {
  if (Array.isArray(data) === false) {
    throw new Error(FAILED_MESSAGE);
  }
  const first = (data as unknown[])[0];
  if (typeof first === "string" && first !== "") {
    return first;
  }
  if (first !== null && typeof first === "object") {
    const url = (first as { url?: unknown }).url;
    if (typeof url === "string" && url !== "") {
      return url;
    }
  }
  throw new Error(FAILED_MESSAGE);
}

async function fetchBlob(url: string, failureMessage: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(failureMessage);
  }
  if (response.ok === false) {
    throw new Error(failureMessage);
  }
  return response.blob();
}

/** Tool tạo ảnh thử đồ ảo qua Space fashn-ai/fashn-vton-1.5: chỉ xử lý và lưu ảnh lên S3,
 *  khách không thấy gì — muốn hiện kết quả thì model gọi tiếp showImage. */
export function createTryOnTool() {
  return tool({
    description:
      "Tạo ảnh thử đồ ảo: khớp ảnh khách đính kèm với ảnh sản phẩm trong cửa hàng. Tool chỉ tạo và lưu ảnh, khách không thấy gì; sau khi tạo xong cần gọi showImage để hiện ảnh kết quả cho khách.",
    inputSchema: tryOnInputSchema,
    execute: async function (input): Promise<TryOnToolOutput> {
      const personBlob = await fetchBlob(
        input.personImageUrl,
        "Không tải được ảnh khách đính kèm, vui lòng thử lại sau.",
      );
      const garmentBlob = await fetchBlob(
        input.garmentImageUrl,
        "Không tải được ảnh sản phẩm, vui lòng thử lại sau.",
      );

      const { Client } = await import("@gradio/client");
      let resultUrl: string;
      try {
        const app = await Client.connect(TRYON_SPACE);
        const result = await app.predict("/try_on", {
          person_image: personBlob,
          garment_image: garmentBlob,
          category: input.category,
          garment_photo_type: input.garmentPhotoType,
          num_timesteps: 50,
          guidance_scale: 1.5,
          segmentation_free: true,
          seed: Math.floor(Math.random() * 2147483647),
        });
        resultUrl = extractResultUrl(result.data);
      } catch {
        throw new Error(FAILED_MESSAGE);
      }

      const resultBlob = await fetchBlob(
        resultUrl,
        "Không tải được ảnh kết quả thử đồ, vui lòng thử lại sau.",
      );
      const buffer = Buffer.from(await resultBlob.arrayBuffer());
      const uploaded = await uploadImage(buffer, resultBlob.type || "image/png");
      return { image: { key: uploaded.key, url: uploaded.url } };
    },
  });
}
