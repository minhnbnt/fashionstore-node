# Context-as-Tools Chat Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay context đóng băng trong message metadata bằng context tươi gửi theo request, do agent kéo vào qua tool `getPageContext`.

**Architecture:** Client gửi `{ messages, context }` qua `prepareSendMessagesRequest` của `DefaultChatTransport`. Server validate bằng zod rồi truyền context vào `createAgentTools`; system prompt chuyển thành tĩnh. Tool `getPageContext` trả context của request hiện tại, output đi vào working memory của agent như tool result thường.

**Tech Stack:** Express 5, `ai@7.0.156`, `@ai-sdk/react@4.0.160`, `zod@4.6.7`, Vite/React 19, pnpm, vite-plus test.

**Spec:** `docs/superpowers/specs/2026-11-22-context-as-tools-protocol-design.md` (trong `ai-backend/`). Plan này phủ cả hai repo `ai-backend/` và `frontend/`.

## Global Constraints

- Package manager: pnpm. Không dùng npm.
- Frontend: không ternary (`? :`), dùng `if` + early return; trong JSX dùng `&&`.
- Frontend trước khi xong: `pnpm format`, `pnpm lint` (0 error, 0 warning), `pnpm build`.
- Không đụng `agentHistory`: `metadata` ở DB là JSON `parts`, không phải agent metadata.
- Không đổi I/O của 4 tool cũ. Không đổi model/provider. Không render UI cho `getPageContext`.
- Context sai → 400. Không fallback im lặng.

## Review Focus

- Khách chuyển trang sau khi gửi → request sau phải mang context mới; context cũ không được còn trong history. Test: `chatRoute` gửi hai request có `productId` khác nhau, assert tool output khác nhau.
- Client gửi thiếu `context` / sai shape → 400 thay vì 500 hoặc context rỗng. Test: `chatRoute` POST không có `context`.
- `filters` gửi từ `/search` có sort enum → validate đúng, không bị drop. Test: `context.ts` schema parse filters đầy đủ.
- `getPageContext` được gọi giữa stream → output chứa đúng context, không đọc từ message. Test: tool `execute` trả config.context.
- `getContext()` trong transport đọc ref → lấy state mới nhất dù transport được tạo từ lần render đầu. Test: `chatTransport` đổi giá trị ref rồi gửi, assert body theo giá trị mới.

---

### Task 1: Context type + zod schema (`ai-backend/src/lib/ai/context.ts`)

**Files:**

- Create: `ai-backend/src/lib/ai/context.ts`
- Test: `ai-backend/src/lib/ai/context.test.ts`

**Interfaces:**

- Produces: `SearchFilters`, `EMPTY_FILTERS`, `searchFiltersSchema`, `agentRequestContextSchema`, `AgentRequestContext` (`{ route: string; filters: SearchFilters; productId?: string }`).

- [ ] **Step 1: Viết test failing cho schema**

```ts
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
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd ai-backend && pnpm test -- context.test.ts`
Expected: FAIL — module `./context` không tồn tại.

- [ ] **Step 3: Implement `context.ts`**

Định nghĩa `searchFiltersSchema` = `z.object` với `q/category/size/color` là `z.string().nullable()`, `minPrice/maxPrice` là `z.number().nullable()`, `sort` là `z.enum(["RELEVANCE", "NEWEST", "PRICE_ASC", "PRICE_DESC"]).nullable()`, `page` là `z.number()`. `EMPTY_FILTERS` giữ nguyên giá trị hiện tại trong `agent.ts`. `agentRequestContextSchema` = `z.object({ route: z.string(), filters: searchFiltersSchema, productId: z.string().optional() })`. `AgentRequestContext` = `z.infer<typeof agentRequestContextSchema>`. `SearchFilters` giữ nguyên shape interface hiện tại, `sort` dùng `import type { SearchSort } from "../../../generated/model/searchSort"` (path từ `src/lib/ai/`).

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd ai-backend && pnpm test -- context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ai-backend && git add src/lib/ai/context.ts src/lib/ai/context.test.ts && git commit -m "feat(ai): add request context schema"
```

---

### Task 2: Tool `getPageContext`

**Files:**

- Create: `ai-backend/src/lib/ai/tools/getPageContext.ts`
- Test: `ai-backend/src/lib/ai/tools/getPageContext.test.ts`

**Interfaces:**

- Consumes: `AgentRequestContext` từ `../context` (Task 1).
- Produces: `createGetPageContextTool(config: { context: AgentRequestContext })` — tool AI SDK, input `{}`, output `AgentRequestContext`.

- [ ] **Step 1: Viết test failing**

```ts
import { describe, expect, it } from "vite-plus/test";
import { EMPTY_FILTERS } from "../context";
import { createGetPageContextTool } from "./getPageContext";

