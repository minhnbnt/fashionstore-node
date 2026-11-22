# Embedding worker — bản port Node.js (PoC)

Ngày: 2026-11-22

## 1. Ý định và lý do

PoC port worker Python `/home/minhnbnt/fashionstore/embed-worker` sang Node.js, giữ nguyên
hành vi observes được: tiêu thụ queue pgmq `embed_jobs`, tải ảnh sản phẩm từ S3, tính embedding
Fashion-CLIP 512 chiều đã L2-normalize, ghi vào bảng `product_embedding`; đồng thời serve RPC
gRPC `EmbedImage` + health cho Java backend dùng ở luồng search bằng ảnh.

Lý do: thử một runtime duy nhất cho worker, bỏ torch/Python khỏi image deploy. Đây là PoC đánh
giá khả thi, chưa phải bản thay production.

Thành công khi:

- Cùng `pixel_values`, vector Node và Python cosine ≥ 0.99999; cùng ảnh (end-to-end) cosine ≥ 0.9975 (parity gate, xem §6.11 và §9).
- Toàn bộ test hành vi của worker Python được port sang vitest và xanh.
- Java backend gọi gRPC vào worker Node mà không đổi code, `./gradlew test` vẫn xanh
  (đặc biệt `ProtoSyncTest`).
- Chạy được `python -m app.worker.main` và bản Node thay phiên trên cùng queue không làm
  sai khác kết quả.

## 2. Mục tiêu, non-goal, anti-goal

**Mục tiêu:** parity hành vi + parity vector + hợp nhất runtime.

**Non-goal:** Dockerfile/compose, migration Flyway, thay đổi Java backend, thay đổi frontend,
cắt traffic production, scale ngang, quantized model, text embedding, HTTP API.

**Anti-goal (sẽ coi là thất bại dù chạy được):**

- Vector Node sai khác Python đến mức search trả kết quả khác thứ tự.
- Bỏ qua guard stale `upload_id` rồi ghi vector của ảnh cũ đè lên ảnh mới.
- Đổi proto khiến `ProtoSyncTest` bên Java đỏ.
- Giữ Python inference ẩn bên trong ("full Node" mà thực ra không phải).

> **Cập nhật monorepo:** source worker đã dời vào `apps/embed-worker/` của repo
> `fashionstore-node`, ngang hàng với `apps/ai-backend`. Các đường dẫn tương đối cũ trong
> document này (ví dụ `../embed-worker/proto/...`) giờ là `../../proto/...` tính từ root app.
> Proto canonical nằm ở root monorepo `proto/fashion_clip/v1/embedding.proto`.

## 3. Ràng buộc và nền tảng hiện có

- Node 26.13.1, pnpm 12.22.0. Dùng vite-plus 1.7.0 theo mẫu `ai-backend`
  (`package.json`, `tsconfig.json`, `vite.config.ts`, `pnpm-workspace.yaml` copypattern).
- Contract proto canonical nằm ở `../embed-worker/proto/fashion_clip/v1/embedding.proto`.
  `backend/src/test/.../ProtoSyncTest.java` so SHA-256 với `backend/src/main/proto/...`.
  Không sửa proto.
- Backend Java: `EmbeddingClient` gọi stub `fashion_clip.v1.EmbeddingService/EmbedImage`,
  chờ 512 float, map `INVALID_ARGUMENT`→400, `RESOURCE_EXHAUSTED`→413,
  `UNAVAILABLE`/`DEADLINE_EXCEEDED`→503, nội dung khác→502. Deadline mặc định 5s.
  Channel plaintext tới `127.0.0.1:9091`, không auth.
- Schema do `V46__product_embedding.sql` định nghĩa: queue + bảng + trigger producer đã có,
  PoC không đụng. `embedding vector(512)` nullable, `embed_error TEXT`, CHECK có một trong hai.
