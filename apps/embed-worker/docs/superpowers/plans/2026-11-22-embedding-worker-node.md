# Embedding Worker Node.js (PoC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port worker Python sang Node.js, giữ nguyên hành vi pgmq → S3 → Fashion-CLIP 512-dim → `product_embedding` và gRPC `EmbedImage` cho backend Java.

**Architecture:** Repo riêng `embed-worker-node` cạnh repo Python, dùng vite-plus/pnpm theo mẫu `ai-backend`. Lớp service thuần với interface + fake; hạ tầng (pg, S3, sharp, ONNX, grpc-js) nằm ở `infrastructure/`; `container.ts` là composition root; proto copy từ canonical và test hash.

**Tech Stack:** Node 26, pnpm 12.22, TypeScript 7, vite-plus 1.7.0, vitest, `pg`, `@aws-sdk/client-s3`, `sharp`, `@huggingface/transformers` 4.x (ONNX fp32), `@grpc/grpc-js` + `@grpc/proto-loader`, `zod`.

**Spec:** `docs/superpowers/specs/2026-11-22-embedding-worker-node-design.md`

## Global Constraints

- Không sửa proto canonical `../embed-worker/proto/fashion_clip/v1/embedding.proto` và không sửa Java backend.
- Env mặc định giữ nguyên tên/giá trị của worker Python (`DATABASE_URL`, `S3_*`, `MODEL_ID`, `MODEL_REVISION`, `HF_HOME`, `LOCAL_FILES_ONLY`, `QUEUE_NAME`, `EMBED_BATCH_SIZE`, `MAX_ATTEMPTS`, `VISIBILITY_TIMEOUT_S`, `POLL_MAX_SECONDS`, `POLL_INTERVAL_MS`, `GRPC_PORT`, `GRPC_MAX_CONCURRENCY`, `GRPC_MAX_IMAGE_BYTES`).
- Model: `ff13/fashion-clip` revision pinned, `vision_model.onnx`, `dtype: 'fp32'`, `device: 'cpu'`, `intraOpNumThreads: 4`, `interOpNumThreads: 1`. Không dùng quantized.
- Vector 512 chiều, L2-normalize; `MODEL_NAME = "fashion-clip-vit-b32"`.
- Parity: model (cùng pixel_values) cosine ≥ 0.99999; end-to-end cosine ≥ 0.9975 (đã đo min 0.99798; decoder JPEG pure-JS khác Pillow — xem spec §9). Không hạ ngưỡng ngầm.
- Queue `embed_jobs`; payload `{product_image_id, product_id, upload_id, s3_key}`; archive table là DLQ; tối đa 3 lần giao (`read_ct < 3` để lại message).
- Guard stale `upload_id`: không ghi vector nếu ảnh đã bị thay; ảnh bị xoá → archive.
- Message size gRPC 8MB cả hai chiều; bind `127.0.0.1`; trả `SERVING` trên health service.
- Exception/message tiếng Anh; comment tiếng Việt. Không dùng `process.exit`.
- `msg_id` bigint là `string` trong mọi interface (mặc định `pg` trả int8 dạng string).
- PoC: không Dockerfile/compose/migration/cắt production.

## Review Focus

- **Parity model sai** → Task 4 có test cố định `pixel_values`, cosine ≥ 0.99999; đây là gate go/no-go.
- **Preprocessing drift vượt ngưỡng đã đo** → Task 4 end-to-end test 16 ảnh, cosine ≥ 0.9975; nếu thấp hơn thì dừng, không được hạ ngưỡng ngầm.
- **Stale `upload_id` bị ghi đè vector cũ** → Task 5 test `stale job archived, no upsert, no model call`.
- **Bigint `msg_id` mất precision** → Task 3 test row có `msg_id` dạng string lớn (`"9007199254740993"`), assert archive gửi đúng string.
- **Payload pgmq hỏng chặn cả batch** → Task 3 test message thiếu `s3_key` bị archive riêng, message hợp lệ vẫn trả về.
- **gRPC trả sai status cho backend Java** → Task 6 test in-process map `INVALID_ARGUMENT` / `RESOURCE_EXHAUSTED` / `INTERNAL` và dim ≠ 512.
- **Shutdown làm rớt in-flight batch / server不 dừng** → Task 7 test dừng poll trước, graceful shutdown server, đóng pool.

