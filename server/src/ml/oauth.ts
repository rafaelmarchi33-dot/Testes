import { Router } from "express";
import { config, mlConfigured } from "../config.ts";
import { q } from "../db/index.ts";
import { encrypt, decrypt, pkcePair, randomToken } from "../lib/crypto.ts";
import { ah, HttpError } from "../lib/errors.ts";
import { audit } from "../lib/audit.ts";
import { requireRole } from "../auth/index.ts";
import { tokenRequest, saveTokens, ml, getAccount } from "./client.ts";
import { runSync } from "./sync.ts";
import { logger } from "../lib/logger.ts";

export const oauthRouter = Router();

/** Inicia o fluxo OAuth 2.0 (Authorization Code + PKCE S256). Somente administradores. */
oauthRouter.get(
  "/start",
  requireRole("admin"),
  ah((req, res) => {
    if (!mlConfigured()) throw new HttpError(400, "Configure ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI no servidor antes de conectar.", "ml_not_configured");
    const state = randomToken(24);
    const { verifier, challenge } = pkcePair();
    q.run("DELETE FROM oauth_states WHERE created_at < ?", [new Date(Date.now() - 15 * 60_000).toISOString()]);
    q.run("INSERT INTO oauth_states (state, code_verifier_enc, user_id) VALUES (?,?,?)", [state, encrypt(verifier), req.user!.id]);
    const url = new URL(`${config.ml.authHost}/authorization`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.ml.clientId,
      redirect_uri: config.ml.redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    audit(req.user!.id, "ml.oauth_start", "ml_account", null, null, req.ip);
    res.json({ url: url.toString() });
  }),
);

/** Callback cadastrado no DevCenter. Troca o código por tokens e inicia a importação. */
oauthRouter.get(
  "/callback",
  ah(async (req, res) => {
    const back = (status: string, msg?: string) =>
      res.redirect(`${config.appUrl}/integracoes?ml=${status}${msg ? `&msg=${encodeURIComponent(msg)}` : ""}`);
    const { code, state, error } = req.query as Record<string, string | undefined>;
    if (error) return back("error", `Autorização negada: ${error}`);
    if (!code || !state) return back("error", "Resposta do Mercado Livre incompleta");
    const st = q.get<{ code_verifier_enc: string; user_id: number; created_at: string }>("SELECT * FROM oauth_states WHERE state = ?", [state]);
    q.run("DELETE FROM oauth_states WHERE state = ?", [state]);
    if (!st || Date.parse(st.created_at) < Date.now() - 15 * 60_000) return back("error", "Sessão de autorização expirada. Tente novamente.");
    try {
      const t = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.ml.redirectUri,
        code_verifier: decrypt(st.code_verifier_enc),
      });
      saveTokens(t, { userId: st.user_id });
      const me = await ml<{ id: number; nickname: string; site_id: string; email?: string }>("/users/me");
      q.run("UPDATE ml_accounts SET nickname=?, site_id=?, email=? WHERE id=?", [me.nickname, me.site_id, me.email ?? null, me.id]);
      audit(st.user_id, "ml.connected", "ml_account", me.id, { nickname: me.nickname, scope: t.scope });
      runSync({ full: true }).catch((e) => logger.error("initial_sync_failed", { error: e }));
      return back("connected");
    } catch (e) {
      logger.error("ml_oauth_callback_failed", { error: e });
      return back("error", (e as Error).message);
    }
  }),
);

oauthRouter.get("/status", requireRole("viewer"), (_req, res) => {
  const acc = getAccount();
  res.json({
    configured: mlConfigured(),
    redirectUri: config.ml.redirectUri,
    account: acc
      ? { id: acc.id, nickname: acc.nickname, site_id: acc.site_id, status: acc.status, scope: acc.scope, expires_at: acc.expires_at, last_error: acc.last_error }
      : null,
  });
});

oauthRouter.post(
  "/disconnect",
  requireRole("admin"),
  ah((req, res) => {
    const acc = getAccount();
    if (!acc) throw new HttpError(404, "Nenhuma conta conectada");
    // Tokens são apagados; dados históricos importados permanecem para relatórios.
    q.run("UPDATE ml_accounts SET status='disconnected', access_token_enc='', refresh_token_enc='' WHERE id=?", [acc.id]);
    audit(req.user!.id, "ml.disconnected", "ml_account", acc.id, null, req.ip);
    res.json({ ok: true });
  }),
);
