import { z } from "zod";

import type { SearchSort } from "../../../generated/model/searchSort";

/** Bộ lọc đang có hiệu lực trên trang tìm kiếm — cùng shape với contract frontend. */
export interface SearchFilters {
  q: string | null;
  category: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  size: string | null;
  color: string | null;
  sort: SearchSort | null;
  page: number;
}

export const EMPTY_FILTERS: SearchFilters = {
  q: null,
  category: null,
  minPrice: null,
  maxPrice: null,
  size: null,
  color: null,
  sort: null,
  page: 0,
};

export const searchFiltersSchema = z.object({
  q: z.string().nullable(),
  category: z.string().nullable(),
  minPrice: z.number().nullable(),
  maxPrice: z.number().nullable(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  sort: z.enum(["RELEVANCE", "NEWEST", "PRICE_ASC", "PRICE_DESC"]).nullable(),
  page: z.number(),
});

/** Context trang gửi tươi theo từng request, đã validate ở chatRoute. */
export const agentRequestContextSchema = z.object({
  route: z.string(),
  filters: searchFiltersSchema,
  productId: z.string().optional(),
});

export type AgentRequestContext = z.infer<typeof agentRequestContextSchema>;
