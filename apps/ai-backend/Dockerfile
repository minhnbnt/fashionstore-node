# Build context là root monorepo: docker build -f apps/ai-backend/Dockerfile .
FROM registry.access.redhat.com/hi/nodejs:26-builder AS build

USER 0
WORKDIR /app

RUN cd / && npm install -g pnpm@12.21.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/embed-worker/package.json ./apps/embed-worker/package.json
COPY apps/ai-backend/package.json ./apps/ai-backend/package.json
COPY apps/embed-worker/native-runtime/package.json ./apps/embed-worker/native-runtime/package.json
RUN pnpm install --frozen-lockfile --filter ai-backend...

COPY . .
RUN pnpm --filter ai-backend build

FROM registry.access.redhat.com/hi/nodejs:26

USER 0
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=build /app/apps/ai-backend/dist ./dist
RUN chown -R 65532:0 /app

USER 65532
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/server.mjs"]
