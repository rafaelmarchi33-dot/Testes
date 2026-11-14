import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { q } from "../db/index.ts";
import { hashPassword, verifyPassword, randomToken, sha256 } from "../lib/crypto.ts";
import { HttpError, ah } from "../lib/errors.ts";
import { audit } from "../lib/audit.ts";
import { config } from "../config.ts";

export type Role = "admin" | "operator" | "viewer";
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const COOKIE = "mli_session";
const SESSION_DAYS = 7;

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res: Response, token: string, maxAgeSec: number) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (config.isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function createSession(res: Response, userId: number, req: Request) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  q.run("INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)", [
    sha256(token), userId, expires, req.ip ?? null, String(req.headers["user-agent"] ?? "").slice(0, 200),
  ]);
  setSessionCookie(res, token, SESSION_DAYS * 86400);
}

/** Carrega o usuário da sessão (se houver). Não bloqueia. */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = q.get<SessionUser & { expires_at: string }>(
      `SELECT u.id, u.email, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
      [sha256(token)],
    );
    if (row && row.expires_at > new Date().toISOString()) {
      req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
    }
  }
  next();
}

/**
 * Proteção CSRF: requisições que alteram estado precisam do cabeçalho X-Requested-With,
 * que formulários de outros sites não conseguem enviar sem CORS (somado a SameSite=Lax).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path.startsWith("/api/ml/notifications")) return next(); // webhook do Mercado Livre
  if (req.headers["x-requested-with"] !== "mli") return next(new HttpError(403, "Requisição bloqueada (CSRF)", "csrf"));
  next();
}

const rank: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

/** Exige autenticação e papel mínimo. admin > operator > viewer. */
export const requireRole =
  (min: Role = "viewer") =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Faça login para continuar", "unauthenticated"));
    if (rank[req.user.role] < rank[min]) return next(new HttpError(403, "Permissão insuficiente", "forbidden"));
    next();
  };

// Limitador simples de tentativas de login por IP+email (memória).
const attempts = new Map<string, { n: number; until: number }>();
function checkRate(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.n >= 5) throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos.", "rate_limited");
}
function failRate(key: string) {
  const a = attempts.get(key);
  const until = Date.now() + 15 * 60_000;
  attempts.set(key, { n: a && a.until > Date.now() ? a.n + 1 : 1, until });
}

const passwordSchema = z.string().min(10, "A senha deve ter ao menos 10 caracteres").max(200);

export const authRouter = Router();

authRouter.get("/status", (req, res) => {
  const users = q.get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n;
  res.json({ needsSetup: users === 0, user: req.user ?? null });
});

/** Cria o primeiro administrador (somente quando não existe nenhum usuário). */
authRouter.post(
  "/setup",
  ah((req, res) => {
    const body = z.object({ name: z.string().min(2).max(100), email: z.email(), password: passwordSchema }).parse(req.body);
    const created = q.tx(() => {
      if (q.get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n > 0) return null;
      return q.run("INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?, 'admin')", [
        body.email, body.name, hashPassword(body.password),
      ]);
    });
    if (!created) throw new HttpError(409, "Configuração inicial já realizada", "already_setup");
    const id = Number(created.lastInsertRowid);
    audit(id, "user.setup_admin", "user", id, { email: body.email }, req.ip);
    createSession(res, id, req);
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/login",
  ah((req, res) => {
    const body = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(req.body);
    const key = `${req.ip}|${body.email.toLowerCase()}`;
    checkRate(key);
    const user = q.get<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", [body.email]);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      failRate(key);
      audit(user?.id, "auth.login_failed", "user", user?.id, { email: body.email }, req.ip);
      throw new HttpError(401, "E-mail ou senha inválidos", "invalid_credentials");
    }
    attempts.delete(key);
    q.run("UPDATE users SET last_login_at = ? WHERE id = ?", [new Date().toISOString(), user.id]);
    q.run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);
    createSession(res, user.id, req);
    audit(user.id, "auth.login", "user", user.id, null, req.ip);
    res.json({ ok: true });
  }),
);

authRouter.post("/logout", (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
  setSessionCookie(res, "", 0);
  res.json({ ok: true });
});

authRouter.post(
  "/password",
  requireRole("viewer"),
  ah((req, res) => {
    const body = z.object({ current: z.string(), next: passwordSchema }).parse(req.body);
    const row = q.get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [req.user!.id])!;
    if (!verifyPassword(body.current, row.password_hash)) throw new HttpError(400, "Senha atual incorreta");
    q.run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(body.next), req.user!.id]);
    q.run("DELETE FROM sessions WHERE user_id = ?", [req.user!.id]);
    createSession(res, req.user!.id, req);
    audit(req.user!.id, "auth.password_changed", "user", req.user!.id, null, req.ip);
    res.json({ ok: true });
  }),
);

// ---- Gestão de usuários (somente admin) ----
export const usersRouter = Router();
usersRouter.use(requireRole("admin"));

usersRouter.get("/", (_req, res) => {
  res.json(q.all("SELECT id, email, name, role, created_at, last_login_at FROM users ORDER BY id"));
});

usersRouter.post(
  "/",
  ah((req, res) => {
    const body = z
      .object({ name: z.string().min(2), email: z.email(), password: passwordSchema, role: z.enum(["admin", "operator", "viewer"]) })
      .parse(req.body);
    if (q.get("SELECT 1 FROM users WHERE email = ?", [body.email])) throw new HttpError(409, "E-mail já cadastrado");
    const r = q.run("INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)", [
      body.email, body.name, hashPassword(body.password), body.role,
    ]);
    audit(req.user!.id, "user.create", "user", Number(r.lastInsertRowid), { email: body.email, role: body.role }, req.ip);
    res.json({ id: Number(r.lastInsertRowid) });
  }),
);

usersRouter.patch(
  "/:id",
  ah((req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ role: z.enum(["admin", "operator", "viewer"]) }).parse(req.body);
    if (id === req.user!.id && body.role !== "admin") throw new HttpError(400, "Você não pode remover seu próprio acesso de administrador");
    q.run("UPDATE users SET role = ? WHERE id = ?", [body.role, id]);
    audit(req.user!.id, "user.role_change", "user", id, body, req.ip);
    res.json({ ok: true });
  }),
);

usersRouter.delete(
  "/:id",
  ah((req, res) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, "Você não pode excluir a si mesmo");
    q.run("DELETE FROM users WHERE id = ?", [id]);
    audit(req.user!.id, "user.delete", "user", id, null, req.ip);
    res.json({ ok: true });
  }),
);
