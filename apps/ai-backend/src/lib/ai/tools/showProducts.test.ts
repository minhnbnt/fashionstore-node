import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { batchMock, detailMock } = vi.hoisted(function () {
  return { batchMock: vi.fn(), detailMock: vi.fn() };
});

vi.mock("../../../../generated/endpoints/products/products", function () {
  return { batchProductSummaries: batchMock, detail1: detailMock };
});

import { createShowProductsTool, showProductsInputSchema } from "./showProducts";

import type { ShowToolOutput } from "./showProducts";

const HEADERS = { headers: { authorization: "Bearer t-1" } };
const UUID_X = "00000000-0000-4000-8000-000000000001";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

function detailFixture(id: string, name: string) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(" ", "-"),
    shopId: "shop-1",
    images: [{ url: "https://img.test/" + id }],
    variants: [{ size: "M", price: 100000, stockQuantity: 2, compareAtPrice: null }],
    material: "Cotton",
  };
}

beforeEach(function () {
  vi.clearAllMocks();
});

describe("showProductsInputSchema", () => {
  it("chặn mảng rỗng và quá 8 id", function () {
    expect(showProductsInputSchema.safeParse({ productIds: [] }).success).toBe(false);
    expect(
      showProductsInputSchema.safeParse({
        productIds: Array.from({ length: 9 }, function (_, i) {
          return "p" + String(i);
        }),
      }).success,
    ).toBe(false);
    expect(showProductsInputSchema.safeParse({ productIds: ["p1"] }).success).toBe(true);
  });
});

describe("createShowProductsTool", () => {
  it("gọi API batch với ids kèm authorization header và trả items đúng thứ tự", async function () {
    const first = { id: "p1", name: "Áo polo", minPrice: 250000 };
    const second = { id: "p2", name: "Váy hoa", minPrice: 450000 };
    batchMock.mockResolvedValue({ status: 200, data: [first, second] });

    const tool = createShowProductsTool({ authorization: "Bearer t-1" });
    const output = await tool.execute?.({ productIds: ["p1", "p2"] }, executeOptions());

    expect(batchMock).toHaveBeenCalledWith({ ids: ["p1", "p2"] }, HEADERS);
    expect(output).toEqual({ items: [first, second] });
  });

  it("loại bỏ id trùng trước khi gọi API batch", async function () {
    const first = { id: "p1", name: "Áo polo", minPrice: 250000 };
    const second = { id: "p2", name: "Váy hoa", minPrice: 450000 };
    batchMock.mockResolvedValue({ status: 200, data: [first, second] });

    const tool = createShowProductsTool({ authorization: "Bearer t-1" });
    const output = await tool.execute?.({ productIds: ["p1", "p2", "p1", "p2"] }, executeOptions());

    expect(batchMock).toHaveBeenCalledWith({ ids: ["p1", "p2"] }, HEADERS);
    expect(output).toEqual({ items: [first, second] });
  });

  it("batch lỗi nhưng có slug thì fallback detail1 từng slug, gộp theo thứ tự input", async function () {
    const uuid = { id: UUID_X, name: "Áo X", minPrice: 100000 };
    batchMock.mockRejectedValueOnce(new Error("batch down"));
    batchMock.mockResolvedValueOnce({ status: 200, data: [uuid] });
    detailMock.mockImplementation(async function (slug: string) {
      if (slug === "slug-a") {
        return { status: 200, data: detailFixture("uuid-a", "Áo A") };
      }
      if (slug === "slug-b") {
        return { status: 200, data: detailFixture("uuid-b", "Áo B") };
      }
      throw new Error("not found");
    });

    const tool = createShowProductsTool({ authorization: "Bearer t-1" });
    const output = (await tool.execute?.(
      { productIds: [UUID_X, "slug-a", "slug-b"] },
      executeOptions(),
    )) as ShowToolOutput;

    expect(batchMock).toHaveBeenNthCalledWith(1, { ids: [UUID_X, "slug-a", "slug-b"] }, HEADERS);
    expect(batchMock).toHaveBeenNthCalledWith(2, { ids: [UUID_X] }, HEADERS);
    expect(detailMock).toHaveBeenCalledWith("slug-a", HEADERS);
    expect(detailMock).toHaveBeenCalledWith("slug-b", HEADERS);
    expect(
      output.items.map(function (item) {
        return item.name;
      }),
    ).toEqual(["Áo X", "Áo A", "Áo B"]);
  });

  it("batch lỗi và toàn id là UUID thì rethrow, không nuốt lỗi", async function () {
    batchMock.mockRejectedValue(new Error("batch down"));

    const tool = createShowProductsTool({ authorization: "Bearer t-1" });
    let caught: unknown = null;
    try {
      await tool.execute?.({ productIds: [UUID_X] }, executeOptions());
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("batch down");
    expect(detailMock).not.toHaveBeenCalled();
  });
});
