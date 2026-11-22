import { describe, expect, it } from "vite-plus/test";

import { createShowImageTool, showImageInputSchema } from "./showImage";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

describe("showImageInputSchema", function () {
  it("chỉ nhận link http(s)", function () {
    expect(showImageInputSchema.safeParse({ url: "https://assets.test/a.png" }).success).toBe(true);
    expect(showImageInputSchema.safeParse({ url: "ftp://assets.test/a.png" }).success).toBe(false);
  });
});

describe("createShowImageTool", function () {
  it("echo lại đúng url cho frontend render", async function () {
    const tool = createShowImageTool();

    const result = (await tool.execute(
      { url: "https://assets.test/tryon/x.png" },
      executeOptions(),
    )) as { url: string };

    expect(result).toEqual({ url: "https://assets.test/tryon/x.png" });
  });
});