---

### Task 1: Scaffold vite-plus, config, proto sync

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts`, `.gitignore`, `.env.example`
- Create: `scripts/sync-proto.mjs`
- Create: `src/config.ts`, `src/config.test.ts`
- Create: `src/grpc/proto/fashion_clip/v1/embedding.proto`, `src/grpc/proto/grpc/health/v1/health.proto`
- Create: `src/grpc/proto-sync.test.ts`

**Interfaces:**

- Consumes: `../embed-worker/proto/fashion_clip/v1/embedding.proto` (canonical, read-only), `ai-backend/package.json`, `ai-backend/vite.config.ts`, `ai-backend/tsconfig.json`, `ai-backend/pnpm-workspace.yaml`.
- Produces: `loadSettings(env?: NodeJS.ProcessEnv): Settings`; `Settings` fields: `databaseUrl`, `s3EndpointUrl`, `s3Bucket`, `s3AccessKey`, `s3SecretKey`, `s3Region`, `modelId`, `modelRevision`, `modelCacheDir`, `localFilesOnly`, `queueName`, `embedBatchSize`, `maxAttempts`, `visibilityTimeoutS`, `pollMaxSeconds`, `pollIntervalMs`, `grpcPort`, `grpcMaxConcurrency`, `grpcMaxImageBytes`. Script `pnpm proto:sync`. Script `pnpm test` = `vp test run`, `pnpm check` = `vp check`, `pnpm build` = `vp pack`.

- [ ] **Step 1: Copy scaffold từ ai-backend rồi chỉnh tên/entry**

Copy `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vite.config.ts` từ `../ai-backend`. Đổi `"name"` thành `"embed-worker-node"`, thêm script `"proto:sync": "node scripts/sync-proto.mjs"`, giữ nguyên catalog vite/vite-plus và lint rules. Trong `vite.config.ts` đổi `pack.entry` thành `["src/main.ts"]`. Thêm dependencies: `@aws-sdk/client-s3`, `@grpc/grpc-js`, `@grpc/proto-loader`, `@huggingface/transformers`, `pg`, `sharp`, `zod`. Chạy `pnpm install`.

- [ ] **Step 2: Viết test config 먼저**

`src/config.test.ts`: gọi `loadSettings({})` assert các default: `databaseUrl === "postgresql://postgres:postgres@localhost:5432/fashionstore"`, `s3Bucket === "fashionstore"`, `modelId === "ff13/fashion-clip"`, `queueName === "embed_jobs"`, `embedBatchSize === 16`, `maxAttempts === 3`, `visibilityTimeoutS === 60`, `pollMaxSeconds === 5`, `pollIntervalMs === 100`, `grpcPort === 9091`, `grpcMaxConcurrency === 4`, `grpcMaxImageBytes === 8388608`. Test thứ hai: truyền env override `DATABASE_URL`, `LOCAL_FILES_ONLY=true`, `EMBED_BATCH_SIZE=4` → assert đúng kiểu boolean/number.

- [ ] **Step 3: Chạy test, expected FAIL**

Run: `pnpm test src/config.test.ts`
Expected: FAIL "`loadSettings` is not a function" / module not found.

- [ ] **Step 4: Implement `src/config.ts`**

Dùng `zod` object với `.default(...)` và `z.coerce.number()`/`z.coerce.boolean()` cho env; `loadSettings` parse `env` rồi map keys sang camelCase. Không đọc file `.env` trong code (vite-plus/pnpm lo, hoặc `main.ts` có thể import `node:process` env sẵn).

- [ ] **Step 5: Viết `sync-proto.mjs` và chạy**

Script dùng `cpSync` từ `../embed-worker/proto/fashion_clip/v1/embedding.proto` vào `src/grpc/proto/fashion_clip/v1/embedding.proto` (tạo dir). Viết tay `src/grpc/proto/grpc/health/v1/health.proto` theo chuẩn `grpc.health.v1` (`Check`, `Watch`, enum `SERVING = 1`). Run `pnpm proto:sync`, assert file tồn tại.

- [ ] **Step 6: Viết test hash proto**

`src/grpc/proto-sync.test.ts`: so SHA-256 của file canonical `../embed-worker/proto/fashion_clip/v1/embedding.proto` và bản copy trong src; phải bằng nhau. (Nếu canonical không tồn tại thì `skip` như Java.)

- [ ] **Step 7: Chạy test, expected PASS; commit**

Run: `pnpm test`
Expected: PASS tất cả.

```bash
git init && git add . && git commit -m "feat: scaffold node worker with vite-plus and config"
```

---

### Task 2: Types và repository Postgres

**Files:**

- Create: `src/types.ts`
- Create: `src/infrastructure/db.ts`, `src/infrastructure/db.test.ts`

**Interfaces:**

- Consumes: `Settings` (Task 1).
- Produces: `EMBED_DIM = 512`; `MODEL_NAME = "fashion-clip-vit-b32"`; `DecodedImage { data: Uint8Array | Uint8ClampedArray; width: number; height: number; channels: 3 }`; `QueuedJob { msgId: string; readCt: number; productImageId: string; productId: string; uploadId: string; s3Key: string }`; `ProductImageRef { productImageId: string; productId: string; uploadId: string; s3Key: string }`; `ImageStoreError`; `InvalidImageError`; `ImageTooLargeError`; interfaces `ImageStore.get(key: string): Promise<Buffer>`, `EmbeddingModel.load(): Promise<void>` + `embedImages(images: DecodedImage[]): Promise<Float32Array[]>`, `ProductImageRepository` (`getImage`, `upsertEmbedding(job, vector: Float32Array, model: string): Promise<boolean>`, `setEmbedError`), `JobQueue` (`readBatch(qty, visibilityTimeoutS)`, `archive(job)`). `Database` với `pool: Pool` và `close(): Promise<void>`; `PostgresProductImageRepository` implements `ProductImageRepository`.

- [ ] **Step 1: Viết test repository với fake pool (chưa có impl)**

`src/infrastructure/db.test.ts`: fake object có `query(text, params)` trả `{rows, rowCount}`. Test:

- `getImage("img-1")` gọi SQL chứa `FROM product_image pi JOIN upload u`, params `["img-1"]`, trả `ProductImageRef` đúng; trả `null` khi `rows` rỗng.
- `upsertEmbedding(job, vector, MODEL_NAME)` params thứ nhất là vector string `"[0.1,0.2,...]"`, có `::vector` trong SQL, trả `true` khi `rowCount > 0`, `false` khi `0`.
- `setEmbedError` SQL có `embedding = NULL` và `embed_error = EXCLUDED.embed_error`.

- [ ] **Step 2: Chạy test, expected FAIL**

Run: `pnpm test src/infrastructure/db.test.ts` → FAIL module not found.

- [ ] **Step 3: Implement `src/types.ts` và `src/infrastructure/db.ts`**

`types.ts` chỉ định nghĩa interface/DTO/class lỗi — không import `pg`, AWS, sharp, transformers. `db.ts` dùng `pg.Pool`; SQL port y hệt Python nhưng `$1/$2/$3`; serialize vector bằng `Array.from(vector).join(",")` bọc trong `[]`. Chuyển UUID sang `string`, không khai báo kiểu `any`.

- [ ] **Step 4: Chạy test PASS; commit**

Run: `pnpm test src/infrastructure/db.test.ts`
Expected: PASS.
Commit: `git commit -m "feat: add types and postgres repository"`

---

### Task 3: pgmq queue adapter + long-poll

**Files:**

- Create: `src/infrastructure/queue.ts`, `src/infrastructure/queue.test.ts`

**Interfaces:**

- Consumes: `QueuedJob`, `JobQueue` (Task 2), `pg.Pool` (Task 2).
- Produces: `PgmqJobQueue implements JobQueue`, constructor `(pool: Pool, queueName: string, pollMaxSeconds: number, pollIntervalMs: number)`; `archive(job: QueuedJob): Promise<void>`.

- [ ] **Step 1: Viết failing tests**

`src/infrastructure/queue.test.ts` với fake pool:

- `readBatch` trả job khi rows có `message` jsonb hợp lệ; assert `msgId` giữ nguyên string `"9007199254740993"`, `readCt`, UUID fields, `s3Key`.
- `readBatch` với row thiếu `s3_key` → row đó bị archive (query SQL chứa `pgmq.archive`), message hợp lệ khác vẫn nằm trong kết quả.
- `readBatch` với pool trả 0 row trong 3 lần rồi 1 row → assert có 2 lần delay ~ `pollIntervalMs` (dùng injectable `sleep` hoặc fake timer) và trả đúng 1 job; với thời gian `pollMaxSeconds = 0` → trả `[]` sau 1 lần query.

- [ ] **Step 2: Chạy test, expected FAIL**

Run: `pnpm test src/infrastructure/queue.test.ts` → FAIL module not found.

- [ ] **Step 3: Implement `src/infrastructure/queue.ts`**

SQL: `SELECT msg_id, read_ct, message FROM pgmq.read($1, $2, $3)`; map `row.message` object → `QueuedJob`, validate các field bằng `typeof === "string"`; invalid → gọi private `archiveById(msgId)` rồi log. Vòng long-poll dùng `Date.now()` deadline; delay tối đa phần thời gian còn lại; nhận `sleep` làm tham số optional thứ 5 để test không chờ thật. `archive(job)` gọi `pgmq.archive($1, $2)` với `msgId` string.

- [ ] **Step 4: Chạy test PASS; commit**

Run: `pnpm test src/infrastructure/queue.test.ts`
Expected: PASS.
Commit: `git commit -m "feat: add pgmq queue adapter with long polling"`

---

### Task 4: S3, decode ảnh, model ONNX + parity gate

**Files:**

- Create: `src/infrastructure/s3.ts`, `src/infrastructure/image.ts`, `src/infrastructure/model.ts`
- Create: `src/infrastructure/model.parity.test.ts`, `scripts/make-parity-fixture.mjs`

**Interfaces:**

- Consumes: `Settings`, `DecodedImage`, `EmbeddingModel`, `ImageStore`, `ImageStoreError`, `InvalidImageError` (Task 2).
- Produces: `S3ImageStore implements ImageStore` (`get(key)` trả `Buffer`, lỗi ném `ImageStoreError`); `decodeImage(buffer: Buffer): DecodedImage`; `FashionClipModel implements EmbeddingModel`; `MODEL_NAME` từ Task 2.

- [ ] **Step 1: Viết test parity (gate) trước**

`src/infrastructure/model.parity.test.ts` — opt-in bằng `RUN_PARITY === "1"`. Hai test: (1) model parity — đọc `test-fixtures/pixel-values.bin` (1 × 3 × 224 × 224 float32) + `test-fixtures/python-pixel-vector.json` (512 số), gọi `embedPixelValues(...)`, cosine ≥ 0.99999; (2) end-to-end — 16 ảnh + `python-vectors.json`, gọi `embedImages(images)` một lần, mỗi cosine ≥ 0.9975. Gate: nếu fail dừng và báo, không được hạ ngưỡng ngầm.

- [ ] **Step 2: Tạo fixture bằng Python oracle**

Copy 16 ảnh thật từ `../backend/data/marketplace-import/images/lazada/` vào `test-fixtures/images/`. Dùng venv có sẵn `../embed-worker/.venv/bin/python`, import `FashionClipModel` từ `../embed-worker/app/infrastructure/model.py` (weights `patrickjohncyh` đã cache local); gọi `model.embed_images([...16 ảnh Pillow...])` **một lần batch**, lưu kết quả dạng mảng 16 × 512 vào `test-fixtures/python-vectors.json`. Oracle là code Python cũ nên gate độc lập với implementation Node. Không sửa repo Python. Commit fixture + vector.

- [ ] **Step 3: Chạy parity test, expected FAIL**

Run: `RUN_PARITY=1 pnpm test src/infrastructure/model.parity.test.ts`
Expected: FAIL "`FashionClipModel` is not defined" / module not found.

- [ ] **Step 4: Implement decode + S3 + model**

`image.ts`: JPEG decode bằng `jpeg-js` (khớp libjpeg/Pillow hơn sharp), ảnh khác dùng `sharp(...).removeAlpha().raw()`; `preprocessForClip` resize bằng `resizeBicubicPil`, center-crop 224, normalize mean/std, xếp CHW. `pil-resize.ts` port từ Pillow `Resample.c` (kernel a=-0.5, support giãn theo scale, quantize hệ số 22-bit, hai pass ngang/dọc). Decode lỗi → `InvalidImageError`.
`s3.ts`: `new S3Client({ endpoint, region, credentials })`; `GetObjectCommand({ Bucket, Key })`; `Body.transformToByteArray()` → `Buffer.from(...)`; mọi lỗi → `ImageStoreError`.
`model.ts`: set `env.localModelPath`/`env.allowRemoteModels` từ settings; `CLIPVisionModelWithProjection.from_pretrained(modelId, { revision, dtype: "fp32", device: "cpu", model_file_name: "vision_model", session_options: {...} })`. Không dùng `AutoProcessor`. `embedImages` gom `preprocessForClip` thành tensor `[n,3,224,224]` rồi gọi `embedPixelValues`; `embedPixelValues(pixelData, count)` chạy ONNX, lấy `image_embeds`, L2-normalize từng hàng.

- [ ] **Step 5: Chạy parity test thật, expected PASS**

Run: `RUN_PARITY=1 pnpm test src/infrastructure/model.parity.test.ts`
Expected: PASS cosine ≥ 0.9999. **Nếu FAIL:** không hạ ngưỡng; thử lại với ONNX tự export từ SHA pin của `patrickjohncyh/fashion-clip` bằng `optimum` (approach 3), hoặc dừng và báo Main Partner.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure scripts/make-parity-fixture.mjs test-fixtures
git commit -m "feat: add s3, image decode, ONNX model and parity gate"
```

