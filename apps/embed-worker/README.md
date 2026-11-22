# Fashion Embed Worker (Node.js PoC)

Port bản Python `../embed-worker` sang Node.js. Tiêu thụ pgmq `embed_jobs`, tải ảnh từ S3,
tính Fashion-CLIP 512-dim bằng ONNX, ghi `product_embedding`, đồng thời serve gRPC
`EmbedImage` + health cho backend Java trên `127.0.0.1:9091`.

## Chạy local

```bash
pnpm install
pnpm dev
pnpm check && pnpm test
pnpm build && pnpm start
```

Env mặc định trong `.env.example`. Cần Postgres đã migrate tới `V46` và S3 endpoint.

## Stub gRPC

Proto được **lưu ngay trong repo** tại `src/grpc/proto/` (bản embedding copy từ canonical
`../../proto/fashion_clip/v1/embedding.proto` ở root monorepo, bản health do mình giữ).
TS stub đã commit trong `src/grpc/gen/`.
Sinh lại khi đổi proto:

```bash
pnpm proto:gen    # pnpm exec buf generate
```

Stub dùng `protoc-gen-es` (`erasable_syntax=true`) + `protoc-gen-grpc-es`, chạy trên
`@grpc/grpc-js` nên Java backend không đổi. Test `proto-sync.test.ts` vẫn so hash proto local
với bản canonical Python để phát hiện lệch; nếu lệch thì copy tay rồi chạy `pnpm proto:gen`.

## Parity

```bash
RUN_PARITY=1 pnpm test src/infrastructure/model.parity.test.ts
```

Hai gate: model (cùng `pixel_values`) cosine ≥ 0.99999; end-to-end cosine ≥ 0.9975
(decoder JPEG pure-JS khác libjpeg của Pillow — xem design doc §9).

## Container

Từ root monorepo:

```bash
podman build -f apps/embed-worker/Dockerfile -t fashionstore-embed-worker .
podman run --rm -p 9091:9091 \
  -e DATABASE_URL=postgresql://postgres:postgres@postgres:5432/fashionstore \
  -e S3_ENDPOINT_URL=http://s3:9000 \
  fashionstore-embed-worker
```

Image dùng `registry.access.redhat.com/hi/nodejs:26-builder` để build và
`.../hi/nodejs:26` để chạy. Chỉ đóng gói gói native (`sharp`, `onnxruntime-node` CPU
linux/x64, ~67 MB); phần JS nằm trong `dist/`. Weights ONNX được tải lúc build bằng
`pnpm exec hfjs download` (`@huggingface/hub`, devDependency) theo SHA pin, chạy hoàn toàn
offline với `LOCAL_FILES_ONLY=true`. Không có script tuỳ biến nào trong repo.

Khi chạy trong compose, đặt `GRPC_BIND_HOST=0.0.0.0` và cho backend Java dùng
`EMBED_GRPC_ADDRESS=embed-worker:9091`. HEALTHCHECK gọi `dist/grpc-health.mjs` qua service
`grpc.health.v1/Health.Check`.
