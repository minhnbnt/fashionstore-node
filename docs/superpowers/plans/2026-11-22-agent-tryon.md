# Agent Try-On Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port virtual try-on từ nhánh `feat/agent-tryon` (frontend, đã lỗi thời phần API key-based) sang ai-backend: tool `tryOn` gọi HF Space `fashn-ai/fashn-vton-1.5`, tool `showImage` hiện ảnh, `getProductDetail` expose `defaultImageUrl`/`garmentUrl`/`tryOnEnabled` (API mới trả URL, không trả key).

**Architecture:** 2 tool mới trong `createAgentTools` (không cần authorization — tryOn tự giữ S3 creds). tryOn: fetch person + garment blob → gradio predict → fetch kết quả → PUT thẳng S3 (creds riêng của ai-backend, không phụ thuộc JWT user). Kết quả lưu key `tryon/{uuid}.png`, URL public = `${ASSETS_URL}/${key}`.

**Tech Stack:** `@gradio/client` (Space client), `@aws-sdk/client-s3` (PUT), zod 4.6.7, ai SDK v7 tool.

**Spec:** `docs/superpowers/plans/2026-11-22-agent-tryon.md` (tài liệu này tự chứa thiết kế đã duyệt trong hội thoại).

## Global Constraints

- Không dùng ternary — dùng `if` / `&&` (quy ước repo).
- Gate mỗi commit: `pnpm --filter ai-backend check && pnpm --filter ai-backend test && pnpm --filter ai-backend build`.
- pnpm (không npm), podman (không docker), không HEALTHCHECK trong Dockerfile.
- Test style theo `readImage.test.ts`: `vite-plus/test`, `vi.stubGlobal("fetch", ...)`, helper `executeOptions()`/`plainOutput()`.
- Message lỗi tool tiếng Việt, thân thiện với khách (model trích nguyên câu này).
- Env mirror embed-worker: `S3_ENDPOINT_URL`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION`; thêm `ASSETS_URL`.

## Review Focus

- Space trả `data` shape lạ (array rỗng, object không `url`) → fail bằng message "Tạo ảnh thử đồ thất bại…" chứ không crash TypeError. Test pin ở Task 3.
- Fetch 404 phân biệt ngữ cảnh: ảnh khách ("Không tải được ảnh khách đính kèm…") vs ảnh sản phẩm ("Không tải được ảnh sản phẩm…"). Test pin ở Task 3.
- Upload S3 thất bại → throw, tool error flow về model, không treo. Test pin ở Task 1.
- Input URL không phải http(s) → schema chặn trước khi fetch. Test pin ở Task 2/3.

---

### Task 1: `s3.ts` — module upload S3

**Files:**
- Create: `apps/ai-backend/src/lib/storage/s3.ts`
- Test: `apps/ai-backend/src/lib/storage/s3.test.ts`

**Interfaces:**
- Produces: `uploadImage(buffer: Buffer, contentType: string): Promise<{ key: string; url: string }>` — key `tryon/{uuid}.png`, url `${ASSETS_URL}/${key}`. Đọc env `S3_ENDPOINT_URL` (default `http://localhost:9000`), `S3_BUCKET` (`fashionstore`), `S3_ACCESS_KEY` (`fashionstore`), `S3_SECRET_KEY` (`passwordpassword`), `S3_REGION` (`us-east-1`), `ASSETS_URL` (`http://fashionstore.web.localhost:3902`). `S3Client` với `forcePathStyle: true`.

- [ ] **Step 1: Write failing test** — vi.mock `@aws-sdk/client-s3` (S3Client + PutObjectCommand): assert `send` nhận Bucket/Key khớp `^tryon/[0-9a-f-]{36}\.png$` + ContentType; assert url = `${ASSETS_URL}/${key}`.
- [ ] **Step 2:** `pnpm --filter ai-backend test -- src/lib/storage/s3.test.ts` → FAIL (module chưa có).
- [ ] **Step 3: Implement** `uploadImage` — lười khởi tạo client (một lần, module-level), `crypto.randomUUID()` cho key.
- [ ] **Step 4:** test PASS.
- [ ] **Step 5:** Commit `feat(ai): module upload S3 cho kết quả thử đồ`.

### Task 2: `showImage.ts` — tool echo URL

**Files:**
- Create: `apps/ai-backend/src/lib/ai/tools/showImage.ts`
- Test: `apps/ai-backend/src/lib/ai/tools/showImage.test.ts`

**Interfaces:**
- Produces: `createShowImageTool()`, `showImageInputSchema` — input `{ url: http(s) URL }`, output `{ url: string }`. Copy nguyên nhánh gốc `feat/agent-tryon` (src/lib/ai/tools/showImage.ts ở frontend).

- [ ] **Step 1: Failing test** — schema chặn ftp://; execute echo đúng url.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — port y nguyên (đổi import `ai`/`zod` style node: double quotes).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ai): tool showImage hiện ảnh cho khách trong chat`.

