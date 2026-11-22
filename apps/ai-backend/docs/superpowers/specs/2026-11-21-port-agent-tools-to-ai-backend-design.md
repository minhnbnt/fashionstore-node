# Design — Port agent + 4 tool AI từ frontend sang ai-backend

- Ngày: 2026-11-21
- Phạm vi: repo `ai-backend` (chính) và repo `frontend` (cutover)
- Trạng thái: đã duyệt với người dùng qua hội thoại; chờ implement

## Ý định & lý do

Agent tìm kiếm sản phẩm ("trợ lý mua sắm" của shop nét) hiện chạy **ngay trong browser**:
`frontend/src/lib/ai/chatTransport.ts` gọi `streamText` thẳng endpoint OpenAI-compatible,
kéo theo bundle client chứa API key LLM, system prompt, zod schema, và toàn bộ logic 4 tool.
Mục tiêu của lần port này: **giấu logic của đống tool khỏi phía client** — chuyển toàn bộ
agent loop (prompt + tools + vòng lặp tool-call) sang `ai-backend`, frontend chỉ còn client
chat mỏng render tool-parts.

## Goals

- `POST /api/chat` trên ai-backend: nhận `UIMessage[]` (kèm metadata bộ lọc + sản phẩm đang
  xem như contract hiện tại), chạy agent, trả `UIMessageStream` về client.
- Port y nguyên logic 4 tool `searchProducts`, `listCategories`, `getProductDetail`,
  `showProducts` (schema, description, execute, mapper rút gọn output, fallback slug của
  showProducts).
- Mỗi tool nhận **Authorization header của user** và gắn vào **từng lệnh gọi** store API
  (orval generate sẵn tham số `options: RequestInit` cho việc này) — giữ nguyên authorization
  từng người, không dùng service token chung.
- Bundle frontend không còn: key LLM, prompt, schema zod, execute, mapper, fallback logic.
- UX không đổi: card sản phẩm, pill tra cứu, nút "Lọc trên trang" render như cũ từ
  tool-parts stream về; lịch sử chat localStorage (`agentHistory`) vẫn tương thích vì shape
  UIMessage giữ nguyên.

## Non-goals

- Không đổi store backend (Java) — không thêm endpoint mới, không đổi auth.
- Không lưu lịch sử chat ở server, không thêm message storage.
- Không đổi model/LLM, không đổi nội dung system prompt (port nguyên văn).
- Không làm rate-limit, log/đo lường, streaming resume/reconnect.

## Anti-goals (thất bại dù chạy được)

- Vẫn còn schema/description/prompt trong bundle client.
- Logic tool xuất hiện ở hai nơi (client + server) sau cutover.
- Tool gọi store API bằng token chung thay quyền từng user.

## Constraints

- Package manager: chỉ `pnpm`. Không ternary (`? :`) — dùng `if` + early return (quy tắc
  frontend; áp dụng cả code mới ở ai-backend cho nhất quán).
- ai-backend dùng tooling vite-plus (`vp`): thêm `"test": "vp test run"` giống frontend;
  conventional commits; pre-commit chạy `vp staged` (ai-backend) và `format/lint/build`
  (frontend).
- Version khớp frontend: `ai@^7.0.156`, `@ai-sdk/openai-compatible@^3.0.80`, `zod@^4.6.7`,
  `orval@^8.44.0`, TypeScript ~7.
- JWT GoTrue: middleware `express-oauth2-jwt-bearer` đã bảo vệ `/api/*`; trong handler
  header được xem như luôn hợp lệ (không check lại).
- Authorization header không được log.

## Các cách đã cân nhắc

1. **Dồn cả agent loop lên server (CHỌN)** — `streamText` + 4 tool chạy ở ai-backend, trả
   `UIMessageStream`. Duy nhất cách đạt mục tiêu giấu logic: prompt, schema, execute, key
   đều ở server; client chỉ render.
2. Giữ agent ở client, tool gọi RPC sang server — loại: prompt + schema + orchestration vẫn
   nằm trong bundle, không giấu được gì.
3. Tự viết SSE + tool-call loop thủ công trên server — loại: làm lại cái thư viện `ai` đã
   làm, rủi ro lệch protocol với `@ai-sdk/react` phía client, không có lợi gì bù.

## Các quyết định đã chốt (cùng người dùng)

- Stream trả về bằng **`pipeUIMessageStreamToResponse`** (Express dùng Node ServerResponse):
  `await pipeUIMessageStreamToResponse({ response: res, stream: toUIMessageStream({ stream:
  result.fullStream }) })` — pattern khuyên dùng trong docs AI SDK cho Express.
