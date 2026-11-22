import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import sharp from "sharp";

const { mockConnect, mockPredict, mockUpload } = vi.hoisted(function () {
  return { mockConnect: vi.fn(), mockPredict: vi.fn(), mockUpload: vi.fn() };
});

vi.mock("@gradio/client", function () {
  return {
    Client: {
      connect: mockConnect,
    },
  };
});

vi.mock("../../storage/s3", function () {
  return {
    uploadImage: mockUpload,
  };
});

import { createTryOnTool, tryOnInputSchema, TRYON_SPACE } from "./tryOn";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

function validInput() {
  return {
    personImageUrl: "https://assets.test/person.png",
    garmentImageUrl: "https://assets.test/garment.png",
    category: "tops" as const,
    garmentPhotoType: "model" as const,
  };
}

async function pngResponse(): Promise<Response> {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#ff0000" } })
    .png()
    .toBuffer();
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function stubFetch() {
  const mockFetch = vi.fn(function (url: unknown) {
    if (url === "https://assets.test/person.png" || url === "https://space.test/out.png") {
      return Promise.resolve(pngResponse());
    }
    if (url === "https://assets.test/garment.png") {
      return Promise.resolve(pngResponse());
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

afterEach(function () {
  vi.unstubAllGlobals();
  mockConnect.mockReset();
  mockPredict.mockReset();
  mockUpload.mockReset();
});

function spaceApp(predictResult: { data: unknown }) {
  mockConnect.mockResolvedValue({ predict: mockPredict });
  mockPredict.mockResolvedValue(predictResult);
}

describe("tryOnInputSchema", function () {
  it("nhận cả link http lẫn https để dev test qua MinIO/localhost", function () {
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "http://fashionstore.web.localhost:3902/uploads/x.png",
        garmentImageUrl: "http://localhost:9000/fashionstore/garment.png",
        category: "tops",
        garmentPhotoType: "model",
      }).success,
    ).toBe(true);
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "https://assets.test/person.png",
        garmentImageUrl: "https://assets.test/garment.png",
        category: "tops",
        garmentPhotoType: "model",
      }).success,
    ).toBe(true);
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "ftp://assets.test/person.png",
        garmentImageUrl: "https://assets.test/garment.png",
        category: "tops",
        garmentPhotoType: "model",
      }).success,
    ).toBe(false);
  });
});

describe("createTryOnTool", function () {
  it("fetch ảnh khách + garment, gọi Space /try_on rồi upload kết quả lên S3", async function () {
    const mockFetch = stubFetch();
    spaceApp({ data: ["https://space.test/out.png"] });
    mockUpload.mockResolvedValue({ key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" });
    const tool = createTryOnTool();

    const result = await tool.execute(validInput(), executeOptions());

    expect(TRYON_SPACE).toBe("fashn-ai/fashn-vton-1.5");
    expect(mockConnect).toHaveBeenCalledWith("fashn-ai/fashn-vton-1.5");
    const calls = mockFetch.mock.calls.map(function (call) {
      return call[0];
    });
    expect(calls).toEqual([
      "https://assets.test/person.png",
      "https://assets.test/garment.png",
      "https://space.test/out.png",
    ]);
    expect(mockPredict).toHaveBeenCalledWith(
      "/try_on",
      expect.objectContaining({
        category: "tops",
        garment_photo_type: "model",
        num_timesteps: 50,
        guidance_scale: 1.5,
        segmentation_free: true,
      }),
    );
    const predictInput = mockPredict.mock.calls[0][1] as Record<string, unknown>;
    expect(predictInput.person_image).toBeInstanceOf(Blob);
    expect(predictInput.garment_image).toBeInstanceOf(Blob);
    expect(typeof predictInput.seed).toBe("number");
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" } });
  });

  it("Space trả về object có url thì vẫn đọc được kết quả", async function () {
    stubFetch();
    spaceApp({ data: [{ url: "https://space.test/out.png" }] });
    mockUpload.mockResolvedValue({ key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" });
    const tool = createTryOnTool();

    const result = await tool.execute(validInput(), executeOptions());

    expect(result).toEqual({ image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" } });
  });

  it("fetch ảnh khách thất bại thì báo lỗi đúng ngữ cảnh", async function () {
    stubFetch();
    const tool = createTryOnTool();

    await expect(
      tool.execute({ ...validInput(), personImageUrl: "https://assets.test/missing.png" }, executeOptions()),
    ).rejects.toThrow("Không tải được ảnh khách đính kèm");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("fetch ảnh sản phẩm thất bại thì báo lỗi đúng ngữ cảnh", async function () {
    stubFetch();
    const tool = createTryOnTool();

    await expect(
      tool.execute({ ...validInput(), garmentImageUrl: "https://assets.test/missing.png" }, executeOptions()),
    ).rejects.toThrow("Không tải được ảnh sản phẩm");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("Space lỗi hoặc trả dữ liệu lạ thì báo tạo ảnh thất bại", async function () {
    stubFetch();
    const tool = createTryOnTool();

    mockConnect.mockRejectedValue(new Error("space sleeping"));
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Tạo ảnh thử đồ thất bại",
    );

    spaceApp({ data: [] });
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Tạo ảnh thử đồ thất bại",
    );

    spaceApp({ data: [{ nope: true }] });
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Tạo ảnh thử đồ thất bại",
    );

    spaceApp({ data: "not-an-array" });
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Tạo ảnh thử đồ thất bại",
    );
  });

  it("fetch ảnh kết quả thất bại thì báo lỗi riêng", async function () {
    stubFetch();
    spaceApp({ data: ["https://space.test/missing.png"] });
    const tool = createTryOnTool();

    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Không tải được ảnh kết quả thử đồ",
    );
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