### Task 3: `tryOn.ts` — tool tạo ảnh thử đồ

**Files:**
- Create: `apps/ai-backend/src/lib/ai/tools/tryOn.ts`
- Test: `apps/ai-backend/src/lib/ai/tools/tryOn.test.ts`

**Interfaces:**
- Consumes: `uploadImage` (Task 1).
- Produces: `createTryOnTool()`, `TRYON_SPACE = "fashn-ai/fashn-vton-1.5"`. Input: `personImageUrl` (http(s), từ context), `garmentImageUrl` (http(s), từ getProductDetail), `category` enum `tops|bottoms|one-pieces`, `garmentPhotoType` enum `model|flat-lay`. Output `TryOnToolOutput { image: { key, url } }`. gradio params: `num_timesteps: 50`, `guidance_scale: 1.5`, `segmentation_free: true`, `seed` random int 0..2^31. Dynamic import `@gradio/client`.

- [ ] **Step 1: Failing tests** — vi.mock `@gradio/client` (Client.connect → predict → `{ data: ["https://space.test/out.png"] }`), vi.mock storage `./../../storage/s3` (uploadImage → `{ key: "tryon/x.png", url: "https://assets.test/tryon/x.png" }`), `vi.stubGlobal("fetch")` trả 3 Response PNG (person, garment, kết quả). Cases: success flow (đúng thứ tự + output), person 404 → "Không tải được ảnh khách đính kèm", garment 404 → "Không tải được ảnh sản phẩm", predict throw → "Tạo ảnh thử đồ thất bại", extractResultUrl: string / `{url}` object / array rỗng → fail thân thiện.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — port `extractResultUrl` + flow từ nhánh gốc, thay presign bằng `uploadImage`, input key→URL, ternary→if.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ai): tool tryOn tạo ảnh thử đồ qua Space fashn và lưu S3`.

### Task 4: `getProductDetail` — expose ảnh cho try-on

**Files:**
- Modify: `apps/ai-backend/src/lib/ai/tools/getProductDetail.ts`
- Test: `apps/ai-backend/src/lib/ai/tools/getProductDetail.test.ts`

**Interfaces:**
- Produces: `AgentProductDetailOutput` thêm `defaultImageUrl?: string | null` (ảnh `sortOrder` nhỏ nhất từ `payload.images[].url`), `garmentUrl?: string | null`, `tryOnEnabled?: boolean`. Comment mapper đổi: giữ ảnh URL cho thử đồ, bỏ video/variant id.

- [ ] **Step 1: Failing tests** — 3 images sortOrder 2/0/1 → `defaultImageUrl` = url của sortOrder 0; images rỗng/thiếu → null; `garmentUrl` + `tryOnEnabled` pass-through (null khi không có).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — hàm `defaultImageUrl(images)` chọn min sortOrder, `if` không ternary.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ai): getProductDetail trả URL ảnh mặc định, garment và cờ thử đồ`.

### Task 5: `agent.ts` — đăng ký tools + system prompt

**Files:**
- Modify: `apps/ai-backend/src/lib/ai/agent.ts`
- Test: `apps/ai-backend/src/lib/ai/agent.test.ts` (mở rộng)

**Interfaces:**
- Consumes: `createTryOnTool`, `createShowImageTool` (Task 2/3).
- Produces: `createAgentTools` trả thêm `tryOn`, `showImage` (không nhận authorization). Prompt thêm 2 dòng: tryOn (personImageUrl từ getPageContext, garmentImageUrl từ getProductDetail, tryOnEnabled=false thì không hỗ trợ; tool chỉ tạo+lưu, khách không thấy) và showImage (hiện ảnh cho khách, không bịa link). Comment "Sáu tool" → "Tám tool".

- [ ] **Step 1: Failing tests** — tools có key `tryOn`/`showImage`; prompt chứa "tryOn" và "showImage".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement** — import + đăng ký + 2 dòng prompt.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ai): đăng ký tool thử đồ và hiện ảnh vào agent`.

### Task 6: deps + env + gate tổng + push

**Files:**
- Modify: `apps/ai-backend/package.json` (deps `@gradio/client`, `@aws-sdk/client-s3`)
- Modify: `apps/ai-backend/.env` (dev: 6 env mới) + `.env.example` nếu có

- [ ] **Step 1:** `pnpm add @aws-sdk/client-s3 @gradio/client --filter ai-backend`
- [ ] **Step 2:** Bổ sung env dev vào `.env` (giá trị mirror embed-worker + ASSETS_URL frontend).
- [ ] **Step 3:** Gate: `pnpm --filter ai-backend check && pnpm --filter ai-backend test && pnpm --filter ai-backend build` — 0 lỗi, toàn bộ test pass.
- [ ] **Step 4:** Push branch `feat/agent-tryon` (từ master) + mở PR.
