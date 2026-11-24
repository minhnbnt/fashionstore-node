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

import { createTryOnTool, DEFAULT_VTON_API_URL, tryOnInputSchema } from "./tryOn";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

function validInput() {
  return {
    personImageUrl: "https://assets.test/person.png",
    garmentImageUrl: "https://assets.test/garment.jpg",
    mode: "top" as const,
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

async function jpegResponse(): Promise<Response> {
  const jpeg = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#00ff00" },
  })
    .jpeg()
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  });
}

function stubFetch() {
  const mockFetch = vi.fn(function (url: unknown) {
    if (url === "https://assets.test/person.png" || url === "http://localhost:8001/file=out.png") {
      return Promise.resolve(pngResponse());
    }
    if (url === "https://assets.test/garment.jpg") {
      return Promise.resolve(jpegResponse());
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

afterEach(function () {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mockConnect.mockReset();
  mockPredict.mockReset();
  mockUpload.mockReset();
});

function vtonApp(predictResult: { data: unknown }) {
  mockConnect.mockResolvedValue({ predict: mockPredict });
  mockPredict.mockResolvedValue(predictResult);
}

describe("tryOnInputSchema", function () {
  it("nhận link http/https với các mode top, bottom, full và từ chối scheme hoặc mode không hợp lệ", function () {
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "http://fashionstore.web.localhost:3902/uploads/x.png",
        garmentImageUrl: "http://localhost:9000/fashionstore/garment.png",
        mode: "top",
      }).success,
    ).toBe(true);
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "https://assets.test/person.png",
        garmentImageUrl: "https://assets.test/garment.png",
        mode: "bottom",
      }).success,
    ).toBe(true);
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "https://assets.test/person.png",
        garmentImageUrl: "https://assets.test/garment.png",
        mode: "full",
      }).success,
    ).toBe(true);
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "ftp://assets.test/person.png",
        garmentImageUrl: "https://assets.test/garment.png",
        mode: "top",
      }).success,
    ).toBe(false);
    expect(
      tryOnInputSchema.safeParse({
        personImageUrl: "https://assets.test/person.png",
        garmentImageUrl: "https://assets.test/garment.png",
        mode: "tops",
      }).success,
    ).toBe(false);
  });
});

