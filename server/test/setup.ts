// Ambiente isolado para testes: banco em memória e diretório temporário.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mli-test-"));
process.env.DATA_DIR = dir;
process.env.DB_FILE = ":memory:";
process.env.SILENT_LOGS = "1";
process.env.ML_CLIENT_ID = "123";
process.env.ML_CLIENT_SECRET = "secret";
process.env.ML_MIN_INTERVAL_MS = "0";

type Handler = (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** Instala um transporte HTTP falso para a API do Mercado Livre (uso exclusivo em testes). */
export async function mockMl(handler: Handler) {
  const { transport } = await import("../src/ml/client.ts");
  const calls: { url: string; method: string; body?: string }[] = [];
  transport.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    const r = handler(url, init) ?? { status: 404, body: { message: "not mocked" } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  };
  return calls;
}

export async function connectFakeAccount(expiresInSec = 21600) {
  const { saveTokens } = await import("../src/ml/client.ts");
  saveTokens({ access_token: "AT-1", refresh_token: "RT-1", expires_in: expiresInSec, user_id: 999, scope: "offline_access read write" });
}
