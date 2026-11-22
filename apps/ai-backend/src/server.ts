import { auth, UnauthorizedError } from "express-oauth2-jwt-bearer";
import cors from "cors";
import express from "express";
import type { NextFunction, Request, Response } from "express";

import { registerChatRoute } from "./lib/ai/chatRoute";

import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch {}

const app = express();

app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-backend" });
});

app.use(
  "/api",
  auth({
    issuerBaseURL: process.env.GOTRUE_URL ?? "http://localhost:9999",
    audience: process.env.GOTRUE_JWT_AUD ?? "authenticated",
  }),
);

registerChatRoute(app);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof UnauthorizedError) {
    res.status(err.status).set(err.headers).json({ message: err.message });
    return;
  }
  res.status(500).json({ message: "internal server error" });
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`ai-backend listening on http://localhost:${port}`);
});
