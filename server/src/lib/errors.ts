import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.ts";

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, message: string, code = "error", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Erro explícito de integração indisponível — o sistema nunca simula sucesso. */
export class IntegrationUnavailable extends HttpError {
  constructor(message: string, details?: unknown) {
    super(503, message, "integration_unavailable", details);
  }
}

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Dados inválidos", code: "validation_error", details: err.issues });
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.warn("http_error", { path: req.path, status: err.status, message: err.message });
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  if (err && typeof err === "object" && "type" in err && (err as any).type === "entity.too.large") {
    return res.status(413).json({ error: "Arquivo ou payload muito grande", code: "too_large" });
  }
  logger.error("unhandled_error", { path: req.path, error: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: "Erro interno inesperado", code: "internal_error" });
}
