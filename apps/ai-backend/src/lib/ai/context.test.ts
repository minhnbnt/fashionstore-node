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
});