---

### Task 5: Service layer

**Files:**

- Create: `src/service/embedding-jobs.ts`, `src/service/embedding-jobs.test.ts`
- Create: `src/service/search-embedding.ts`, `src/service/search-embedding.test.ts`

**Interfaces:**

- Consumes: `JobQueue`, `ImageStore`, `EmbeddingModel`, `ProductImageRepository`, `DecodedImage`, `QueuedJob`, `ImageStoreError`, `InvalidImageError`, `ImageTooLargeError`, `EMBED_DIM`, `MODEL_NAME` (Task 2), `decodeImage` (Task 4).
- Produces: `EmbeddingJobProcessor` constructor `(jobs, images, model, repository, options?: { maxAttempts?: number; visibilityTimeoutS?: number })` với `processBatch(batchSize: number): Promise<number>`; `SearchEmbedder` constructor `(model: EmbeddingModel, maxImageBytes?: number)` với `embed(data: Buffer): Promise<number[]>`.

- [ ] **Step 1: Viết failing tests cho processor với fake**

`src/service/embedding-jobs.test.ts`:

- batch 2 job hợp lệ → `model.embedImages` gọi **1 lần** với 2 ảnh, `upsertEmbedding` 2 lần với vector normalized (norm ≈ 1), `archive` 2 lần, trả 2.
- ảnh S3 lỗi / decode lỗi ở `read_ct = 1` → không `setEmbedError`, không archive, vẫn trả số job.
- cùng lỗi ở `read_ct = 3` → `setEmbedError` + `archive`, không upsert.
- `getImage` trả upload_id khác → archive, **không gọi model**, không upsert.
- `getImage` trả `null` → archive, không gọi model.
- upsert trả `false` → vẫn archive, log stale.
- model ném lỗi → `setEmbedError` cho job có `read_ct >= 3`, archive chúng, trả số job.
- batch rỗng → trả 0, không gọi model.
- upsert thành công → SQL set `embed_error = NULL` (đã nằm trong Task 2; test ở đây assert repository được gọi).

