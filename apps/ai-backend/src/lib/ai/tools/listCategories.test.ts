import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { listCategoriesMock } = vi.hoisted(function () {
  return { listCategoriesMock: vi.fn() };
});

vi.mock("../../../../generated/endpoints/categories/categories", function () {
  return { listCategories: listCategoriesMock };
});

import { createListCategoriesTool } from "./listCategories";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

beforeEach(function () {
  vi.clearAllMocks();
});

describe("createListCategoriesTool", () => {
  it("gọi API listCategories kèm authorization header và trả slug + tên gọn", async function () {
    listCategoriesMock.mockResolvedValue({
      status: 200,
      data: [{ id: "1", slug: "ao", name: "Áo", productCount: 5 }],
    });

    const tool = createListCategoriesTool({ authorization: "Bearer t-1" });
    const output = await tool.execute?.({}, executeOptions());

    expect(listCategoriesMock).toHaveBeenCalledWith({
      headers: { authorization: "Bearer t-1" },
    });
    expect(output).toEqual({ categories: [{ slug: "ao", name: "Áo" }] });
  });
});
