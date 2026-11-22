import { describe, expect, it } from "vite-plus/test";

import { EMPTY_FILTERS } from "../context";
import { createGetPageContextTool } from "./getPageContext";

function plainOutput<T>(value: T | AsyncIterable<T>): T {
  if (Symbol.asyncIterator in Object(value)) {
    throw new Error("expected plain tool output");
  }
  return value as T;
}

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

  it("trả URL ảnh đính kèm cho agent khi request có ảnh", async function () {
    const tool = createGetPageContextTool({
      context: {
        route: "/search",
        filters: EMPTY_FILTERS,
        image: { url: "https://assets.test/attached/abc.png", mediaType: "image/png" },
      },
    });
    const result = plainOutput(await tool.execute({}, {} as never));
    expect(result.image).toEqual({
      url: "https://assets.test/attached/abc.png",
      mediaType: "image/png",
    });
  });
});
