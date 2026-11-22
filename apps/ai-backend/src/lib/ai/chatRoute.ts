import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";
import type { Express } from "express";

import { buildSystemPrompt, createAgentTools, MAX_AGENT_STEPS } from "./agent";
import { agentRequestContextSchema } from "./context";

import type { AgentUIMessage } from "./agent";

/** Đăng ký POST /api/chat — middleware auth của /api đã bảo đảm header hợp lệ. */
export function registerChatRoute(app: Express): void {
  app.post("/api/chat", async function (req, res) {
    const body: unknown = req.body;
    let bodyMessages: unknown;
    let bodyContext: unknown;
    if (body !== null && typeof body === "object") {
      if ("messages" in body) {
        bodyMessages = body.messages;
      }
      if ("context" in body) {
        bodyContext = body.context;
      }
    }
    if (Array.isArray(bodyMessages) === false || bodyMessages.length === 0) {
      res.status(400).json({ error: "messages must be a non-empty array" });
      return;
    }

    const parsedContext = agentRequestContextSchema.safeParse(bodyContext);
    if (!parsedContext.success) {
      res.status(400).json({ error: "context must be a valid AgentRequestContext" });
      return;
    }

    // Không check undefined: middleware /api chặn 401 trước khi tới handler.
    const authorization = req.headers.authorization as string;
    const messages = bodyMessages as AgentUIMessage[];

    const provider = createOpenAICompatible({
      name: "fashionstore-agent",
      baseURL: process.env.AI_BASE_URL ?? "",
      apiKey: process.env.AI_API_KEY ?? "",
      // Bắt buộc để tool result dạng content (ảnh từ readImage) đi tới model
      // như image_url thật thay vì bị JSON-stringify thành text.
      supportsMultiPartToolContent: true,
    });

    const controller = new AbortController();
    res.on("close", function () {
      controller.abort();
    });

    const result = streamText({
      model: provider(process.env.AI_MODEL ?? ""),
      system: buildSystemPrompt(),
      messages: await convertToModelMessages(messages),
      tools: createAgentTools({ authorization, context: parsedContext.data }),
      stopWhen: stepCountIs(MAX_AGENT_STEPS),
      abortSignal: controller.signal,
    });

    await pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.fullStream }),
    });
  });
}