- pgmq là SQL extension, không có client Node chính thức. Dùng `pg` gọi trực tiếp
  `pgmq.read(queue_name, vt, qty)` trả `msg_id`, `read_ct`, `message jsonb`; `pgmq.archive`.
- Env mặc định giữ nguyên tên/giá trị của worker Python (xem `embed-worker/app/config.py`).

## 4. Phát hiện quan trọng về model

- Repo gốc `patrickjohncyh/fashion-clip`, revision pin
  `7e3ba62ce16b379a1ab479346b66f192e76f51b7`, chỉ có `onnx/model.onnx` (text tower).
  **Không có `vision_model.onnx`** → transformers.js không tính được image feature từ bản này.
- `ff13/fashion-clip` (`https://huggingface.co/ff13/fashion-clip`) README ghi rõ là bản convert
  ONNX của `patrickjohncyh/fashion-clip`, có:
  `onnx/vision_model.onnx`, `onnx/vision_model_quantized.onnx`,
  `onnx/text_model.onnx`, `onnx/config.json`, `onnx/preprocessor_config.json`.
  Config `projection_dim: 512`, `vision_config` là CLIP ViT-B/32 — khớp worker Python.
- Vì là bản convert của bên thứ ba, SHA phải pin trong config và parity phải đo, không được tin
  rằng "convert là bằng nhau". Nếu parity fail: tự export ONNX từ SHA pin của repo gốc bằng
  `optimum` (approach 3) rồi tự host artifact, hoặc dừng lại hỏiMain Partner.

## 5. Approaches đã cân nhắc

| Approach                                 | Mô tả                                                                  | Đánh giá                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Full Node + transformers.js (đã chọn) | `@huggingface/transformers` + ONNX, `sharp`, `pg`, AWS SDK v3, grpc-js | Một runtime, đúng mục tiêu; rủi ro duy nhất là parity, đã chặn bằng gate |
| 2. Node shell + Python inference         | Node làm queue/gRPC/DB, gọi Python qua stdio                           | Parity chắc nhưng vi phạm anti-goal, bị loại                             |
| 3. Full Node + tự export ONNX            | Export từ SHA pin bằng optimum, tự host                                | Dự phòng nếu approach 1 fail parity; tốn công artifact                   |

Chọn approach 1, với approach 3 là đường lui đã biết trước.

## 6. Quyết định đã chốt (builder không cần hỏi lại)

1. **Vị trí:** repo riêng `/home/minhnbnt/fashionstore/embed-worker-node`. Worker Python giữ
   nguyên làm parity oracle. Proto canonical không đổi.
2. **Proto:** lưu ngay trong repo ở `src/grpc/proto/` (bản embedding copy từ canonical
   `../embed-worker/proto/...`, bản health tự giữ). Test so SHA-256 hai bản để phát hiện lệch.
   Không sinh stub lúc runtime, không script trung gian: stub TS đã commit, sinh lại bằng
   `pnpm proto:gen` (`pnpm exec buf generate`) khi proto đổi.
3. **Model source:** `MODEL_ID=ff13/fashion-clip`, `MODEL_REVISION` pin SHA, file
   `onnx/vision_model.onnx`, `dtype: 'fp32'` (không quantized), `device: 'cpu'`.
   `session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 }` tương đương
   `torch.set_num_threads(4)`. Cache: `env.localModelPath` + `env.allowRemoteModels = false`
   bật bởi `LOCAL_FILES_ONLY=true`, ánh xạ `HF_HOME` → `MODEL_CACHE_DIR`.
4. **Ảnh:** `sharp(buf).raw().toBuffer({ resolveWithObject: true })` → `new RawImage(data,
   width, height, 3)`. Validate bytes rỗng và > 8MB trước decode. Giữ batch 16, gọi model một
   lần cho cả batch.