- **Mỗi tool nhận Authorization header theo từng call**: route trích
  `req.headers.authorization` (một dòng cast, comment chỉ về middleware), truyền vào
  `createAgentTools({ authorization })`; từng tool factory nhận `{ authorization }` và gắn
  `{ headers: { authorization } }` vào từng lệnh gọi generated client. Không dùng
  AsyncLocalStorage, không closure ẩn nào khác.
- Không check lại `authorization === undefined` trong handler — middleware `/api` đã chặn
  401 trước đó.
- Orval ở ai-backend: `client: 'fetch'` (không react-query — server không cần hooks),
  `httpClient: 'fetch'`, mode `tags-split`, input copy từ `frontend/docs/openapi.json`
  (nguồn gốc là `backend/docs/openapi.json`; frontend tải lại khi API đổi, ai-backend copy
  theo frontend). Mutator server-side chỉ còn: base URL từ `STORE_API_URL`, giữ envelope
  `{ data, status, headers }` mà `takeData` cần, map lỗi; **không đụng auth** (header do
  tool mang theo từng call).
- Agent loop giữ `stopWhen: stepCountIs(MAX_AGENT_STEPS)` với `MAX_AGENT_STEPS = 10`
  (port nguyên văn) và provider `createOpenAICompatible` đọc từ env.
- Abort khi client ngắt kết nối: `res.on('close')` → `AbortController` → `abortSignal`
  của `streamText`, tránh sinh token thừa.
- CORS: origin từ env `CORS_ORIGIN` (mặc định cho phép mọi origin ở dev).
- Frontend giữ lại **contract types** của tool I/O dưới dạng interface thuần
  (`{ input; output }`) — `ToolUIPart<TOOLS>` của AI SDK chấp nhận trực tiếp shape này
  (không cần `InferUITool`/zod), nên AgentTab render không đổi. Types bị xoá khi build,
  không vào bundle.
- Hard cutover: xoá hẳn client agent; không giữ fallback chạy-in-browser.

## Cấu trúc file dự kiến

ai-backend (repo `ai-backend`):

- `src/lib/api/apiFetch.ts` — mutator server-side (base URL `STORE_API_URL`, envelope, ApiError)
- `src/lib/ai/agent.ts` — `AgentProductContext`, `AgentMessageMetadata`, `AgentTools`
  (InferUITools), `MAX_AGENT_STEPS`, `buildSystemPrompt`, `filtersFromMessages`,
  `productFromMessages`, `createAgentTools({ authorization })`
- `src/lib/ai/tools/searchProducts.ts` | `listCategories.ts` | `getProductDetail.ts` |
  `showProducts.ts` — port y nguyên, mỗi tool nhận `{ authorization }`
- `src/lib/ai/chatRoute.ts` — `registerChatRoute(app)`: handler `POST /api/chat`
- `src/server.ts` — giữ middleware auth, gọi `registerChatRoute`
- `orval.config.ts`, `docs/openapi.json` (copy), `generated/` (codegen)
- env thêm: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `STORE_API_URL`, `CORS_ORIGIN`

frontend (repo `frontend`):

- `src/lib/ai/agent.ts` — chỉ còn types: `AgentProductContext`, `AgentMessageMetadata`,
  `AgentTools` (interface thuần `{ input; output }` cho 4 tool), `readAgentConfig()` đọc
  `VITE_AI_BACKEND_URL`
- `src/lib/ai/chatTransport.ts` — `createChatTransport({ backendUrl })`:
  `DefaultChatTransport` + custom `fetch` gắn Bearer từ `getAuthClient().getSession()`
- Xoá: `src/lib/ai/tools/` (4 file), `buildSystemPrompt`, `createAgentTools`,
  `filtersFromMessages`, `productFromMessages`, `MAX_AGENT_STEPS`, schema/mapper re-exports,
  `agent.test.ts` (chuyển sang backend)
- `AgentTab.tsx` — đổi chỗ lấy transport/config, phần render giữ nguyên
- env: xoá `VITE_AI_BASE_URL/API_KEY/MODEL`, thêm `VITE_AI_BACKEND_URL`

## Còn lại cho người implement

- Tên export cụ thể của mock model trong `ai/test` theo đúng version `ai@7` cài được
  (nếu không có, tự stub `LanguageModelV3` tối thiểu).
- Chi tiết lint/format của ai-backend (vite-plus) nếu lệch quy tắc frontend.
- Việc đồng bộ `openapi.json` về sau (hiện là copy tay; có thể script hoá sau — YAGNI).
