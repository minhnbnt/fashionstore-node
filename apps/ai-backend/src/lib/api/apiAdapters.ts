import type { ProductResponse } from "../../../generated/model/productResponse";

export interface PriceInfo {
  minPrice: number | null;
  maxCompareAt: number | null;
  sizes: string[];
  colors: string[];
  totalStock: number;
}

/** Giá thấp nhất / khoảng so sánh / size màu / tồn kho — dùng cho card fallback slug. */
export function priceInfo(product: ProductResponse): PriceInfo {
  const variants = product.variants ?? [];
  let minPrice: number | null = null;
  let maxCompareAt: number | null = null;
  const sizes: string[] = [];
  const colors: string[] = [];
  let totalStock = 0;
  for (const v of variants) {
    if (v.price !== undefined && (minPrice === null || v.price < minPrice)) {
      minPrice = v.price;
    }
    if (v.compareAtPrice !== undefined && v.compareAtPrice !== null) {
      if (maxCompareAt === null || v.compareAtPrice > maxCompareAt) {
        maxCompareAt = v.compareAtPrice;
      }
    }
    if (v.size !== undefined && sizes.includes(v.size) === false) {
      sizes.push(v.size);
    }
    if (v.color !== undefined && colors.includes(v.color) === false) {
      colors.push(v.color);
    }
    totalStock += v.stockQuantity ?? 0;
  }
  return { minPrice, maxCompareAt, sizes, colors, totalStock };
}

/** Rút payload từ envelope `{ data, status, headers }` do orval/mutator trả về. */
export function takeData<U extends { data: unknown; status: number }>(
  response: U,
): Extract<U, { status: 200 | 201 }>["data"] {
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`Unexpected response status ${response.status}`);
  }
  return (response as Extract<U, { status: 200 | 201 }>)["data"];
}
