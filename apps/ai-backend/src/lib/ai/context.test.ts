import { describe, expect, it } from "vite-plus/test";

import { agentRequestContextSchema, EMPTY_FILTERS } from "./context";

describe("agentRequestContextSchema", function () {
  it("parse context đầy đủ 3 field", function () {
    const parsed = agentRequestContextSchema.safeParse({
      route: "/product/ao-polo",
      filters: { ...EMPTY_FILTERS, q: "áo polo", sort: "NEWEST" },
      productId: "slug-ao-polo",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.productId).toBe("slug-ao-polo");
      expect(parsed.data.filters.sort).toBe("NEWEST");
    }
  });

  it("từ chối context thiếu route hoặc filters sai shape", function () {
    expect(agentRequestContextSchema.safeParse({ filters: EMPTY_FILTERS }).success).toBe(false);
    expect(
      agentRequestContextSchema.safeParse({ route: "/search", filters: { q: 1 } }).success,
    ).toBe(false);
  });

  it("giữ lại ảnh đính kèm hợp lệ trong context", function () {
    const parsed = agentRequestContextSchema.safeParse({
      route: "/search",
      filters: EMPTY_FILTERS,
      image: { url: "https://assets.test/attached/abc.png", mediaType: "image/png" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.image).toEqual({
        url: "https://assets.test/attached/abc.png",
        mediaType: "image/png",
      });
    }
  });

  it("từ chối ảnh có url không hợp lệ", function () {
    const parsed = agentRequestContextSchema.safeParse({
      route: "/search",
      filters: EMPTY_FILTERS,
      image: { url: "not-a-url" },
    });
    expect(parsed.success).toBe(false);
  });
});
