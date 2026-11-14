import { config } from "../config.ts";
import { getAccount } from "../ml/client.ts";
import { runSync } from "../ml/sync.ts";
import { ensureCategoryNames } from "./metrics.ts";
import { runBackup } from "./backup.ts";
import { evaluateAlerts } from "./alerts.ts";
import { logger } from "../lib/logger.ts";
import { q } from "../db/index.ts";
import { aiConfigured } from "../config.ts";
import { generateDailyReport } from "../ai/manager.ts";
import { localDate } from "../lib/dates.ts";

/** Rotinas automáticas: sincronização incremental, alertas, relatório diário de IA, backup e limpeza de logs. */
export function startScheduler() {
  let syncing = false;
  const sync = async () => {
    if (syncing || !getAccount() || getAccount()!.status !== "connected") return;
    syncing = true;
    try {
      await runSync();
      await ensureCategoryNames();
    } catch (e) {
      logger.error("scheduled_sync_failed", { error: e });
    } finally {
      syncing = false;
    }
  };
  setTimeout(sync, 10_000);
  setInterval(sync, Math.max(5, config.ml.syncIntervalMinutes) * 60_000);

  setInterval(() => {
    try { evaluateAlerts(); } catch (e) { logger.error("alerts_eval_failed", { error: e }); }
  }, 30 * 60_000);

  // Relatório diário da IA às 07h (horário da loja), uma vez por dia.
  setInterval(async () => {
    const hourLocal = (new Date().getUTCHours() + 21) % 24; // UTC-3
    if (hourLocal < 7 || !aiConfigured() || !getAccount()) return;
    const today = localDate(new Date());
    const last = q.get<{ created_at: string }>("SELECT created_at FROM ai_reports WHERE kind='daily' ORDER BY id DESC LIMIT 1");
    if (last && localDate(last.created_at) === today) return;
    try { await generateDailyReport(null); } catch (e) { logger.error("daily_report_failed", { error: e }); }
  }, 15 * 60_000);

  setInterval(() => {
    try { runBackup(); } catch (e) { logger.error("backup_failed", { error: e }); }
  }, Math.max(1, config.backup.intervalHours) * 3_600_000);

  setInterval(() => {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    q.run("DELETE FROM api_logs WHERE at < ?", [cutoff]);
    q.run("DELETE FROM ml_notifications WHERE received_at < ?", [cutoff]);
    q.run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);
  }, 6 * 3_600_000);
}
