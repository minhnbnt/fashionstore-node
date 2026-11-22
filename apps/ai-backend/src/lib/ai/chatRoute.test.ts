import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { EMPTY_FILTERS } from "./agent";
import { registerChatRoute } from "./chatRoute";

import type { Express } from "express";

const { holder, batchMock, createProviderMock } = vi.hoisted(function () {
  const result: {
    holder: { model: unknown };
    batchMock: ReturnType<typeof vi.fn>;
    createProviderMock: (...args: unknown[]) => void;
  } = {
    holder: { model: null },
    batchMock: vi.fn(),
    createProviderMock: vi.fn(function (..._args: unknown[]) {}),
  };
  return result;
});

vi.mock("@ai-sdk/openai-compatible", function () {
  return {
    createOpenAICompatible: function (...args: unknown[]) {
      createProviderMock(...args);
      return function () {
        return holder.model;
      };
    },
  };
});

vi.mock("../../../generated/endpoints/products/products", function () {
  return { batchProductSummaries: batchMock, detail1: vi.fn() };
});

function finishChunk(unified: "stop" | "tool-calls") {
  return {
    type: "finish" as const,
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
  };
}

function messagesFixture() {
  return [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Tìm áo polo" }],
    },
  ];
}

function contextFixture() {
  return { route: "/search", filters: { ...EMPTY_FILTERS, q: "áo polo" } };
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  registerChatRoute(app);
  return app;
}

function listen(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(app);
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: function () {
          return new Promise<void>(function (done) {
            server.close(function () {
              done();
            });
          });
        },
      });
    });
  });
}

beforeEach(function () {
  vi.clearAllMocks();
  vi.stubEnv("AI_BASE_URL", "https://ai.test/v1");
  vi.stubEnv("AI_API_KEY", "sk-test");
  vi.stubEnv("AI_MODEL", "model-test");
  batchMock.mockResolvedValue({ status: 200, data: [{ id: "p1", name: "Áo polo" }] });
});

afterEach(function () {
  vi.unstubAllEnvs();
});

describe("POST /api/chat", function () {
  it("tạo provider với supportsMultiPartToolContent để ảnh trong tool result đi tới model", async function () {
    holder.model = new MockLanguageModelV4({
      doStream: async function () {
        return {
          stream: simulateReadableStream({
            initialDelayInMs: 10,
            chunks: [finishChunk("stop")],
          }),
        };
      },
    });

    const { url, close } = await listen(makeApp());
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: messagesFixture(), context: contextFixture() }),
      });
      expect(response.status).toBe(200);
      await response.text();
      expect(createProviderMock).toHaveBeenCalledWith(
        expect.objectContaining({ supportsMultiPartToolContent: true }),
      );
    } finally {
      await close();
    }
  });

  it("stream tool-showProducts + text cuối, gắn authorization của requester vào store API", async function () {
    let calls = 0;
    holder.model = new MockLanguageModelV4({
      doStream: async function () {
        calls += 1;
        if (calls === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                {
                  type: "tool-call",
                  toolCallId: "tc-1",
                  toolName: "showProducts",
                  input: JSON.stringify({ productIds: ["p1"] }),
                } as never,
                finishChunk("tool-calls") as never,
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start", id: "t1" } as never,
              { type: "text-delta", id: "t1", delta: "Đã tìm thấy sản phẩm." } as never,
              { type: "text-end", id: "t1" } as never,
              finishChunk("stop") as never,
            ],
          }),
        };
      },
    });

    const { url, close } = await listen(makeApp());
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t-1" },
        body: JSON.stringify({ messages: messagesFixture(), context: contextFixture() }),
      });
      const body = await response.text();

      // ai@7 phát chunk wire generic; @ai-sdk/react dựng lại thành UIMessage part
      // `tool-showProducts` với state `output-available` cho AgentTab render.
      expect(response.status).toBe(200);
      expect(body).toContain('"type":"tool-output-available"');
      expect(body).toContain('"toolName":"showProducts"');
      expect(body).toContain('"output":{"items":[{"id":"p1","name":"Áo polo"}]}');
      expect(body).toContain("Đã tìm thấy sản phẩm.");
      expect(batchMock).toHaveBeenCalledWith(
        { ids: ["p1"] },
        { headers: { authorization: "Bearer t-1" } },
      );
    } finally {
      await close();
    }
  });

  it("getPageContext trả context của request, không đọc từ message", async function () {
    let systemText = "";
    let calls = 0;
    holder.model = new MockLanguageModelV4({
      doStream: async function (options) {
        for (const message of options.prompt) {
          if (message.role === "system") {
            systemText += message.content;
          }
        }
        calls += 1;
        if (calls === 1) {
          return {
            stream: simulateReadableStream({
              chunks: [
                {
                  type: "tool-call",
                  toolCallId: "tc-ctx",
                  toolName: "getPageContext",
                  input: "{}",
                } as never,
                finishChunk("tool-calls") as never,
              ],
            }),
          };
        }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start", id: "t1" } as never,
              { type: "text-delta", id: "t1", delta: "Đang xem áo." } as never,
              { type: "text-end", id: "t1" } as never,
              finishChunk("stop") as never,
            ],
          }),
        };
      },
    });

    const { url, close } = await listen(makeApp());
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t-1" },
        body: JSON.stringify({
          messages: [
            ...messagesFixture(),
            {
              id: "u2",
              role: "user",
              parts: [{ type: "text", text: "Áo này giá bao nhiêu?" }],
            },
          ],
          context: {
            route: "/product/slug-ao-polo",
            filters: EMPTY_FILTERS,
            productId: "slug-ao-polo",
          },
        }),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('"toolName":"getPageContext"');
      expect(body).toContain("slug-ao-polo");
      expect(systemText).not.toContain("slug-ao-polo");
    } finally {
      await close();
    }
  });

  it("body thiếu context thì trả 400", async function () {
    const { url, close } = await listen(makeApp());
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t-1" },
        body: JSON.stringify({ messages: messagesFixture() }),
      });

      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });

  it("body thiếu messages thì trả 400", async function () {
    const { url, close } = await listen(makeApp());
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t-1" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });

  it("client ngắt kết nối thì abortSignal của model bị abort", async function () {
    let captured: AbortSignal | undefined;
    holder.model = new MockLanguageModelV4({
      doStream: async function (options) {
        captured = options.abortSignal;
        return {
          stream: simulateReadableStream({
            chunks: [{ type: "text-start", id: "t1" } as never],
            initialDelayInMs: 5000,
          }),
        };
      },
    });

    const { url, close } = await listen(makeApp());
    try {
      const controller = new AbortController();
      const pending = fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer t-1" },
        body: JSON.stringify({ messages: messagesFixture(), context: contextFixture() }),
        signal: controller.signal,
      }).catch(function () {
        return null;
      });
      await new Promise(function (resolve) {
        setTimeout(resolve, 100);
      });
      controller.abort();
      await pending;

      await vi.waitFor(function () {
        expect(captured?.aborted).toBe(true);
      });
    } finally {
      await close();
    }
  });
});
