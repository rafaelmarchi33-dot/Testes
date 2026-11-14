import Anthropic from "@anthropic-ai/sdk";
import { config, aiConfigured } from "../config.ts";
import { IntegrationUnavailable, HttpError } from "../lib/errors.ts";
import { q } from "../db/index.ts";

let client: Anthropic | null = null;

export function ai(): Anthropic {
  if (!aiConfigured()) throw new IntegrationUnavailable("Inteligência artificial não configurada: defina ANTHROPIC_API_KEY no servidor.");
  client ??= new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 3 });
  return client;
}

/**
 * Parâmetros comuns: modelo configurável e fallback automático no servidor
 * (se o modelo recusar por política de segurança, a API refaz a requisição em um modelo alternativo).
 */
export const common = () => ({
  model: config.ai.model,
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
});

export function logAi(path: string, started: number, status: number, error?: string) {
  q.run("INSERT INTO api_logs (service, method, path, status, duration_ms, error) VALUES ('anthropic','POST',?,?,?,?)", [
    path, status, Date.now() - started, error?.slice(0, 500) ?? null,
  ]);
}

export function checkStop(msg: { stop_reason: string | null }) {
  if (msg.stop_reason === "refusal") throw new HttpError(422, "A IA não pôde atender a esta solicitação.", "ai_refusal");
  if (msg.stop_reason === "max_tokens") throw new HttpError(502, "A resposta da IA foi interrompida por limite de tamanho. Tente novamente.", "ai_truncated");
}

export function aiError(e: unknown): never {
  if (e instanceof HttpError) throw e;
  if (e instanceof Anthropic.AuthenticationError) throw new IntegrationUnavailable("Chave da API de IA inválida.");
  if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "Limite de uso da IA atingido. Tente novamente em instantes.", "ai_rate_limited");
  if (e instanceof Anthropic.APIConnectionError) throw new IntegrationUnavailable("Não foi possível conectar ao serviço de IA.");
  if (e instanceof Anthropic.APIError) throw new HttpError(502, `Erro do serviço de IA (${e.status}): ${e.message}`, "ai_error");
  throw e;
}

export const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
