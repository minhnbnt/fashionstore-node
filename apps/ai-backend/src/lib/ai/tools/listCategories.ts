import { listCategories } from "../../../../generated/endpoints/categories/categories";
import { tool } from "ai";
import { z } from "zod";

import { takeData } from "../../api/apiAdapters";

/** Tool liệt kê danh mục: cho model biết slug danh mục hợp lệ trước khi tìm. */
export function createListCategoriesTool(config: { authorization: string }) {
  return tool({
    description:
      "Liệt kê danh mục sản phẩm của cửa hàng (slug + tên) để biết giá trị danh mục hợp lệ.",
    inputSchema: z.object({}),
    execute: async function (): Promise<{
      categories: Array<{ slug: string; name: string }>;
    }> {
      const categories = takeData(
        await listCategories({ headers: { authorization: config.authorization } }),
      );
      return {
        categories: categories.map(function (category) {
          return { slug: category.slug ?? "", name: category.name ?? "" };
        }),
      };
    },
  });
}
