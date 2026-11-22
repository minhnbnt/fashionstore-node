import { tool } from "ai";
import sharp from "sharp";
import { z } from "zod";

/** Ảnh đưa vào model bị co về tối đa 1024px cạnh dài rồi encode JPEG,
 *  tránh base64 của ảnh điện thoại 5MB phình hàng triệu token. */
const MAX_DIMENSION = 1024;

export const readImageInputSchema = z.object({
  url: z
    .url()
    .refine(
      function (value) {
        return value.startsWith("http://") || value.startsWith("https://");
      },
      { message: "Chỉ nhận link ảnh http(s)." },
    )
    .describe("Link ảnh http(s) muốn xem nội dung"),
});

export interface ReadImageToolOutput {
  url: string;
  mediaType: string;
  data: string;
}

/** Tool đọc ảnh: fetch link, thu nhỏ rồi trả base64 làm tool output cho model. */
export function createReadImageTool() {
  return tool({
    description:
      "Xem nội dung một ảnh theo link http(s). Dùng link ảnh khách đính kèm lấy được từ getPageContext; ảnh chỉ mình agent thấy, khách không thấy.",
    inputSchema: readImageInputSchema,
    execute: async function ({ url }): Promise<ReadImageToolOutput> {
      let response: Response;
      try {
        response = await fetch(url);
      } catch {
        throw new Error("Không tải được ảnh để xem, vui lòng thử lại sau.");
      }
      if (response.ok === false) {
        throw new Error("Không tải được ảnh để xem, vui lòng thử lại sau.");
      }

      const source = Buffer.from(await response.arrayBuffer());
      const resized = await sharp(source)
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      return {
        url,
        mediaType: "image/jpeg",
        data: resized.toString("base64"),
      };
    },
  });
}
