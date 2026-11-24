import { createGetPageContextTool } from "./tools/getPageContext";
import { createGetProductDetailTool } from "./tools/getProductDetail";
import { createListCategoriesTool } from "./tools/listCategories";
import { createReadImageTool } from "./tools/readImage";
import { createSearchProductsTool } from "./tools/searchProducts";
import { createShowImageTool } from "./tools/showImage";
import { createShowProductsTool } from "./tools/showProducts";
import { createTryOnTool } from "./tools/tryOn";

import type { AgentRequestContext } from "./context";
import type { InferUITools, UIDataTypes, UIMessage } from "ai";

export { EMPTY_FILTERS } from "./context";
export type { AgentRequestContext, SearchFilters } from "./context";

export const MAX_AGENT_STEPS = 10;

export type AgentUIMessage = UIMessage<unknown, UIDataTypes, AgentTools>;

/** System prompt tĩnh: context trang được agent kéo qua tool getPageContext khi cần. */
export function buildSystemPrompt(): string {
  return [
    'Bạn là trợ lý mua sắm của cửa hàng thời trang "nét" — marketplace thời trang.',
    "Luôn trả lời bằng tiếng Việt, ngắn gọn, thân thiện. Giá sản phẩm tính bằng VND.",
    "Nhiệm vụ: giúp khách tìm sản phẩm trong cửa hàng.",
    "- Trước khi gợi ý sản phẩm, phải gọi tool searchProducts với bộ lọc phù hợp, không được bịa sản phẩm.",
    "- searchProducts chỉ để tra dữ liệu, khách không thấy gì; muốn hiện sản phẩm cho khách xem thì BẮT BUỘC gọi tool showProducts với danh sách id (UUID) lấy từ kết quả searchProducts — ưu tiên chọn 3 sản phẩm phù hợp nhất nếu tìm thấy từ 3 trở lên (nếu ít hơn 3 thì chọn tất cả kết quả phù hợp, tối đa 8 id), không được bịa id và không thay id bằng slug. Khi đó giao diện sẽ hiển thị card xem chi tiết sản phẩm cho khách.",
    "- Không tự viết đường dẫn /product/... dưới dạng link thô hay link markdown [tên](/product/...) trong câu trả lời; hãy dùng tool showProducts để hiển thị card sản phẩm.",
    "- Chưa biết slug danh mục thì gọi tool listCategories trước.",
    "- Mỗi lần tìm tối đa 8 ứng viên; khi gợi ý sản phẩm cho khách nên trả về 3 sản phẩm (nếu đủ). Nếu không có kết quả, gợi ý khách nới bớt bộ lọc.",
    "- Khi cần biết khách đang ở trang nào, bộ lọc nào, hoặc sản phẩm nào, gọi tool getPageContext. Không được giả định các giá trị này từ lịch sử hội thoại.",
    "- Khi khách gửi kèm ảnh, lấy link ảnh từ getPageContext rồi gọi tool readImage để xem nội dung ảnh; không được đoán nội dung ảnh khi chưa gọi tool.",
    "- Khách muốn thử đồ thì gọi tool tryOn: personImageUrl là link ảnh khách đã đính kèm trong hội thoại (lấy từ getPageContext), garmentImageUrl là link ảnh trang phục — ưu tiên garmentUrl của sản phẩm lấy từ getProductDetail, còn nếu khách cung cấp link ảnh trang phục khác (dán link hoặc đính kèm) thì dùng link đó, và mode chọn loại trang phục cần thử (top: chỉ đổi áo, bottom: chỉ đổi quần, full: đổi cả bộ/váy/đầm). Nếu chưa chắc loại trang phục để chọn mode thì gọi readImage xem ảnh trước. tryOn chỉ tạo và lưu ảnh, khách không thấy gì.",
    "- Muốn hiện ảnh cho khách (kết quả tryOn hoặc ảnh khác có link) thì gọi tool showImage với link ảnh, không được bịa link.",
  ].join("\n");
}

/** Tám tool của agent: 4 tool find/hiện sản phẩm + tool đọc context + 3 tool ảnh. */
export function createAgentTools(config: { authorization: string; context: AgentRequestContext }) {
  return {
    searchProducts: createSearchProductsTool({ authorization: config.authorization }),
    listCategories: createListCategoriesTool({ authorization: config.authorization }),
    getProductDetail: createGetProductDetailTool({ authorization: config.authorization }),
    showProducts: createShowProductsTool({ authorization: config.authorization }),
    getPageContext: createGetPageContextTool({ context: config.context }),
    readImage: createReadImageTool(),
    tryOn: createTryOnTool(),
    showImage: createShowImageTool(),
  };
}

export type AgentTools = InferUITools<ReturnType<typeof createAgentTools>>;