- [ ] **Step 2: Viết failing tests cho SearchEmbedder**

`src/service/search-embedding.test.ts`: buffer rỗng → `InvalidImageError`; buffer > 8MB → `ImageTooLargeError`; bytes không phải ảnh → `InvalidImageError`; model trả 511 chiều → lỗi dim; ảnh hợp lệ → trả 512 số, norm ≈ 1.

- [ ] **Step 3: Chạy tests, expected FAIL; implement cả hai service**

Run: `pnpm test src/service` → FAIL module not found. Port logic từ `app/service/embedding_jobs.py` và `app/service/search_embedding.py`, giữ thứ tự guard và ngưỡng `read_ct < maxAttempts`.

- [ ] **Step 4: Chạy tests PASS; commit**

Run: `pnpm test src/service`
Expected: PASS.
Commit: `git commit -m "feat: port embedding job processor and search embedder"`

---

### Task 6: gRPC server + servicer + health

**Files:**

- Create: `src/grpc/embedding-service.ts`, `src/grpc/server.ts`, `src/grpc/embedding-service.test.ts`, `src/grpc/server.test.ts`

**Interfaces:**

- Consumes: `SearchEmbedder`, `Settings`, `InvalidImageError`, `ImageTooLargeError`, `MODEL_NAME` (Task 2), proto files (Task 1).
- Produces: `createEmbeddingService(embedder: SearchEmbedder, maxConcurrency: number): UntypedServiceImplementation` (handler `EmbedImage`); `createGrpcServer(settings: Settings, service: UntypedServiceImplementation): Promise<GrpcServer>` với `GrpcServer.start(): Promise<grpc.Server>`, `stop(graceS: number): Promise<void>`.

