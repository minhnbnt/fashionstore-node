import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: ["src/main.ts", "src/grpc-health.ts"],
    // sharp / onnxruntime-node có native binary: không được bundle.
    deps: {
      alwaysBundle: [/.*/],
      neverBundle: [/^sharp$/, /^@img\//, /^onnxruntime-node$/],
    },
    minify: true,
    sourcemap: true,
    platform: "node",
  },
  fmt: {},
  lint: {
    plugins: ["typescript", "oxc", "unicorn", "import", "promise"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    options: { typeAware: true, typeCheck: true },
    env: { node: true },
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/await-thenable": "error",
      "typescript/no-unsafe-assignment": "warn",
      "typescript/no-unsafe-call": "warn",
      "typescript/no-unsafe-member-access": "warn",
      "typescript/no-unsafe-argument": "warn",
      "typescript/no-unsafe-return": "warn",
      "typescript/no-explicit-any": "warn",
      "typescript/no-unnecessary-type-assertion": "warn",
      "unicorn/no-process-exit": "error",
      "unicorn/prefer-node-protocol": "warn",
      "unicorn/throw-new-error": "warn",
      "unicorn/no-useless-promise-resolve-reject": "warn",
      "promise/no-callback-in-promise": "warn",
      "import/no-duplicates": "warn",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
});
