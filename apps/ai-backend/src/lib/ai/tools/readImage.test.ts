import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import sharp from "sharp";

import { createReadImageTool, readImageInputSchema } from "./readImage";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

function plainOutput<T>(value: T | AsyncIterable<T>): T {
  if (Symbol.asyncIterator in Object(value)) {
    throw new Error("expected plain tool output");
  }
  return value as T;
}

async function imageResponse(width: number, height: number): Promise<Response> {
  const png = await sharp({ create: { width, height, channels: 3, background: "#ff0000" } })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

afterEach(function () {
  vi.unstubAllGlobals();
});

describe("readImageInputSchema", function () {
  it("chỉ nhận link http(s)", function () {
    expect(readImageInputSchema.safeParse({ url: "https://assets.test/a.png" }).success).toBe(true);
    expect(readImageInputSchema.safeParse({ url: "ftp://assets.test/a.png" }).success).toBe(false);
  });
});

describe("createReadImageTool", function () {
  it("fetch ảnh, thu nhỏ về 1024px và trả base64 cho model đọc", async function () {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(await imageResponse(2000, 1000)));
    const tool = createReadImageTool();

    const result = plainOutput(
      await tool.execute({ url: "https://assets.test/large.png" }, executeOptions()),
    );

    expect(result.url).toBe("https://assets.test/large.png");
    expect(result.mediaType).toBe("image/jpeg");
    const decoded = sharp(Buffer.from(result.data, "base64"));
    const metadata = await decoded.metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1024);
    expect(metadata.height).toBe(512);
  });

  it("báo lỗi thân thiện khi fetch ảnh thất bại", async function () {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));
    const tool = createReadImageTool();

    await expect(
      tool.execute({ url: "https://assets.test/missing.png" }, executeOptions()),
    ).rejects.toThrow("Không tải được ảnh");
  });
});
