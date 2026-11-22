import { describe, expect, it } from "vite-plus/test";

import { buildSystemPrompt, createAgentTools, EMPTY_FILTERS } from "./agent";

describe("buildSystemPrompt", function () {
  it("là prompt tĩnh, không chứa context của request", function () {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("getPageContext");
    expect(prompt).not.toContain("Bộ lọc khách đang đặt");
    expect(prompt).not.toContain("Khách đang xem trang chi tiết");
  });

  it("vẫn nhắc searchProducts và showProducts", function () {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("searchProducts");
    expect(prompt).toContain("showProducts");
    expect(prompt).toContain("3 sản phẩm");
  });

  it("nhắc agent dùng readImage với link ảnh từ getPageContext", function () {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("readImage");
    expect(prompt).toContain("getPageContext");
  });
});

describe("createAgentTools", function () {
  it("đăng ký đủ 6 tool", function () {
    const tools = createAgentTools({
      authorization: "Bearer t-1",
      context: { route: "/search", filters: EMPTY_FILTERS },
    });
    expect(Object.keys(tools).sort()).toEqual([
      "getPageContext",
      "getProductDetail",
      "listCategories",
      "readImage",
      "searchProducts",
      "showProducts",
    ]);
  });
});
