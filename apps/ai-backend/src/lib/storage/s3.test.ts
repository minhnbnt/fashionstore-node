import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { mockSend } = vi.hoisted(function () {
  return { mockSend: vi.fn() };
});

vi.mock("@aws-sdk/client-s3", function () {
  return {
    S3Client: vi.fn().mockImplementation(function () {
      return { send: mockSend };
    }),
    PutObjectCommand: class PutObjectCommand {
      input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.input = input;
      }
    },
  };
});

import { uploadImage } from "./s3";

afterEach(function () {
  mockSend.mockReset();
});

describe("uploadImage", function () {
  it("PUT buffer lên bucket với key tryon/{uuid}.png và trả url public", async function () {
    mockSend.mockResolvedValue({});
    const buffer = Buffer.from("fake-image-bytes");

    const result = await uploadImage(buffer, "image/png");

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input.Bucket).toBe("fashionstore");
    expect(command.input.ContentType).toBe("image/png");
    expect(command.input.Body).toBe(buffer);
    expect(typeof command.input.Key).toBe("string");
    expect(String(command.input.Key)).toMatch(/^tryon\/[0-9a-f-]{36}\.png$/);
    expect(result.key).toBe(command.input.Key);
    expect(result.url).toBe(`http://fashionstore.web.localhost:3902/${result.key}`);
  });

  it("mỗi lần upload tạo key riêng", async function () {
    mockSend.mockResolvedValue({});

    const first = await uploadImage(Buffer.from("a"), "image/png");
    const second = await uploadImage(Buffer.from("b"), "image/png");

    expect(first.key).not.toBe(second.key);
  });

  it("lỗi S3 propagates ra ngoài để tool báo khách", async function () {
    mockSend.mockRejectedValue(new Error("bucket denied"));

    await expect(uploadImage(Buffer.from("a"), "image/png")).rejects.toThrow("bucket denied");
  });
});
