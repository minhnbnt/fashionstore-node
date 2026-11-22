import { describe, expect, it } from "vite-plus/test";

import { EMPTY_FILTERS } from "../context";
import { createGetPageContextTool } from "./getPageContext";

describe("createGetPageContextTool", function () {
  it("trả nguyên context của request hiện tại", async function () {
    const context = {
      route: "/search",
      filters: { ...EMPTY_FILTERS, q: "áo" },
      productId: undefined,
    };
    const tool = createGetPageContextTool({ context });
    const result = await tool.execute({}, {} as never);
    expect(result).toEqual(context);
  });
});
