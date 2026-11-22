import { SearchSort } from "../../../../generated/model/searchSort";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { searchMock } = vi.hoisted(function () {
  return { searchMock: vi.fn() };
});

vi.mock("../../../../generated/endpoints/search/search", function () {
  return { search: searchMock };
});

import {
  createSearchProductsTool,
  searchProductsInputSchema,
  toFilterPatch,
  toSearchParams,
} from "./searchProducts";

function executeOptions() {
  return { toolCallId: "tc-test", messages: [] } as never;
}

beforeEach(function () {
  vi.clearAllMocks();
});

describe("toFilterPatch", () => {
  it("chỉ giữ field có giá trị, bỏ limit và field rỗng", function () {
    const patch = toFilterPatch({
      q: "áo polo",
      minPrice: 100000,
      maxPrice: null,
      category: null,
      size: null,
      color: null,
      sort: null,
      limit: 8,
    });

    expect(patch).toEqual({ q: "áo polo", minPrice: 100000 });
  });

  it("bỏ sort không nằm trong SearchSort", function () {
    const patch = toFilterPatch({ sort: "RANDOM" as SearchSort });

    expect(patch.sort).toBeUndefined();
  });

  it("giữ sort hợp lệ", function () {
    const patch = toFilterPatch({ sort: SearchSort.PRICE_ASC });

    expect(patch).toEqual({ sort: SearchSort.PRICE_ASC });
  });
});

describe("toSearchParams", () => {
  it("mặc định limit 8, bỏ từ khóa rỗng", function () {
    const params = toSearchParams({ q: "", category: "ao-thun" });

    expect(params).toEqual({ category: "ao-thun", limit: 8 });
  });

  it("giữ limit model truyền vào và sort hợp lệ", function () {
    const params = toSearchParams({ q: "quần", limit: 5, sort: SearchSort.PRICE_ASC });

    expect(params).toEqual({ q: "quần", limit: 5, sort: SearchSort.PRICE_ASC });
  });

  it("bỏ các field null/undefined", function () {
    const params = toSearchParams({ q: "áo", minPrice: null, size: undefined });

    expect(params).toEqual({ q: "áo", limit: 8 });
  });
});

describe("searchProductsInputSchema", () => {
  it("nhận mọi giá trị SearchSort của generated enum", function () {
    for (const sort of Object.values(SearchSort)) {
      expect(searchProductsInputSchema.safeParse({ sort }).success).toBe(true);
    }
  });

  it("chặn sort lạ ngoài enum", function () {
    expect(searchProductsInputSchema.safeParse({ sort: "RANDOM" }).success).toBe(false);
  });
});

describe("createSearchProductsTool", () => {
  it("gọi API search kèm authorization header của requester và trả output gọn", async function () {
    searchMock.mockResolvedValue({
      status: 200,
      data: { items: [{ id: "p1", name: "Áo polo", minPrice: 250000 }], total: 1 },
    });

    const tool = createSearchProductsTool({ authorization: "Bearer t-1" });
    const output = await tool.execute?.({ q: "áo polo" }, executeOptions());

    expect(searchMock).toHaveBeenCalledWith(
      { q: "áo polo", limit: 8 },
      { headers: { authorization: "Bearer t-1" } },
    );
    expect(output).toEqual({
      total: 1,
      appliedParams: { q: "áo polo" },
      items: [{ id: "p1", name: "Áo polo", minPrice: 250000 }],
    });
  });

  it("áp dụng đủ bộ lọc model truyền vào", async function () {
    searchMock.mockResolvedValue({ status: 200, data: { items: [], total: 0 } });

    const tool = createSearchProductsTool({ authorization: "Bearer t-1" });
    await tool.execute?.(
      { category: "van-nu", maxPrice: 500000, size: "M", limit: 4 },
      executeOptions(),
    );

    expect(searchMock).toHaveBeenCalledWith(
      { category: "van-nu", maxPrice: 500000, size: "M", limit: 4 },
      { headers: { authorization: "Bearer t-1" } },
    );
  });
});