5. **Queue:** tự long-poll: lặp `SELECT * FROM pgmq.read($1,$2,$3)` cách nhau 100ms tới tối đa
   5s, trả ngay khi có row. Payload hỏng → archive ngay, không chặn batch. `read_ct` lấy từ
   server. `msg_id` bigint → đọc bằng `String` rồi convert an toàn (`pg.types.setTypeParser(20)`).
6. **Vector:** serialize thành `'[v1,v2,...]'` và cast `::vector` trong SQL; không dùng ORM.
   L2-normalize bằng `Float32Array`, cùng công thức `v / ||v||` của Python.
7. **gRPC:** `@grpc/grpc-js` + `@grpc/proto-loader`; bundle thêm `grpc/health/v1/health.proto`
   (Check → SERVING, Watch → unimplemented). Bind `127.0.0.1:${GRPC_PORT}`; options
   `grpc.max_receive_message_length` / `grpc.max_send_message_length` = 8MB. Giới hạn 4 RPC
   đồng thời bằng semaphore nhỏ (grpc-js không có cờ `maximum_concurrent_rpcs` tương đương).
8. **Shutdown:** SIGTERM/SIGINT dừng poll trước → chờ batch hiện tại xong → `tryShutdown`
   với grace 5s rồi `forceShutdown` → đóng `pg.Pool`.
9. **Test:** vitest (`vp test run`). Unit dùng fake theo interface (không cần model thật):
   batch success một lần gọi model, normalize, archive; retry ở `read_ct < 3`; lần 3 ghi
   `embed_error` + archive; stale upload_id; ảnh bị xoá; upsert xoá `embed_error`; batch rỗng;
   long-poll; gRPC in-process với stub thật + map lỗi; hash proto. Parity là integration test
   opt-in (`RUN_PARITY=1`) so fixture vector Python đã lưu sẵn.
10. **Fixtures parity (call của builder):** 16 ảnh thật lấy từ
    `backend/data/marketplace-import/images/lazada/`, copy vào `embed-worker-node/test-fixtures/images/`.
    Oracle vector do chính worker Python (`../embed-worker`, weights `patrickjohncyh` đã cache
    locally) sinh ra bằng **một lần gọi batch 16**, lưu `test-fixtures/python-vectors.json`
    (mảng 16 × 512 số). Oracle là code Python cũ, không phải code Node đang test → gate độc
    lập. Test parity gồm hai phần: (a) **model parity** — đưa cùng `pixel_values` từ Python
    (`test-fixtures/pixel-values.bin`) vào ONNX, yêu cầu cosine ≥ 0.99999; (b) **end-to-end
    parity** — ảnh → vector cho cả batch 16, yêu cầu cosine ≥ 0.9975. Ngưỡng (b) được hạ có
    chủ đích từ 0.9999 xuống 0.9975 sau khi đo thực tế (min 0.99798), vì decoder JPEG pure-JS
    không decode giống hệt libjpeg của Pillow; xem §9. Không được ngầm nới ngưỡng.

11. **Preprocessing (call của builder):** bỏ `AutoProcessor` của transformers.js (resize
    không khớp Pillow). Tự decode: JPEG dùng `jpeg-js`, ảnh khác dùng `sharp`; resize bicubic
    port từ `Pillow/src/libImaging/Resample.c` vào `src/infrastructure/pil-resize.ts`; rồi
    center-crop 224, normalize mean/std, xếp CHW. `pixel_values` đưa thẳng vào ONNX qua
    `Tensor`. Model ONNX đã được chứng minh khớp torch cosine 1.0 khi cùng `pixel_values`.
12. **Lỗi/log:** exception/message tiếng Anh; comment tiếng Việt như repo gốc; log một dòng
    mỗi batch và mỗi RPC; không log nội dung ảnh.
13. **Stub gRPC (call của builder):** sinh TS bằng `protoc-gen-es` (`erasable_syntax=true`,
    tương thích `erasableSyntaxOnly`) + `protoc-gen-grpc-es` của Buf, chạy qua
    `pnpm proto:gen` = `pnpm exec buf generate`, commit vào `src/grpc/gen/`. Runtime vẫn là
    `@grpc/grpc-js` nên Java backend không đổi. Không dùng `@grpc/proto-loader` nữa.
