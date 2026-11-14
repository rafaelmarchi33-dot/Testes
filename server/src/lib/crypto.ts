import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

/**
 * Chave mestra AES-256-GCM. Em produção deve vir de ENCRYPTION_KEY (gerenciador de segredos).
 * Em desenvolvimento, é gerada uma vez e gravada em DATA_DIR/.master.key (permissão 600).
 */
function loadKey(): Buffer {
  if (config.encryptionKey) {
    const k = Buffer.from(config.encryptionKey, "base64");
    if (k.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes em base64");
    return k;
  }
  if (config.isProd) throw new Error("ENCRYPTION_KEY é obrigatória em produção");
  const file = path.join(config.dataDir, ".master.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
}
const KEY = loadKey();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Formato de dado criptografado inválido");
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** Par PKCE (RFC 7636) com método S256, suportado pelo OAuth do Mercado Livre. */
export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