- [ ] **Step 1: Viết failing unit test cho servicer**

`src/grpc/embedding-service.test.ts`: gọi handler trực tiếp với fake embedder + fake `call`/`callback`:

- success → callback `(null, { vector: number[512], model: "fashion-clip-vit-b32" })`.
- `InvalidImageError` → `status.code === grpc.status.INVALID_ARGUMENT`.
- `ImageTooLargeError` → `RESOURCE_EXHAUSTED`.
- lỗi khác → `INTERNAL`.
- vượt `maxConcurrency` → từ chối bằng `RESOURCE_EXHAUSTED`.

- [ ] **Step 2: Viết failing in-process server test**

`src/grpc/server.test.ts`: `createGrpcServer` với settings `grpcPort: 0`, servicer dùng fake embedder; bind `127.0.0.1:0`, lấy port thực từ `server.start()`; tạo client `@grpc/grpc-js` + proto-loader trỏ proto copy; gọi `EmbedImage` với bytes ảnh thật từ fixture → nhận 512 vector; gọi `health.Check` → `SERVING` (1); gọi với buffer rỗng → `INVALID_ARGUMENT`; gọi `stop(0.1)` → server không còn nhận RPC.

- [ ] **Step 3: Chạy tests, expected FAIL**

Run: `pnpm test src/grpc` → FAIL module not found.