describe("createTryOnTool", function () {
  it("fetch ảnh khách + garment dạng File, gọi /process_images rồi upload kết quả lên S3", async function () {
    const mockFetch = stubFetch();
    vtonApp({
      data: [[{ image: { url: "http://localhost:8001/file=out.png" }, caption: null }]],
    });
    mockUpload.mockResolvedValue({
      key: "tryon/abc.png",
      url: "https://assets.test/tryon/abc.png",
    });
    const tool = createTryOnTool();

    const result = await tool.execute(validInput(), executeOptions());

    expect(DEFAULT_VTON_API_URL).toBe("http://localhost:8001");
    expect(mockConnect).toHaveBeenCalledWith("http://localhost:8001");
    const calls = mockFetch.mock.calls.map(function (call) {
      return call[0];
    });
    expect(calls).toEqual([
      "https://assets.test/person.png",
      "https://assets.test/garment.jpg",
      "http://localhost:8001/file=out.png",
    ]);
    expect(mockPredict).toHaveBeenCalledWith(
      "/process_images",
      expect.objectContaining({
        mode: "top",
      }),
    );
    const predictInput = mockPredict.mock.calls[0][1] as {
      images: unknown[];
      mode: string;
    };
    expect(predictInput.images).toHaveLength(2);
    const personFile = predictInput.images[0] as File;
    const garmentFile = predictInput.images[1] as File;
    expect(personFile).toBeInstanceOf(File);
    expect(personFile.name).toBe("person.png");
    expect(personFile.type).toBe("image/png");
    expect(garmentFile).toBeInstanceOf(File);
    expect(garmentFile.name).toBe("garment.jpg");
    expect(garmentFile.type).toBe("image/jpeg");
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" },
    });
  });

  it("dùng VTON_API_URL khi env được cấu hình và fallback mặc định khi rỗng", async function () {
    stubFetch();
    vtonApp({
      data: [[{ image: { url: "http://localhost:8001/file=out.png" }, caption: null }]],
    });
    mockUpload.mockResolvedValue({
      key: "tryon/abc.png",
      url: "https://assets.test/tryon/abc.png",
    });
    const tool = createTryOnTool();

    vi.stubEnv("VTON_API_URL", "http://vton.internal:8001");
    await tool.execute(validInput(), executeOptions());
    expect(mockConnect).toHaveBeenLastCalledWith("http://vton.internal:8001");

    vi.stubEnv("VTON_API_URL", "   ");
    await tool.execute(validInput(), executeOptions());
    expect(mockConnect).toHaveBeenLastCalledWith("http://localhost:8001");
  });

  it("hỗ trợ các định dạng Gallery và phẳng thay thế từ Gradio", async function () {
    stubFetch();
    mockUpload.mockResolvedValue({
      key: "tryon/abc.png",
      url: "https://assets.test/tryon/abc.png",
    });
    const tool = createTryOnTool();

    vtonApp({ data: [[{ url: "http://localhost:8001/file=out.png" }]] });
    expect(await tool.execute(validInput(), executeOptions())).toEqual({
      image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" },
    });

    vtonApp({ data: [["http://localhost:8001/file=out.png"]] });
    expect(await tool.execute(validInput(), executeOptions())).toEqual({
      image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" },
    });

    vtonApp({ data: [{ url: "http://localhost:8001/file=out.png" }] });
    expect(await tool.execute(validInput(), executeOptions())).toEqual({
      image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" },
    });

    vtonApp({ data: [{ image: { url: "http://localhost:8001/file=out.png" } }] });
    expect(await tool.execute(validInput(), executeOptions())).toEqual({
      image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" },
    });

    vtonApp({ data: ["http://localhost:8001/file=out.png"] });
    expect(await tool.execute(validInput(), executeOptions())).toEqual({
      image: { key: "tryon/abc.png", url: "https://assets.test/tryon/abc.png" },
    });
  });

  it("gán đúng đuôi file từ MIME type webp/gif và fallback png khi thiếu content-type", async function () {
    const mockFetch = vi.fn(function (url: unknown) {
      if (url === "https://assets.test/person.webp") {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/webp" },
          }),
        );
      }
      if (url === "https://assets.test/garment.gif") {
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/gif" },
          }),
        );
      }
      if (url === "https://assets.test/garment-notype") {
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      }
      if (url === "http://localhost:8001/file=out.png") {
        return Promise.resolve(pngResponse());
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    vi.stubGlobal("fetch", mockFetch);
    vtonApp({
      data: [[{ image: { url: "http://localhost:8001/file=out.png" }, caption: null }]],
    });
    mockUpload.mockResolvedValue({
      key: "tryon/abc.png",
      url: "https://assets.test/tryon/abc.png",
    });
    const tool = createTryOnTool();

    await tool.execute(
      {
        personImageUrl: "https://assets.test/person.webp",
        garmentImageUrl: "https://assets.test/garment.gif",
        mode: "full",
      },
      executeOptions(),
    );
    const firstImages = (mockPredict.mock.calls[0][1] as { images: File[] }).images;
    expect(firstImages[0].name).toBe("person.webp");
    expect(firstImages[0].type).toBe("image/webp");
    expect(firstImages[1].name).toBe("garment.gif");
    expect(firstImages[1].type).toBe("image/gif");

    await tool.execute(
      {
        personImageUrl: "https://assets.test/person.webp",
        garmentImageUrl: "https://assets.test/garment-notype",
        mode: "bottom",
      },
      executeOptions(),
    );
    const secondImages = (mockPredict.mock.calls[1][1] as { images: File[] }).images;
    expect(secondImages[1].name).toBe("garment.png");
    expect(secondImages[1].type).toBe("image/png");
  });

  it("fetch ảnh khách thất bại (404 hoặc lỗi mạng) thì báo lỗi đúng ngữ cảnh", async function () {
    stubFetch();
    const tool = createTryOnTool();

    await expect(
      tool.execute(
        { ...validInput(), personImageUrl: "https://assets.test/missing.png" },
        executeOptions(),
      ),
    ).rejects.toThrow("Không tải được ảnh khách đính kèm");
    expect(mockConnect).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Không tải được ảnh khách đính kèm",
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("fetch ảnh sản phẩm thất bại thì báo lỗi đúng ngữ cảnh", async function () {
    stubFetch();
    const tool = createTryOnTool();

    await expect(
      tool.execute(
        { ...validInput(), garmentImageUrl: "https://assets.test/missing.png" },
        executeOptions(),
      ),
    ).rejects.toThrow("Không tải được ảnh sản phẩm");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("Gradio lỗi hoặc trả dữ liệu lạ thì báo tạo ảnh thất bại", async function () {
    stubFetch();
    const tool = createTryOnTool();

    mockConnect.mockRejectedValue(new Error("connection refused"));
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Tạo ảnh thử đồ thất bại",
    );

    mockConnect.mockResolvedValue({ predict: mockPredict });
    mockPredict.mockRejectedValue(new Error("predict failed"));
    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Tạo ảnh thử đồ thất bại",
    );

    const malformedOutputs: unknown[] = [
      [],
      [[]],
      [[{ nope: true }]],
      [[{ image: {} }]],
      [[{ image: { url: "" } }]],
      "not-an-array",
    ];
    for (const data of malformedOutputs) {
      vtonApp({ data });
      await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
        "Tạo ảnh thử đồ thất bại",
      );
    }
  });

  it("fetch ảnh kết quả thất bại thì báo lỗi riêng", async function () {
    stubFetch();
    vtonApp({
      data: [[{ image: { url: "http://localhost:8001/file=missing.png" }, caption: null }]],
    });
    const tool = createTryOnTool();

    await expect(tool.execute(validInput(), executeOptions())).rejects.toThrow(
      "Không tải được ảnh kết quả thử đồ",
    );
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