14. **Container (call của builder):** base `registry.access.redhat.com/hi/nodejs:26-builder`
    / `:26`. Node 26 không còn Corepack nên cài pnpm bằng `npm install -g` từ `/` (tránh
    `EBADDEVENGINES`). Chạy user 65532. Build stage `pnpm --filter native-runtime deploy
    --prod /native`, xoá binary onnxruntime của platform khác chỉ giữ `linux/x64` (~67 MB
    native). `dist/` chứa phần JS đã bundle. Weights tải lúc build bằng
    `pnpm exec hfjs download` (`@huggingface/hub`, devDependency) theo SHA vào
    `/models/hub/...`, `LOCAL_FILES_ONLY=true`. `GRPC_BIND_HOST=0.0.0.0` trong container.
    Không có thư mục `scripts/` hay script tự viết nào.
15. **Healthcheck (call của builder):** `src/grpc-health.ts` build thành `dist/grpc-health.mjs`,
    dùng generated `HealthClient` + enum `SERVING`; Docker `HEALTHCHECK` gọi file này.

## 7. Cấu trúc dự kiến

```
embed-worker-node/
├── package.json, pnpm-workspace.yaml, tsconfig.json, vite.config.ts, .env.example
├── buf.gen.yaml, Dockerfile, .dockerignore, README.md
├── native-runtime/package.json          # chỉ sharp + onnxruntime-node cho pnpm deploy
├── docs/superpowers/specs/... (file này)
└── src/
    ├── config.ts, types.ts, container.ts, main.ts, grpc-health.ts
    ├── grpc/gen/                         # stub sinh ra, commit
    ├── infrastructure/{db,queue,s3,image,model}.ts
    ├── service/{embedding-jobs,search-embedding}.ts
    ├── grpc/{embedding-service,server}.ts
    │   └── proto/fashion_clip/v1/embedding.proto
    │   └── proto/grpc/health/v1/health.proto
    └── **/*.test.ts
```

## 8. Trình tự triển khai (ý tưởng cho plan)

1. Scaffold vite-plus, config, types, sync proto, test config.
2. Parity spike: load ONNX, chạy vài ảnh fixture, so với vector Python. **Gate** trước khi viết
   tiếp phần còn lại. Nếu fail → approach 3.
3. Infrastructure: db + queue (+ long-poll test), s3, image, model.
4. Service: embedding-jobs + search-embedding với fake.
5. gRPC server + servicer + health + in-process test.
6. main.ts: composition root, signal handling, graceful shutdown.
7. Kiểm chứng: `vp check`, `vp test run`, `vp pack`, và `./gradlew test` ở backend.

## 9. Rủi ro đã biết

- ONNX vision fp32 ~352MB (`onnx/vision_model.onnx`, bản quantized ~89MB nhưng không dùng);
  load lạnh chậm; PoC chấp nhận, đo latency và ghi lại.
- Đã đo: kernel ONNX khớp torch (cosine 1.0 khi cùng `pixel_values`). Nguồn drift end-to-end
  là decode JPEG: `jpeg-js` khác libjpeg/Pillow (raw pixel mean abs diff ~0.53/255, 41% pixel
  khác nhau), dù resize đã port y hệt Pillow. Cosine 16 ảnh nằm trong [0.99798, 0.999998].
  Ngưỡng e2e đặt 0.9975. Nếu cần chặt hơn nữa, phải dùng decoder native/libjpeg (WASM hoặc
  binding), tức là rời khỏi pure-JS — không làm trong PoC này.
- `ff13` là repo bên thứ ba có thể biến mất/đổi file; pin SHA + prefetch vào cache vào PoC.
- Bigint msg_id của pgmq dễ thành `number` sai ở Node; đã chặn bằng type parser.