describe("createGetPageContextTool", function () {
  it("trả nguyên context của request hiện tại", async function () {
    const context = {
      route: "/search",
      filters: { ...EMPTY_FILTERS, q: "áo" },
      productId: undefined,
    };
    const tool = createGetPageContextTool({ context });
    const result = await tool.execute!({}, {} as never);
    expect(result).toEqual(context);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd ai-backend && pnpm test -- getPageContext.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Implement tool**

Theo pattern của `src/lib/ai/tools/listCategories.ts`: `tool({ description, inputSchema: z.object({}), execute: async () => Promise<AgentRequestContext> })`. Description bằng tiếng Việt, nói rõ tool trả trang hiện tại / bộ lọc / sản phẩm đang xem và phải gọi trước khi dùng `searchProducts` hay `getProductDetail`. `execute` trả shallow copy: `{ route: config.context.route, filters: { ...config.context.filters }, ...(config.context.productId !== undefined ? { productId: config.context.productId } : {}) }`. Dùng `import type` cho `AgentRequestContext` để tránh runtime cycle.

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd ai-backend && pnpm test -- getPageContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ai-backend && git add src/lib/ai/tools/getPageContext.ts src/lib/ai/tools/getPageContext.test.ts && git commit -m "feat(ai): add getPageContext tool"
```

---

### Task 3: `agent.ts` — bỏ snapshot, system prompt tĩnh, đăng ký tool mới

**Files:**

- Modify: `ai-backend/src/lib/ai/agent.ts`
- Test: `ai-backend/src/lib/ai/agent.test.ts`

**Interfaces:**

- Consumes: `AgentRequestContext` + `EMPTY_FILTERS` từ `./context` (Task 1), `createGetPageContextTool` (Task 2).
- Produces: `AgentUIMessage` (không còn metadata), `buildSystemPrompt(): string`, `createAgentTools({ authorization, context })`, `AgentTools` (giờ có thêm `getPageContext`), re-export `EMPTY_FILTERS` / `SearchFilters` / `AgentRequestContext` từ `./context`.

- [ ] **Step 1: Thay test cũ bằng test mới**

Xóa 2 describe `productFromMessages` và `filtersFromMessages` trong `agent.test.ts`. Thay bằng:

```ts
describe("buildSystemPrompt", function () {
  it("là prompt tĩnh, không chứa context của request", function () {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("getPageContext");
    expect(prompt).not.toContain("Bộ lọc khách đang đặt");
    expect(prompt).not.toContain("Khách đang xem trang chi tiết");
  });
});

describe("createAgentTools", function () {
  it("đăng ký đủ 5 tool", function () {
    const tools = createAgentTools({
      authorization: "Bearer t-1",
      context: { route: "/search", filters: EMPTY_FILTERS },
    });
    expect(Object.keys(tools).sort()).toEqual([
      "getPageContext",
      "getProductDetail",
      "listCategories",
      "searchProducts",
      "showProducts",
    ]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd ai-backend && pnpm test -- agent.test.ts`
Expected: FAIL — `buildSystemPrompt` vẫn nhận tham số, `filtersFromMessages` còn được import.

- [ ] **Step 3: Implement `agent.ts`**

Xóa `AgentProductContext`, `AgentMessageMetadata`, `filtersFromMessages`, `productFromMessages`. Import/re-export type từ `./context`. `AgentUIMessage = UIMessage<unknown, UIDataTypes, AgentTools>`. `buildSystemPrompt()` không tham số: giữ nguyên các dòng cũ trừ khối "Bộ lọc khách đang đặt" và khối "Khách đang xem trang chi tiết"; thêm dòng: `"Khi cần biết khách đang ở trang nào, bộ lọc nào, hoặc sản phẩm nào, gọi tool getPageContext. Không được giả định các giá trị này từ lịch sử hội thoại."`. `createAgentTools(config: { authorization: string; context: AgentRequestContext })` thêm `getPageContext: createGetPageContextTool({ context: config.context })`. Cập nhật description của `getProductDetail` nếu cần để nhắc lấy id từ `getPageContext` (không bắt buộc).

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd ai-backend && pnpm test -- agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Chạy full test backend**

Run: `cd ai-backend && pnpm test`
Expected: FAIL ở `chatRoute.test.ts` (chưa gửi `context`) — đây là task sau, không sửa ở đây.

- [ ] **Step 6: Commit**

```bash
cd ai-backend && git add src/lib/ai/agent.ts src/lib/ai/agent.test.ts && git commit -m "refactor(ai): make system prompt static and register context tool"
```

---

### Task 4: `chatRoute.ts` — nhận + validate `context`

**Files:**

- Modify: `ai-backend/src/lib/ai/chatRoute.ts`
- Test: `ai-backend/src/lib/ai/chatRoute.test.ts`

**Interfaces:**

- Consumes: `agentRequestContextSchema` từ `./context`, `buildSystemPrompt()` / `createAgentTools` từ `./agent` (Task 3).
- Produces: `POST /api/chat` body `{ messages, context }`, 400 khi context sai.

- [ ] **Step 1: Cập nhật test**

Trong `chatRoute.test.ts`: bỏ `metadata` khỏi `messagesFixture()`; thêm helper `contextFixture()` trả `{ route: "/search", filters: { ...EMPTY_FILTERS, q: "áo polo" } }`. Mọi POST trong file đều gửi `context: contextFixture()`. Thay test `"metadata.product ... đi vào system prompt"` bằng hai test:

```ts
it("getPageContext trả context của request, không đọc từ message", async function () {
  // model trả tool-call getPageContext ở lượt đầu, text ở lượt sau
  // assert body wire chứa "getPageContext", "slug-ao-polo" và systemText KHÔNG chứa "slug-ao-polo"
});

it("body thiếu context thì trả 400", async function () {
  // POST { messages: messagesFixture() } → expect 400
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd ai-backend && pnpm test -- chatRoute.test.ts`
Expected: FAIL — route chưa parse `context`, tool `getPageContext` chưa có.

- [ ] **Step 3: Implement route**

Đọc `body.context` từ `req.body` giống cách đọc `body.messages`. `const parsed = agentRequestContextSchema.safeParse(bodyContext); if (!parsed.success) { res.status(400).json({ error: "context must be a valid AgentRequestContext" }); return; }`. Truyền `system: buildSystemPrompt()` và `tools: createAgentTools({ authorization, context: parsed.data })`. Giữ nguyên abort handling và `pipeUIMessageStreamToResponse`.

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd ai-backend && pnpm test -- chatRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Chạy full backend + typecheck**

Run: `cd ai-backend && pnpm test && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ai-backend && git add src/lib/ai/chatRoute.ts src/lib/ai/chatRoute.test.ts docs/superpowers/specs/2026-11-22-context-as-tools-protocol-design.md docs/superpowers/plans/2026-11-22-context-as-tools-protocol.md && git commit -m "feat(ai): send request-scoped context to chat route"
```

---

### Task 5: Frontend — type + transport gửi context

**Files:**

- Modify: `frontend/src/lib/ai/agent.ts`
- Modify: `frontend/src/lib/ai/chatTransport.ts`
- Test: `frontend/src/lib/ai/chatTransport.test.ts`

**Interfaces:**

- Consumes: `SearchFilters` từ `@/types/search` (đã có).
- Produces: `AgentContext = { route: string; filters: SearchFilters; productId?: string }`; `AgentTools.getPageContext`; `createChatTransport({ backendUrl, getContext: () => AgentContext })`.

- [ ] **Step 1: Cập nhật test transport**

Trong `chatTransport.test.ts`: thêm helper `context = { route: "/search", filters: {...}, productId: undefined }`; gọi `createChatTransport({ backendUrl: 'https://ai.test', getContext: () => context })`. Thêm test:

```ts
it("gửi context mới nhất trong body cùng messages", async function () {
  // fetchMock, getContext trả route '/product/ao-polo'
  await transport.sendMessages(sendOptions() as never);
  const call = fetchMock.mock.calls[0];
  const body = JSON.parse(String(call[1]?.body));
  expect(body.context.route).toBe("/product/ao-polo");
  expect(body.messages).toHaveLength(1);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd frontend && pnpm test -- chatTransport.test.ts`
Expected: FAIL — `createChatTransport` chưa nhận `getContext`.

- [ ] **Step 3: Implement types**

Trong `frontend/src/lib/ai/agent.ts`: xóa `AgentProductContext`, `AgentMessageMetadata`; thêm `AgentContext` như Interfaces; thêm entry `getPageContext: { input: Record<string, never>; output: AgentContext }` vào `AgentTools`; đổi `AgentUIMessage = UIMessage<unknown, UIDataTypes, AgentTools>`.

- [ ] **Step 4: Implement transport**

`createChatTransport({ backendUrl, getContext })`: giữ nguyên `fetch` auth wrapper; thêm `prepareSendMessagesRequest: ({ messages }) => ({ body: { messages, context: getContext() } })`. Không ternary — không cần ở đây.

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd frontend && pnpm test -- chatTransport.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/lib/ai/agent.ts src/lib/ai/chatTransport.ts src/lib/ai/chatTransport.test.ts && git commit -m "feat(ui): send fresh context from chat transport"
```

---

### Task 6: `AgentTab` — contextRef, bỏ metadata, verification

**Files:**

- Modify: `frontend/src/components/chat/AgentTab.tsx`
- Test: `frontend/src/components/chat/AgentTab.test.tsx` (chỉ nếu test cũ giả định metadata)

**Interfaces:**

- Consumes: `AgentContext` + `createChatTransport` (Task 5).
- Produces: `contextRef` cập nhật theo `location`; `chat.sendMessage({ text })` không còn metadata.

- [ ] **Step 1: Cập nhật test nếu có**

Chỉ sửa các test assert `sendMessage` có `metadata` (hiện tại không có — kiểm tra lại bằng grep). Nếu có, bỏ assert đó.

- [ ] **Step 2: Implement AgentTab**

Import `AgentContext` thay `AgentMessageMetadata`. Tính `context` bằng `useMemo` từ `filters` + `location.pathname` + `productIdFromLocation(location.pathname)` (dùng `if` + early return, không ternary). Tạo `contextRef = useRef(context)` và gán `contextRef.current = context` ngay trong render. Tạo `getContext = useCallback(() => contextRef.current, [])`. Truyền `getContext` vào `createChatTransport`, cập nhật deps của `useMemo` transport. Trong `submitPromptText`: bỏ khối tạo `metadata`, gọi `void chat.sendMessage({ text })`. Giữ nguyên `filters` useMemo vì nút "Lọc trên trang" dùng.

- [ ] **Step 3: Chạy test frontend**

Run: `cd frontend && pnpm test`
Expected: PASS.

- [ ] **Step 4: Format + lint + build**

Run: `cd frontend && pnpm format && pnpm lint && pnpm build`
Expected: PASS (0 error, 0 warning).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/components/chat/AgentTab.tsx && git commit -m "refactor(ui): read context from current location on every send"
```
