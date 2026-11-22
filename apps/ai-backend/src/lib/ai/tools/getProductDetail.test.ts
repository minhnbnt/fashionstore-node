import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { detail1Mock } = vi.hoisted(function () {
  return { detail1Mock: vi.fn() };
});

vi.mock("../../../../generated/endpoints/products/products", function () {
  return { detail1: detail1Mock, batchProductSummaries: vi.fn() };
});

import { createGetProductDetailTool, toProductDetailOutput } from "./getProductDetail";

import type { ProductResponse } from "../../../../generated/model/productResponse";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

function productDetailFixture(): ProductResponse {
  return {
    id: "p-123",
    shopId: "shop-1",
    categoryId: "cat-1",
    name: "Áo Sơ Mi Lụa",
    slug: "ao-so-mi-lua",
    description: "Áo sơ mi lụa tay dài, form rộng.",
    status: "ACTIVE",
    variants: [
      {
        id: "v-1",
        sku: "ASM-001",
        size: "M",
        color: "Hồng",
        price: 450000,
        compareAtPrice: null,
        stockQuantity: 3,
        defaultVariant: true,
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    images: [{ url: "img-1" }],
    updatedAt: "2026-01-01T00:00:00Z",
    averageRating: 4.5,
    reviewCount: 12,
    videoUrl: null,
    garmentUrl: null,
    tryOnEnabled: false,
    material: "Lụa tơ tằm",
    origin: "Việt Nam",
    careInstructions: "Giặt tay, không phơi nắng gắt.",
    sizeGuide: null,
    weightGrams: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
  };
}

beforeEach(function () {
  vi.clearAllMocks();
});

describe("toProductDetailOutput", () => {
  it("rút gọn ProductResponse, giữ dữ liệu trả lời được khách", function () {
    expect(toProductDetailOutput(productDetailFixture())).toEqual({
      id: "p-123",
      name: "Áo Sơ Mi Lụa",
      slug: "ao-so-mi-lua",
      description: "Áo sơ mi lụa tay dài, form rộng.",
      status: "ACTIVE",
      material: "Lụa tơ tằm",
      origin: "Việt Nam",
      careInstructions: "Giặt tay, không phơi nắng gắt.",
      sizeGuide: null,
      averageRating: 4.5,
      reviewCount: 12,
      variants: [{ size: "M", color: "Hồng", price: 450000, stockQuantity: 3 }],
    });
  });

  it("bỏ field vô ích với model (ảnh, video, garment)", function () {
    const output = toProductDetailOutput({
      ...productDetailFixture(),
      images: [{ url: "img-1" }],
      videoUrl: "video-1",
      garmentUrl: "garment-1",
    });

    expect(JSON.stringify(output)).not.toContain("img-1");
    expect(JSON.stringify(output)).not.toContain("video-1");
    expect(JSON.stringify(output)).not.toContain("garment-1");
  });
});

describe("createGetProductDetailTool", () => {
  it("gọi API chi tiết với id kèm authorization header", async function () {
    detail1Mock.mockResolvedValue({ status: 200, data: productDetailFixture() });

    const tool = createGetProductDetailTool({ authorization: "Bearer t-1" });
    const output = await tool.execute?.({ productId: "p-123" }, executeOptions());

    expect(detail1Mock).toHaveBeenCalledWith("p-123", {
      headers: { authorization: "Bearer t-1" },
    });
    expect(output).toEqual(toProductDetailOutput(productDetailFixture()));
  });
});
