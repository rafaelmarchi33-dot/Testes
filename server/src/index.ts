import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";
import "./db/index.ts";
import { authRouter, usersRouter, sessionMiddleware, csrfGuard } from "./auth/index.ts";
import { oauthRouter } from "./ml/oauth.ts";
import { api } from "./routes/api.ts";
import { errorHandler } from "./lib/errors.ts";
import { logger } from "./lib/logger.ts";
import { startScheduler } from "./services/scheduler.ts";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware);
  app.use(csrfGuard);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/ml/oauth", oauthRouter);
  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada" }));

  // Em produção, o backend também serve o frontend compilado (web/dist).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "../../web/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(config.port, () => {
    logger.info("server_started", { port: config.port, env: config.isProd ? "production" : "development" });
    startScheduler();
  });
}
