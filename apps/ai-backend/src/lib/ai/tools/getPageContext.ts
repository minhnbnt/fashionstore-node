import { tool } from "ai";
import { z } from "zod";

import type { AgentRequestContext } from "../context";

/** Tool context nội bộ: trả trang hiện tại, bộ lọc đang bật và sản phẩm đang xem. */
export function createGetPageContextTool(config: { context: AgentRequestContext }) {
  return tool({
    description:
      "Lấy ngữ cảnh trang hiện tại của khách: đường dẫn, bộ lọc đang bật, id sản phẩm đang xem và ảnh khách đính kèm (nếu có). Gọi tool này trước khi dùng searchProducts hoặc getProductDetail để có input đúng; không được giả định các giá trị này từ lịch sử hội thoại.",
    inputSchema: z.object({}),
    execute: async function (): Promise<AgentRequestContext> {
      return {
        route: config.context.route,
        filters: { ...config.context.filters },
        ...(config.context.productId !== undefined ? { productId: config.context.productId } : {}),
        ...(config.context.image !== undefined ? { image: config.context.image } : {}),
      };
    },
  });
}
