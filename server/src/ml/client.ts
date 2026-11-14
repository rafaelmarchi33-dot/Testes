import { config, mlConfigured } from "../config.ts";
import { q } from "../db/index.ts";
import { encrypt, decrypt } from "../lib/crypto.ts";
import { logger } from "../lib/logger.ts";
import { HttpError, IntegrationUnavailable } from "../lib/errors.ts";

/** Erro devolvido pela API do Mercado Livre, preservando o corpo original. */
export class MLApiError extends HttpError {
  mlStatus: number;
  body: unknown;
  constructor(status: number, path: string, body: unknown) {
    const msg = typeof body === "object" && body && "message" in body ? String((body as any).message) : `HTTP ${status}`;
    super(status >= 500 ? 502 : status === 401 ? 502 : status, `Mercado Livre (${path}): ${msg}`, "ml_api_error", body);
    this.mlStatus = status;
    this.body = body;
  }
}

export interface MLAccount {
  id: number;
  nickname: string | null;
  site_id: string | null;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  scope: string | null;
  status: string;
  last_error: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
  scope?: string;
  token_type?: string;
}

// ------------------------------------------------------------------
// Controle de taxa: limita concorrência e espaçamento entre chamadas.
// O Mercado Livre aplica limites por aplicativo; respeitamos 429 + Retry-After.
// ------------------------------------------------------------------
const MAX_CONCURRENCY = Number(process.env.ML_MAX_CONCURRENCY ?? 4);
const MIN_INTERVAL_MS = Number(process.env.ML_MIN_INTERVAL_MS ?? 120);
let active = 0;
let lastStart = 0;
const waiters: (() => void)[] = [];

async function acquire() {
  while (active >= MAX_CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  active++;
  const wait = lastStart + MIN_INTERVAL_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_INTERVAL_MS);
  if (wait > 0) await sleep(wait);
}
function release() {
  active--;
  waiters.shift()?.();
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Permite substituir o fetch em testes. */
export const transport = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };

function logApi(method: string, path: string, status: number, ms: number, error?: string) {
  try {
    q.run("INSERT INTO api_logs (service, method, path, status, duration_ms, error) VALUES ('mercadolivre',?,?,?,?,?)", [
      method, path.split("?")[0]!.slice(0, 300), status, ms, error?.slice(0, 500) ?? null,
    ]);
  } catch {
    /* log nunca deve derrubar a requisição */
  }
}

