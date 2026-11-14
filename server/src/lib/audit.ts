import { q, json } from "../db/index.ts";

/** Registro imutável de auditoria: quem fez o quê, quando e com quais dados. */
export function audit(
  userId: number | null | undefined,
  action: string,
  entity?: string,
  entityId?: string | number | null,
  details?: unknown,
  ip?: string,
) {
  q.run("INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)", [
    userId ?? null,
    action,
    entity ?? null,
    entityId == null ? null : String(entityId),
    json.str(details),
    ip ?? null,
  ]);
}
