export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function customFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const baseUrl = process.env.STORE_API_URL;
  if (baseUrl === undefined || baseUrl === "") {
    throw new Error("Thiếu STORE_API_URL trong .env");
  }

  // Header Authorization do từng tool gắn qua options.headers — mutator không tự lấy token.
  const headers = new Headers(options?.headers);

  const response = await fetch(`${baseUrl}${url}`, { ...options, headers });
  if (response.ok === false) {
    let body: unknown = null;
    let errorDetail = "";
    try {
      body = await response.json();
      if (body !== null && typeof body === "object") {
        const record = body as Record<string, unknown>;
        if (typeof record.detail === "string" && record.detail.trim() !== "") {
          errorDetail = record.detail.trim();
        } else if (typeof record.message === "string" && record.message.trim() !== "") {
          errorDetail = record.message.trim();
        }
      }
    } catch {
      // Response không có body JSON (vd 401 từ security filter).
    }

    let errorMessage = `Request failed with status ${response.status}`;
    if (errorDetail !== "") {
      errorMessage = errorDetail;
    }
    throw new ApiError(response.status, errorMessage, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }

  // Orval sinh type dang { data, status, headers } nen phai tra ve dung hinh do.
  const contentType = response.headers.get("content-type") ?? "";
  let body: unknown = null;
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    body = await response.text();
  } else {
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
  }
  return { data: body, status: response.status, headers: response.headers } as T;
}