// ------------------------------------------------------------------
// OAuth: troca de código e renovação de tokens
// ------------------------------------------------------------------
export async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  if (!mlConfigured()) throw new IntegrationUnavailable("Credenciais do aplicativo Mercado Livre não configuradas (ML_CLIENT_ID / ML_CLIENT_SECRET).");
  const started = Date.now();
  const res = await transport.fetch(`${config.ml.apiBase}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: config.ml.clientId, client_secret: config.ml.clientSecret, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  logApi("POST", "/oauth/token", res.status, Date.now() - started, res.ok ? undefined : JSON.stringify(body));
  if (!res.ok) throw new MLApiError(res.status, "/oauth/token", body);
  return body as TokenResponse;
}

export function saveTokens(t: TokenResponse, extra: { nickname?: string; site_id?: string; email?: string; userId?: number } = {}) {
  const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString();
  q.run(
    `INSERT INTO ml_accounts (id, nickname, site_id, email, access_token_enc, refresh_token_enc, expires_at, scope, status, last_error, connected_by)
     VALUES (?,?,?,?,?,?,?,?, 'connected', NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       nickname = COALESCE(excluded.nickname, nickname), site_id = COALESCE(excluded.site_id, site_id), email = COALESCE(excluded.email, email),
       access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
       expires_at = excluded.expires_at, scope = excluded.scope, status = 'connected', last_error = NULL`,
    [t.user_id, extra.nickname ?? null, extra.site_id ?? null, extra.email ?? null, encrypt(t.access_token), encrypt(t.refresh_token), expiresAt, t.scope ?? null, extra.userId ?? null],
  );
}

export function getAccount(): MLAccount | undefined {
  return q.get<MLAccount>("SELECT * FROM ml_accounts WHERE status != 'disconnected' ORDER BY connected_at DESC LIMIT 1");
}

export function requireAccount(): MLAccount {
  const acc = getAccount();
  if (!acc) throw new IntegrationUnavailable("Nenhuma conta do Mercado Livre conectada. Conecte sua loja em Integrações.");
  if (acc.status === "needs_reauth") throw new IntegrationUnavailable("A autorização do Mercado Livre expirou ou foi revogada. Reconecte a conta em Integrações.");
  return acc;
}

// Um único refresh por vez: refresh tokens do ML são de uso único.
let refreshing: Promise<string> | null = null;

async function refreshAccessToken(acc: MLAccount): Promise<string> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const fresh = q.get<MLAccount>("SELECT * FROM ml_accounts WHERE id = ?", [acc.id])!;
      if (fresh.expires_at > new Date(Date.now() + 60_000).toISOString()) return decrypt(fresh.access_token_enc);
      const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(fresh.refresh_token_enc) });
      saveTokens(t);
      logger.info("ml_token_refreshed", { account: acc.id });
      return t.access_token;
    } catch (e) {
      if (e instanceof MLApiError && (e.mlStatus === 400 || e.mlStatus === 401)) {
        q.run("UPDATE ml_accounts SET status='needs_reauth', last_error=? WHERE id=?", [e.message, acc.id]);
        throw new IntegrationUnavailable("Não foi possível renovar o acesso ao Mercado Livre. Reconecte a conta.", e.body);
      }
      throw e;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function accessToken(acc: MLAccount): Promise<string> {
  if (acc.expires_at <= new Date(Date.now() + 5 * 60_000).toISOString()) return refreshAccessToken(acc);
  return decrypt(acc.access_token_enc);
}

export interface MLRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Chamada pública (sem token). */
  anonymous?: boolean;
  retries?: number;
}

/**
 * Cliente HTTP da API oficial do Mercado Livre:
 * - injeta e renova o access token automaticamente (inclusive após 401);
 * - respeita limite de taxa, com backoff exponencial em 429/5xx e falhas de rede;
 * - registra cada chamada em api_logs (sem segredos).
 */
export async function ml<T = any>(path: string, opts: MLRequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const maxRetries = opts.retries ?? (method === "GET" ? 4 : 1);
  const acc = opts.anonymous ? undefined : requireAccount();
  let triedRefresh = false;

  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
    if (acc) headers.authorization = `Bearer ${await accessToken(q.get<MLAccount>("SELECT * FROM ml_accounts WHERE id=?", [acc.id])!)}`;
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    await acquire();
    const started = Date.now();
    let res: Response;
    try {
      res = await transport.fetch(`${config.ml.apiBase}${path}`, { method, headers, body, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      release();
      logApi(method, path, 0, Date.now() - started, (e as Error).message);
      if (attempt < maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new IntegrationUnavailable(`Falha de comunicação com o Mercado Livre: ${(e as Error).message}`);
    }
    release();

    const text = await res.text();
    let data: any = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* resposta não-JSON */ }
    logApi(method, path, res.status, Date.now() - started, res.ok ? undefined : text.slice(0, 500));

    if (res.ok) return data as T;

    if (res.status === 401 && acc && !triedRefresh) {
      triedRefresh = true;
      q.run("UPDATE ml_accounts SET expires_at = ? WHERE id = ?", [new Date(0).toISOString(), acc.id]);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      continue;
    }
    throw new MLApiError(res.status, path.split("?")[0]!, data);
  }
}

const backoff = (attempt: number) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

/** Executa tarefas assíncronas com concorrência limitada. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

export const chunk = <T,>(arr: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
