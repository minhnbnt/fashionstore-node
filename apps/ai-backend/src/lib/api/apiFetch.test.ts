import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ApiError, customFetch } from "./apiFetch";

const BASE_URL = "https://store.test";

type Envelope = { data: unknown; status: number; headers: Headers };

function stubFetch(json: unknown, status: number, contentType = "application/json") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ "content-type": contentType }),
      json: () => Promise.resolve(json),
      text: () => Promise.resolve(String(json)),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.STORE_API_URL;
});

describe("customFetch", () => {
  it("goi response dang {data, status, headers} dung kieu orval sinh ra", async () => {
    process.env.STORE_API_URL = BASE_URL;
    stubFetch([{ id: "p1" }], 200);

    const res = await customFetch<Envelope>("/api/search/products?q=ao");

    expect(res.status).toBe(200);
    expect(res.data).toEqual([{ id: "p1" }]);
    expect(res.headers).toBeInstanceOf(Headers);
  });

  it("status loi thi nem ApiError giu status", async () => {
    process.env.STORE_API_URL = BASE_URL;
    stubFetch({ title: "Not found" }, 404);

    const caught = await customFetch<Envelope>("/api/products/x").then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
  });

  it("status loi co detail thi nem ApiError voi message la detail", async () => {
    process.env.STORE_API_URL = BASE_URL;
    stubFetch({ detail: "SKU already taken" }, 409);

    const caught = await customFetch<Envelope>("/api/shops/1/products").then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(409);
    expect((caught as ApiError).message).toBe("SKU already taken");
  });

  it("lay base url tu STORE_API_URL va giu lai headers tu options", async () => {
    process.env.STORE_API_URL = BASE_URL;
    stubFetch({ ok: true }, 200);
    const authorization = "Bearer t-1";

    await customFetch<Envelope>("/api/products", { headers: { authorization } });

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${BASE_URL}/api/products`);
    const options: RequestInit | undefined = calls[0][1];
    const sentHeaders = new Headers(options?.headers);
    expect(sentHeaders.get("authorization")).toBe(authorization);
  });

  it("khong co STORE_API_URL thi nem loi truoc khi goi fetch", async () => {
    delete process.env.STORE_API_URL;
    vi.stubGlobal("fetch", vi.fn());

    const caught = await customFetch<Envelope>("/api/x").then(
      () => null,
      (e: unknown) => e,
    );

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("STORE_API_URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("tra ve undefined khi response 204", async () => {
    process.env.STORE_API_URL = BASE_URL;
    stubFetch(null, 204);

    const res = await customFetch<Envelope>("/api/no-content");

    expect(res).toBeUndefined();
  });

  it("tra ve chuoi text khi endpoint tra ve text/csv", async () => {
    process.env.STORE_API_URL = BASE_URL;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/csv;charset=UTF-8" }),
        text: () => Promise.resolve("Ngày,Doanh thu\n2026-10-01,1000000"),
      }),
    );

    const res = await customFetch<Envelope>("/api/seller/stats/revenue/export");

    expect(res.status).toBe(200);
    expect(res.data).toBe("Ngày,Doanh thu\n2026-10-01,1000000");
  });
});