- [ ] **Step 4: Implement servicer + server**

`embedding-service.ts`: async handler wrapped trong IIFE, semaphore đếm `active` và queue/chống vượt ngưỡng; map lỗi qua `grpc.status`; KHÔNG trả chiều sai (SearchEmbedder đã chặn). `server.ts`: `loadSync` proto embedding + health với `includeDirs: [protoDir]`; đăng ký `fashion_clip.v1.EmbeddingService` và `grpc.health.v1.Health`; health `Check` trả `{ status: 1 }`, `Watch` gọi `call.end()`; options max message 8MB; `bindAsync("127.0.0.1:0", ...)` trả port; `stop` dùng `tryShutdown` rồi `forceShutdown` sau grace.

- [ ] **Step 5: Chạy tests PASS; commit**

Run: `pnpm test src/grpc`
Expected: PASS.
Commit: `git commit -m "feat: add grpc server, servicer and health check"`

---

### Task 7: Container, main loop, graceful shutdown

**Files:**

- Create: `src/container.ts`, `src/main.ts`, `src/worker.test.ts`

**Interfaces:**

- Consumes: mọi thành phần trước; `loadSettings` (Task 1).
- Produces: `createContainer(settings: Settings): Promise<Container>` với `{ db, model, processor, embedder, close(): Promise<void> }`; `createWorker(processor: EmbeddingJobProcessor, batchSize: number): { runOnce(): Promise<number>; runForever(stop: () => boolean): Promise<void> }`; `main(): Promise<void>`.

