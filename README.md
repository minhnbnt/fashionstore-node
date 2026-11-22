# Fashionstore Node services

Monorepo pnpm chứa hai service Node của fashionstore. Mỗi app là một package riêng
ngang hàng dưới `apps/`, dùng chung toolchain (vite-plus, TypeScript, pnpm 12.21.0).

| App | Thư mục | Image | Cổng |
| --- | --- | --- | --- |
| Embedding worker | `apps/embed-worker` | `ghcr.io/minhnbnt/fashionstore-embed-worker` | gRPC 9091 |
| AI backend | `apps/ai-backend` | `ghcr.io/minhnbnt/fashionstore-ai-backend` | HTTP 3000 |

## Chạy local

```bash
pnpm install
pnpm codegen          # buf generate + orval (generated/ không nằm trong git)
pnpm check
pnpm test
pnpm build

# chạy riêng từng app
pnpm --filter embed-worker-node dev
pnpm --filter ai-backend dev
```

Mỗi app có `.env.example` riêng. Worker cần Postgres (migration V46) và S3; AI backend
cần GoTrue, LLM OpenAI-compatible và `STORE_API_URL` của Java backend.

## Container

Hai Dockerfile nằm trong thư mục từng app, nhưng **build context luôn là root repo**:

```bash
podman build -f apps/embed-worker/Dockerfile -t fashionstore-embed-worker .
podman build -f apps/ai-backend/Dockerfile -t fashionstore-ai-backend .
```

Cả hai dùng base Red Hat `hi/nodejs:26-builder` / `hi/nodejs:26`. Worker chỉ đóng gói
native binary CPU linux/x64 (~67 MB) + `dist/`; weights ONNX tải lúc build bằng
`@huggingface/hub`. AI backend bundle toàn bộ dependency vào `dist/`.

CI ở `.github/workflows/ci.yml` chạy check/test/build rồi build-push cả hai image lên
GHCR khi push vào `master` (pull request thì chỉ build).

## Proto

Proto canonical nằm ở root `proto/fashion_clip/v1/embedding.proto`; bản copy dùng sinh
stub nằm ở `apps/embed-worker/src/grpc/proto/`. Test so hash hai bản. Sinh lại stub:

```bash
pnpm --filter embed-worker-node proto:gen
```
