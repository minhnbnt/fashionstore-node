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
# Bundle JS đã chứa mọi deps còn lại — runtime chỉ cần sharp và closure của nó.
# Walk closure của sharp trong .pnpm rồi xóa phần còn lại: không phải maintain
# blacklist khi sharp thêm/bỏ deps.
RUN cd /native/node_modules && node <<'EOF'
const fs = require("node:fs");
const path = require("node:path");

const nm = process.cwd();
const store = path.join(nm, ".pnpm");
const keep = new Set();

function visit(pkgPath) {
  const real = fs.realpathSync(pkgPath);
  // scoped pkg nằm sâu hơn 1 tầng (@img/xxx), nên tìm "node_modules" gần nhất
  // thay vì dirname để có đúng virtual store …/.pnpm/<seg>/node_modules.
  const marker = path.sep + "node_modules" + path.sep;
  const markerEnd = real.lastIndexOf(marker) + marker.length;
  const storeNodeModules = real.slice(0, markerEnd);
  const seg = path.basename(path.dirname(storeNodeModules));
  if (keep.has(seg) === true) return;
  keep.add(seg);
  const meta = JSON.parse(fs.readFileSync(path.join(real, "package.json"), "utf8"));
  const deps = Object.keys({ ...meta.dependencies, ...meta.optionalDependencies });
  for (const name of deps) {
    const depPath = path.join(storeNodeModules, name);
    if (fs.existsSync(depPath) === true) {
      visit(depPath);
    }
  }
}

visit(path.join(nm, "sharp"));
for (const entry of fs.readdirSync(store)) {
  if (keep.has(entry) === false) {
    fs.rmSync(path.join(store, entry), { recursive: true, force: true });
  }
}
for (const entry of fs.readdirSync(nm)) {
  if (entry === "sharp" || entry === ".pnpm" || entry.startsWith(".") === true) continue;
  fs.rmSync(path.join(nm, entry), { recursive: true, force: true });
}
console.log("kept:", [...keep].sort().join(", "));
EOF

FROM registry.access.redhat.com/hi/nodejs:26

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# COPY --chown thay RUN chown -R: tránh layer chép lại node_modules (~13MB).
COPY --from=build --chown=65532:0 /app/apps/ai-backend/dist ./dist
COPY --from=build --chown=65532:0 /native/node_modules ./node_modules

USER 65532
EXPOSE 3000

CMD ["node", "dist/server.mjs"]
