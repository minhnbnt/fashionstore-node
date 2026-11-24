import { tool } from "ai";
import { z } from "zod";

import { uploadImage } from "../../storage/s3";

export const DEFAULT_VTON_API_URL = "http://localhost:8001";

const FAILED_MESSAGE = "Tạo ảnh thử đồ thất bại, vui lòng thử lại sau.";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function resolveVtonApiUrl(): string {
  const configured = process.env.VTON_API_URL?.trim();
  if (configured) {
    return configured;
  }
  return DEFAULT_VTON_API_URL;
}

function blobToImageFile(blob: Blob, baseName: string): File {
  const mime = blob.type || "image/png";
  const normalizedMime = mime.split(";")[0].trim().toLowerCase();
  const ext = MIME_TO_EXT[normalizedMime] ?? "png";
  return new File([blob], `${baseName}.${ext}`, { type: mime });
}

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
    "Link ảnh garment thử đồ của sản phẩm, lấy từ getProductDetail (garmentUrl) hoặc ảnh trang phục khách cung cấp",
  ),
  mode: z
    .enum(["top", "bottom", "full"])
    .describe("Chế độ thử đồ: top = chỉ đổi áo, bottom = chỉ đổi quần, full = đổi cả bộ"),
});

export type TryOnToolInput = z.infer<typeof tryOnInputSchema>;

export interface TryOnToolOutput {
  image: {
    key: string;
    url: string;
  };
}

function extractUrlFromItem(item: unknown): string | null {
  if (typeof item === "string") {
    if (item !== "") {
      return item;
    }
    return null;
  }
  if (item === null || typeof item !== "object") {
    return null;
  }
  const record = item as { url?: unknown; image?: unknown };
  if (typeof record.url === "string" && record.url !== "") {
    return record.url;
  }
  if (record.image !== null && typeof record.image === "object") {
    const imageUrl = (record.image as { url?: unknown }).url;
    if (typeof imageUrl === "string" && imageUrl !== "") {
      return imageUrl;
    }
  }
  return null;
}

/** Kết quả Gradio trả về dạng dữ liệu lạ, hoặc thiếu url thì coi như tạo ảnh thất bại. */
function extractResultUrl(data: unknown): string {
  if (Array.isArray(data) === false || data.length === 0) {
    throw new Error(FAILED_MESSAGE);
  }
  const first = (data as unknown[])[0];
  let candidate: unknown = first;
  if (Array.isArray(first)) {
    candidate = first[0];
  }
  const url = extractUrlFromItem(candidate);
  if (url !== null) {
    return url;
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

/** Tool tạo ảnh thử đồ ảo qua server vton-ai local (Gradio API): chỉ xử lý và lưu ảnh lên S3,
 *  khách không thấy gì — muốn hiện kết quả thì model gọi tiếp showImage. */
export function createTryOnTool() {
  return tool({
    description:
      "Tạo ảnh thử đồ ảo qua vton-ai: khớp ảnh khách đính kèm với ảnh trang phục theo chế độ top/bottom/full. Tool chỉ tạo và lưu ảnh, khách không thấy gì; sau khi tạo xong cần gọi showImage để hiện ảnh kết quả cho khách.",
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

      const personFile = blobToImageFile(personBlob, "person");
      const garmentFile = blobToImageFile(garmentBlob, "garment");

      const { Client } = await import("@gradio/client");
      let resultUrl: string;
      try {
        const app = await Client.connect(resolveVtonApiUrl());
        const result = await app.predict("/process_images", {
          images: [personFile, garmentFile],
          mode: input.mode,
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
