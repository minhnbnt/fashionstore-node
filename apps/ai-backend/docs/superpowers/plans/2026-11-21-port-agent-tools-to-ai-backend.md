# Port Agent + Tools sang ai-backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển toàn bộ agent loop (prompt + 4 tool + vòng tool-call) từ browser sang `ai-backend`; frontend thành chat client mỏng render tool-parts.

**Architecture:** `POST /api/chat` nhận `UIMessage[]` + metadata → `streamText` (AI SDK v7, provider OpenAI-compatible) → mỗi tool gọi store API qua orval-generated client với Authorization header của user gắn vào **từng call** → trả stream bằng `pipeUIMessageStreamToResponse`. Frontend dùng `DefaultChatTransport` + custom fetch gắn Bearer từ session GoTrue.

**Tech Stack:** TypeScript ~7, Express 5, `ai@^7.0.156`, `@ai-sdk/openai-compatible@^3.0.80`, `zod@^4.6.7`, orval 8 (client fetch), pnpm, vite-plus (`vp test/lint/fmt`).

**Spec:** `docs/superpowers/specs/2026-11-21-port-agent-tools-to-ai-backend-design.md` (cùng repo ai-backend).

## Global Constraints

- Chỉ `pnpm`, cấm `npm`.
- Không ternary (`? :`): dùng `if` + early return; JSX dùng `&&`.
- `verbatimModuleSyntax: true` (ai-backend): type-only import phải `import type`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`). Không commit `dist/`, `.env`, `generated/` (ai-backend gitignore đã có `dist`; thêm `generated` vào .gitignore).
- ai-backend pre-commit: `vp staged`. Frontend pre-commit: `pnpm format && pnpm lint && pnpm build`, lint 0 error 0 warning.
- Version khớp frontend: `ai@^7.0.156`, `@ai-sdk/openai-compatible@^3.0.80`, `zod@^4.6.7`, `orval@^8.44.0`.
- Authorization header không log.
- Env backend mới: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `STORE_API_URL`, `CORS_ORIGIN`. Env frontend: xoá `VITE_AI_BASE_URL/API_KEY/MODEL`, thêm `VITE_AI_BACKEND_URL`.

## Review Focus

1. JWT hết hạn giữa phiên → tool call 401 từ store API: stream trả part `output-error`, UI hiện pill lỗi, không treo. Pin bởi test apiFetch throw `ApiError` + tool không nuốt lỗi (Task 1, 3, 4).
2. Model truyền slug thay UUID cho `showProducts` → fallback `detail1` theo slug vẫn trả items. Pin bởi test fallback (Task 4).
3. Tin nhắn cũ localStorage thiếu metadata → `buildSystemPrompt` dùng `EMPTY_FILTERS`, không crash. Pin bởi test metadata reader (Task 2).
4. Client disconnect giữa stream → abort LLM, không sinh token thừa. Pin bởi test abort (Task 5).
5. Authorization header theo từng request, không chéo user. Pin bởi test tools nhận đúng header của requester (Task 3, 4) + test transport gắn Bearer (Task 6).

---

### Task 0: ~~Monorepo TS — workspace + subtree merge frontend~~ — ĐÃ ROLLBACK

> **HỦY BỎ theo yêu cầu người dùng (2026-11-21).** Toàn bộ thử nghiệm monorepo đã được dời ra
> `/tmp/opencode/fashionstore-mono-rollback`; `fashionstore/` trả nguyên trạng, `ai-backend/`
> khôi phục tại chỗ với `.git` gốc. **Không thực hiện Task 0.** Tiếp tục thẳng Task 1–7
> theo mô hình hai repo riêng `frontend/` + `ai-backend/` như design doc.

**Files:**

- Create: root `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.githooks/pre-commit`, `scripts/sync-openapi.sh`, `docs/openapi.json`, `packages/agent-contract/{package.json,tsconfig.json,src/index.ts}`
- Modify: `compose.yml` (tách `OPENAI_TOKEN` ra `env/caddy.env` — secret đang hard-code), `frontend/orval.config.ts` (input → `../../docs/openapi.json`), xoá `frontend/pnpm-lock.yaml` + `ai-backend/pnpm-lock.yaml` + `ai-backend/pnpm-workspace.yaml` (lên root), xoá `ai-backend/.git` (unborn, không mất history)
- Không đụng: `backend/` (Java), `embed-worker/` (Python) — giữ repo riêng, gitignore

**Interfaces:**

- Produces: pnpm workspace gồm `frontend`, `ai-backend`, `packages/*`; catalog chung; package `@fashionstore/agent-contract` (rỗng, Task 6 đổ types); hook dispatcher root chạy `vp staged` đúng package có file staged.

- [ ] **Step 1:** `git init -b main` ở root; root `.gitignore`: `backend/`, `embed-worker/`, `env/`, `.agents/`, `.opencode/`, `.superpowers/`, `node_modules/`, `*.env` (root-level).
- [ ] **Step 2:** Sanitize `compose.yml`: `OPENAI_TOKEN` → `${OPENAI_TOKEN:-}` + `env_file: ./env/caddy.env` (tạo `env/caddy.env` giữ token — ignored).
- [ ] **Step 3:** Commit baseline root (compose.yml, mr-open-pairs.md, assets/, openspec/).
- [ ] **Step 4:** `mv frontend /tmp/opencode/frontend-origin` (backup nguyên repo) → `git subtree add --prefix=frontend /tmp/opencode/frontend-origin master` — merge commit mang theo toàn bộ lịch sử frontend.
- [ ] **Step 5:** `mv ai-backend/.git /tmp/opencode/ai-backend-git-backup` → track `ai-backend/` vào root repo.
- [ ] **Step 6:** Root `pnpm-workspace.yaml` (catalog gộp — thử vite-plus-core 8.3.8000 chung) + root `package.json` + xoá lockfile/workspace-file của từng package + `pnpm install` ở root.
- [ ] **Step 7:** ~~`docs/openapi.json` dùng chung + sync script~~ **RULING (user): bỏ sync openapi** — mỗi package giữ bản `openapi.json` riêng (`frontend/docs/openapi.json` nguyên trạng; ai-backend copy từ frontend ở Task 1). Codegen frontend chạy xanh từ bản copy gốc.
- [ ] **Step 8:** Tạo `packages/agent-contract` (khung, `export {}`), thêm vào workspace.
- [ ] **Step 9:** Verify: `pnpm --filter @fashionstore/frontend build` xanh + `pnpm --filter @fashionstore/ai-backend build` xanh + `pnpm --filter @fashionstore/ai-backend lint` 0 error + `git log --oneline frontend/package.json | head` còn thấy lịch sử. Vỡ vì version tooling → systematic-debugging, fallback per-package alias, ledger ruling.
- [ ] **Step 10:** `.githooks/pre-commit` dispatcher (vp staged theo package có file staged) + `git config core.hooksPath .githooks`; các commit cuối của task này tự chứng minh hook chạy.
- [ ] **Step 11:** Commit `chore: pnpm workspace monorepo (frontend + ai-backend + agent-contract)`.

### Task 1: Server API client — mutator + orval codegen

**Files:**

- Create: `src/lib/api/apiFetch.test.ts`, `src/lib/api/apiFetch.ts`, `orval.config.ts`, `docs/openapi.json` (copy từ `frontend/docs/openapi.json`)
- Modify: `package.json` (scripts + deps), `.gitignore` (thêm `generated`)

**Interfaces:**

- Produces: `customFetch<T>(url: string, options?: RequestInit): Promise<{ data: T; status: number; headers: Headers }>` — envelope giống frontend để `takeData` dùng chung shape; `ApiError(status, message, body)`.
- Produces: generated `search(params?, options?)`, `detail1(id, options?)`, `batchProductSummaries(params, options?)`, `listCategories(options?)` ở `generated/endpoints/…`, schema ở `generated/model/…`.

- [ ] **Step 1:** `pnpm add ai zod @ai-sdk/openai-compatible` + `pnpm add -D orval` (version theo Global Constraints); thêm scripts `"test": "vp test run"`, `"codegen": "orval"`, đổi `"build": "orval && tsc && vp pack"`.
- [ ] **Step 2: Write the failing test** `src/lib/api/apiFetch.test.ts` — mock `global.fetch`; case: (a) 200 trả envelope `{ data, status, headers }`; (b) lỗi trả body `{ detail: '...' }` → throw `ApiError` với message = detail; (c) base URL lấy từ `STORE_API_URL`; (d) 204 → `undefined`.
- [ ] **Step 3:** Run `pnpm test src/lib/api/apiFetch.test.ts` — Expected: FAIL (module chưa tồn tại).
- [ ] **Step 4:** Implement `src/lib/api/apiFetch.ts` — port từ `frontend/src/lib/api/apiFetch.ts` nhưng: base URL từ `process.env.STORE_API_URL`, bỏ `getAuthClient` (header do caller gắn qua `options.headers`), bỏ nhánh blob/binary (chỉ JSON/text — YAGNI).
- [ ] **Step 5:** Run lại test — Expected: PASS.
- [ ] **Step 6:** Copy `openapi.json`, tạo `orval.config.ts` (mode `tags-split`, `client: 'fetch'`, `httpClient: 'fetch'`, mutator `./src/lib/api/apiFetch.ts` name `customFetch`), chạy `pnpm codegen`, kiểm tra 4 hàm cần tồn tại trong `generated/`. Nếu `vp lint` phàn nàn `generated/`, thêm cấu hình exclude giống frontend.
- [ ] **Step 7:** Commit `feat: server API client (orval fetch + mutator)`.

### Task 2: Agent core — types, metadata readers, system prompt

**Files:**

- Create: `src/lib/ai/agent.test.ts`, `src/lib/ai/agent.ts`

**Interfaces:**

- Produces: `MAX_AGENT_STEPS = 10`, `AgentProductContext { id: string }`, `AgentMessageMetadata { filters: SearchFilters; product?: AgentProductContext }`, `buildSystemPrompt(filters, product?): string`, `filtersFromMessages(messages): SearchFilters`, `productFromMessages(messages): AgentProductContext | undefined` — port nguyên văn từ `frontend/src/lib/ai/agent.ts`; `SearchFilters` + `EMPTY_FILTERS` port từ `frontend/src/types/search.ts` + `frontend/src/lib/searchFilters.ts` (chỉ phần cần cho prompt).
- Consumes: không (task đầu của lib/ai).

- [ ] **Step 1: Write the failing test** — port các describe `buildSystemPrompt` (2 block), `productFromMessages`, `filtersFromMessages` từ `frontend/src/lib/ai/agent.test.ts`, giữ nguyên assertion.
- [ ] **Step 2:** `pnpm test src/lib/ai/agent.test.ts` — Expected: FAIL (agent.ts chưa tồn tại).
- [ ] **Step 3:** Implement `agent.ts` (chưa có `createAgentTools` — Task 4).
- [ ] **Step 4:** Run lại — Expected: PASS.
- [ ] **Step 5:** Commit `feat: agent core (system prompt, metadata readers)`.

### Task 3: Tool searchProducts + listCategories

**Files:**

- Create: `src/lib/ai/tools/searchProducts.test.ts`, `src/lib/ai/tools/searchProducts.ts`, `src/lib/ai/tools/listCategories.test.ts`, `src/lib/ai/tools/listCategories.ts`

**Interfaces:**

- Consumes: generated `search`, `listCategories` (Task 1); envelope `takeData` (thêm vào `apiFetch.ts` hoặc helper riêng `src/lib/api/apiAdapters.ts`).
- Produces: `searchProductsInputSchema`, `SearchToolInput`, `SearchToolOutput`, `toFilterPatch`, `toSearchParams`, `createSearchProductsTool(config: { authorization: string })`; `createListCategoriesTool(config: { authorization: string })` — schema/description/mapper port nguyên văn, khác duy nhất: execute gắn `{ headers: { authorization: config.authorization } }` vào từng lệnh gọi.

- [ ] **Step 1: Write the failing test** — port `toFilterPatch`, `toSearchParams`, `searchProductsInputSchema` từ frontend test; thêm case mới: `vi.mock` generated endpoints, execute tool, assert mock được gọi với `{ headers: { authorization: 'Bearer t-1' } }` (header theo từng call) và output đúng shape.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement 2 tool (port từ frontend, thêm `{ authorization }`).
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat: searchProducts + listCategories tools (per-call auth header)`.

### Task 4: Tool getProductDetail + showProducts + createAgentTools

**Files:**

- Create: `src/lib/ai/tools/getProductDetail.ts` (+test), `src/lib/ai/tools/showProducts.ts` (+test)
- Modify: `src/lib/ai/agent.ts` (thêm `createAgentTools`, `AgentTools` qua `InferUITools`)

**Interfaces:**

- Consumes: generated `detail1`, `batchProductSummaries` (Task 1).
- Produces: `toProductDetailOutput`, `AgentProductDetailOutput`, `createGetProductDetailTool({ authorization })`; `showProductsInputSchema`, `createShowProductsTool({ authorization })` với fallback slug nguyên văn; `createAgentTools({ authorization })` trả object 4 tool; `AgentTools = InferUITools<ReturnType<typeof createAgentTools>>`.

- [ ] **Step 1: Write the failing test** — port `toProductDetailOutput` tests; showProducts: case thường (UUID → batch), case batch ném lỗi + có slug → fallback gọi `detail1` từng slug, gộp theo thứ tự input, assert cả nhánh gắn authorization header.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement 2 tool + `createAgentTools` trong `agent.ts`.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat: getProductDetail + showProducts tools, agent tools aggregator`.

### Task 5: Route POST /api/chat — stream + env + CORS + abort

**Files:**

- Create: `src/lib/ai/chatRoute.test.ts`, `src/lib/ai/chatRoute.ts`
- Modify: `src/server.ts`, `.env.example`, `vite.config.ts` (nếu lint cần exclude test)

**Interfaces:**

- Consumes: `createAgentTools`, `buildSystemPrompt`, `filtersFromMessages`, `productFromMessages`, `MAX_AGENT_STEPS` (Task 2–4).
- Produces: `registerChatRoute(app: Express)` — handler: đọc `{ messages }` từ body (validate array + non-empty → 400), `const authorization = req.headers.authorization as string` (middleware bảo đảm), build prompt từ metadata tin nhắn user gần nhất, `streamText` + `stopWhen: stepCountIs(MAX_AGENT_STEPS)` + `abortSignal` từ `res.on('close')`, rồi `await pipeUIMessageStreamToResponse({ response: res, stream: toUIMessageStream({ stream: result.fullStream }) })`.

- [ ] **Step 1: Write the failing test** — app express mới **không gắn auth middleware**, `vi.mock` generated endpoints (assert authorization header), mock model qua `vi.mock('@ai-sdk/openai-compatible')` + model giả từ `ai/test` (nếu v7 export khác, tự stub — ledger ruling). Case (a): POST messages có metadata → response stream chứa part `tool-showProducts` `output-available` + text cuối; store API nhận header `Bearer t-1`. Case (b): body không có `messages` → 400. Case (c): client abort (destroy request) → `abortSignal.aborted === true` ở model mock.
- [ ] **Step 2:** Run — Expected: FAIL.
- [ ] **Step 3:** Implement `chatRoute.ts`; `server.ts` gọi `registerChatRoute(app)` sau middleware auth; CORS origin từ `CORS_ORIGIN`; `.env.example` thêm 5 biến mới.
- [ ] **Step 4:** Run — Expected: PASS.
- [ ] **Step 5:** Commit `feat: POST /api/chat agent endpoint (UIMessage stream, per-request auth)`.

### Task 6: Frontend cutover

**Files (repo `frontend`, branch riêng):**

- Modify: `src/lib/ai/agent.ts`, `src/lib/ai/chatTransport.ts`, `src/lib/ai/chatTransport.test.ts`, `src/components/chat/AgentTab.tsx` (+ các test mock `createAgentTransport`/`readAgentConfig`), `.env`, `.env.example`
- Delete: `src/lib/ai/tools/` (4 file), `src/lib/ai/agent.test.ts`

**Interfaces:**

- Consumes: endpoint `/api/chat` của ai-backend (Task 5).
- Produces: `agent.ts` chỉ còn types: `AgentProductContext`, `AgentMessageMetadata`, `AgentUIMessage`, `AgentTools` (interface thuần `{ input; output }` cho 4 tool — `ToolUIPart` chấp nhận trực tiếp, `AgentTab` không đổi cách narrow), `readAgentConfig(): { backendUrl: string } | null` đọc `VITE_AI_BACKEND_URL`; `chatTransport.ts` export `createChatTransport({ backendUrl }): ChatTransport<AgentUIMessage>` — `DefaultChatTransport` + custom `fetch` gắn `Authorization: Bearer <access_token>` từ `getAuthClient().getSession()`.

- [ ] **Step 1: Write the failing test** — `chatTransport.test.ts`: mock `getAuthClient` + `global.fetch`; `sendMessages` → assert fetch gọi đúng `${backendUrl}/api/chat` và header authorization đúng.
- [ ] **Step 2:** Run — Expected: FAIL (`createChatTransport` chưa tồn tại).
- [ ] **Step 3:** Implement `createChatTransport` + viết lại `agent.ts` (slim + hand-written I/O types) + sửa `AgentTab` (config/transport mới, render giữ nguyên) + xoá file đã port + cập nhật env.
- [ ] **Step 4:** Run `pnpm test` — Expected: PASS toàn bộ suite.
- [ ] **Step 5:** `pnpm format && pnpm lint && pnpm build` — Expected: 0 error, 0 warning, build xanh.
- [ ] **Step 6:** Commit `feat: cutover chat agent sang ai-backend` (+ `chore: xoá agent client-side`).

### Task 7: Verification hai repo

- [ ] ai-backend: `pnpm test` (toàn bộ), `pnpm lint` (0 error), `pnpm format:check`, `pnpm build` — tất cả xanh.
- [ ] frontend: `pnpm test`, `pnpm lint`, `pnpm build` — xanh.
- [ ] Smoke e2e thủ công (cần stack chạy: store backend + GoTrue + ai-backend + frontend): chat → searchProducts → card render → nút "Lọc trên trang" áp đúng bộ lọc. Ghi lại các bước vào final message (không chạy được trong môi trường này thì ghi rõ).
- [ ] Commit cuối `docs: ghi chú env + cách chạy` nếu có chỉnh.
