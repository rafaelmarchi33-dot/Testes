import fs from "node:fs";
import path from "node:path";

/** Carrega um arquivo .env simples (KEY=VALUE) sem dependências externas. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), ".env"));

const env = (k: string, d = "") => process.env[k] ?? d;

export const config = {
  port: Number(env("PORT", "4000")),
  appUrl: env("APP_URL", "http://localhost:5173"),
  isProd: env("NODE_ENV") === "production",
  dataDir: path.resolve(env("DATA_DIR", "./data")),
  encryptionKey: env("ENCRYPTION_KEY"),
  ml: {
    clientId: env("ML_CLIENT_ID"),
    clientSecret: env("ML_CLIENT_SECRET"),
    redirectUri: env("ML_REDIRECT_URI", "http://localhost:4000/api/ml/oauth/callback"),
    siteId: env("ML_SITE_ID", "MLB"),
    authHost: env("ML_AUTH_HOST", "https://auth.mercadolivre.com.br"),
    apiBase: env("ML_API_BASE", "https://api.mercadolibre.com"),
    syncIntervalMinutes: Number(env("SYNC_INTERVAL_MINUTES", "15")),
  },
  ai: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("AI_MODEL", "claude-opus-5-5"),
  },
  backup: {
    intervalHours: Number(env("BACKUP_INTERVAL_HOURS", "24")),
    keep: Number(env("BACKUP_KEEP", "14")),
  },
};

export const mlConfigured = () => Boolean(config.ml.clientId && config.ml.clientSecret && config.ml.redirectUri);
export const aiConfigured = () => Boolean(config.ai.apiKey);

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "uploads"), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "backups"), { recursive: true });