- [ ] **Step 1: Viết failing test cho worker loop**

`src/worker.test.ts`: fake processor đếm số lần `processBatch`; `runOnce` trả đúng số job; `runForever(() => true)` không gọi processor; `runForever` với stop sau 2 vòng → gọi đúng 2 lần; processor ném lỗi 1 lần → loop vẫn tiếp tục (backoff injectable = 0 trong test).

- [ ] **Step 2: Chạy test, expected FAIL**

Run: `pnpm test src/worker.test.ts` → FAIL module not found.

- [ ] **Step 3: Implement container + main**

`container.ts`: dựng `Database`, `S3ImageStore`, `FashionClipModel`, `PostgresProductImageRepository`, `PgmqJobQueue`, `SearchEmbedder`, `EmbeddingJobProcessor`; `await model.load()` trước khi trả container; `close()` đóng pool.
`main.ts`: `loadSettings()` → `createContainer()` → `createGrpcServer()` → `await start()` → loop; `SIGTERM`/`SIGINT` set `stopping = true`; `finally`: `await server.stop(5)`, `await container.close()`. Log theo format Python. Không gọi `process.exit`.

- [ ] **Step 4: Chạy test + typecheck PASS; commit**

Run: `pnpm test src/worker.test.ts && pnpm check`
Expected: PASS, không lỗi type/lint.
Commit: `git commit -m "feat: wire container, main loop and graceful shutdown"`

---

### Task 8: Kiểm chứng toàn cục

**Files:** không tạo file mới (chỉ sửa nếu kiểm chứng phát hiện lỗi).

- [ ] **Step 1: Chạy full check/test/build**

Run: `pnpm check && pnpm test && pnpm build && RUN_PARITY=1 pnpm test src/infrastructure/model.parity.test.ts`
Expected: tất cả PASS; `dist/main.mjs` tồn tại.

- [ ] **Step 2: Đảm bảo backend Java không bị ảnh hưởng**

Run: `cd ../backend && ./gradlew test --tests '*ProtoSyncTest'`
Expected: PASS (proto canonical không đổi).

- [ ] **Step 3: Smoke test tay (ghi kết quả vào PR/commit message)**

Chạy `pnpm dev` với Postgres本地 nếu có, quan sát log: model load → "gRPC server nghe 127.0.0.1:9091" → poll queue. Nếu không có hạ tầng, ghi rõ "smoke test skipped: no local Postgres/S3" và không coi là block.

- [ ] **Step 4: Commit cuối nếu có chỉnh sửa**

```bash
git add -A && git commit -m "chore: verify node worker PoC end to end"
```
