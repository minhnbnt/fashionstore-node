# Build context là root monorepo: podman build -f apps/ai-backend/Dockerfile .
FROM registry.access.redhat.com/hi/nodejs:26-builder AS build

USER 0
WORKDIR /app

RUN cd / && npm install -g pnpm@12.21.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/embed-worker/package.json ./apps/embed-worker/package.json
COPY apps/ai-backend/package.json ./apps/ai-backend/package.json
COPY apps/embed-worker/native-runtime/package.json ./apps/embed-worker/native-runtime/package.json

# Store là cache mount, không bake vào layer (hardlink trong layer bị overlayfs copy-on-write).
RUN --mount=type=cache,id=pnpm,target=/var/cache/pnpm \
    pnpm install --store-dir /var/cache/pnpm --frozen-lockfile --filter ai-backend...

COPY . .
RUN pnpm --filter ai-backend build

# sharp có native binary nên được neverBundle: runtime cần node_modules thật.
# deploy chính ai-backend để có node_modules self-contained (symlink đã resolve),
# không cần package phụ, không kéo onnxruntime-node của embed-worker.
RUN --mount=type=cache,id=pnpm,target=/var/cache/pnpm \
    pnpm --store-dir /var/cache/pnpm --filter ai-backend deploy --prod /native

FROM registry.access.redhat.com/hi/nodejs:26

USER 0
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=build /app/apps/ai-backend/dist ./dist
COPY --from=build /native/node_modules ./node_modules
RUN chown -R 65532:0 /app

USER 65532
EXPOSE 3000

CMD ["node", "dist/server.mjs"]
