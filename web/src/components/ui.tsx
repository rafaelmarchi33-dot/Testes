import { useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Loader2, PlugZap, X } from "lucide-react";
import { Link } from "react-router";
import type { ApiError } from "../lib/api.ts";

export const cx = (...c: unknown[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, title, action, subtitle, pad = true }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,16,32,0.04)] animate-in", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-1">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] font-semibold text-ink">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx(pad && "p-5", pad && (title || action) && "pt-3")}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
export function Button({ variant = "secondary", size = "md", loading, icon, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand text-white font-semibold hover:bg-brand-2 shadow-[0_6px_18px_-8px_rgba(16,185,129,0.7)] dark:text-[#04130d]",
    secondary: "bg-surface border border-line text-ink hover:bg-surface-2",
    ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
    danger: "bg-bad text-white hover:opacity-90 dark:text-[#0b0b10]",
    success: "bg-good text-white hover:opacity-90 dark:text-[#0b0b10]",
  };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand whitespace-nowrap",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        styles[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const field = "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition";
/** Base dos campos; uma largura explícita (w-*) em className substitui o w-full padrão. */
const fieldCls = (c?: string) => (/(^|\s)w-/.test(c ?? "") ? field.replace("w-full ", "") : field);
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(fieldCls(p.className), "h-9", p.className)} />;
export const Select = ({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(fieldCls(p.className), "h-9 pr-8", p.className)}>{children}</select>;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(fieldCls(p.className), "py-2 min-h-24", p.className)} />;
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-3">{hint}</span>}
    </label>
  );
}

type Tone = "neutral" | "brand" | "good" | "warn" | "bad" | "info";
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t: Record<Tone, string> = {
    neutral: "bg-surface-2 text-ink-2", brand: "bg-brand-soft text-brand", good: "bg-good-soft text-good",
    warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", t[tone], className)}>{children}</span>;
}

export function Delta({ value, invert }: { value: number | null | undefined; invert?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-[11px] text-ink-3">sem base</span>;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={cx("inline-flex items-center text-[11px] font-medium num", good ? "text-good" : "text-bad")}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export function Stat({ label, value, delta, hint, icon, invert, tone }: { label: string; value: ReactNode; delta?: number | null; hint?: ReactNode; icon?: ReactNode; invert?: boolean; tone?: Tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 animate-in">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-3">{label}</span>
        {icon && <span className={cx("text-ink-3", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "good" && "text-good")}>{icon}</span>}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tracking-tight num leading-tight">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-h-4">
        {delta !== undefined && delta !== null && <Delta value={delta} invert={invert} />}
        {hint && <span className="text-[11px] leading-tight text-ink-3">{hint}</span>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
        <div className="mt-1.5 h-0.5 w-10 rounded-full bg-brand" />
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = "Carregando…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-3"><Loader2 className="size-4 animate-spin" /> {label}</div>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      {icon && <div className="mb-3 rounded-full bg-surface-2 p-3 text-ink-3">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-xs text-ink-3">{children}</div>}
    </div>
  );
}

/** Mostra erros da API; integrações indisponíveis aparecem como limitação explícita, não como sucesso. */
export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  const integ = (error as ApiError).code === "integration_unavailable";
  return (
    <div className={cx("flex items-start gap-3 rounded-xl border p-4 text-sm", integ ? "border-warn/30 bg-warn-soft" : "border-bad/30 bg-bad-soft")}>
      {integ ? <PlugZap className="mt-0.5 size-4 shrink-0 text-warn" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-bad" />}
      <div className="flex-1">
        <p className="font-medium text-ink">{integ ? "Integração indisponível" : "Não foi possível concluir"}</p>
        <p className="mt-0.5 text-ink-2">{error.message}</p>
        {integ && <Link to="/integracoes" className="mt-2 inline-block text-xs font-medium text-brand hover:underline">Ir para Integrações →</Link>}
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn"; title?: string; children: ReactNode }) {
  return (
    <div className={cx("flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs", tone === "warn" ? "border-warn/25 bg-warn-soft text-ink-2" : "border-info/20 bg-info-soft text-ink-2")}>
      <Info className={cx("mt-0.5 size-3.5 shrink-0", tone === "warn" ? "text-warn" : "text-info")} />
      <div>{title && <span className="font-medium text-ink">{title} </span>}{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" className={cx("w-full max-h-[92vh] overflow-auto rounded-t-2xl sm:rounded-2xl border border-line bg-surface shadow-2xl animate-in", wide ? "sm:max-w-3xl" : "sm:max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-2" aria-label="Fechar"><X className="size-4" /></button>
        </div>
        <div className="p-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs overflow-x-auto max-w-full">
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)} className={cx("rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition", value === i.value ? "bg-surface text-ink shadow-sm" : "text-ink-3 hover:text-ink")}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export interface PeriodValue { period: string; from?: string; to?: string }
export const periodQuery = (p: PeriodValue) => `period=${p.period}${p.period === "custom" && p.from && p.to ? `&from=${p.from}&to=${p.to}` : ""}`;

export function PeriodFilter({ value, onChange }: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [from, setFrom] = useState(value.from ?? "");
  const [to, setTo] = useState(value.to ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={value.period}
        onChange={(p) => onChange({ period: p, from, to })}
        items={[
          { value: "today", label: "Hoje" }, { value: "yesterday", label: "Ontem" }, { value: "7d", label: "7 dias" },
          { value: "30d", label: "30 dias" }, { value: "90d", label: "90 dias" }, { value: "custom", label: "Personalizado" },
        ]}
      />
      {value.period === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36 h-8" aria-label="De" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36 h-8" aria-label="Até" />
          <Button size="sm" variant="primary" disabled={!from || !to} onClick={() => onChange({ period: "custom", from, to })}>Aplicar</Button>
        </div>
      )}
    </div>
  );
}

export interface Col<T> { key: string; header: ReactNode; render?: (r: T) => ReactNode; className?: string; align?: "right" | "left" }
export function Table<T>({ rows, cols, rowKey, empty, onRowClick }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string | number; empty?: ReactNode; onRowClick?: (r: T) => void }) {
  if (!rows.length) return <>{empty ?? <Empty title="Nenhum registro" />}</>;
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-3">
            {cols.map((c) => <th key={c.key} className={cx("px-5 py-2 font-medium whitespace-nowrap", c.align === "right" && "text-right", c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx("border-b border-line/60 last:border-0 hover:bg-surface-2/60", onRowClick && "cursor-pointer")}>
              {cols.map((c) => <td key={c.key} className={cx("px-5 py-2.5 align-middle", c.align === "right" && "text-right num", c.className)}>{c.render ? c.render(r) : String((r as any)[c.key] ?? "—")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Thumb({ src, alt = "", size = 36 }: { src?: string | null; alt?: string; size?: number }) {
  return src
    ? <img src={src} alt={alt} loading="lazy" className="rounded-md border border-line object-cover bg-surface-2 shrink-0" style={{ width: size, height: size }} />
    : <div className="rounded-md border border-line bg-surface-2 shrink-0" style={{ width: size, height: size }} />;
}

/** Diálogo de confirmação explícita para ações que exigem aprovação. */
export function ConfirmDialog({ open, onClose, title, children, confirmLabel = "Confirmar", onConfirm, danger }: { open: boolean; onClose: () => void; title: string; children: ReactNode; confirmLabel?: string; onConfirm: () => Promise<void> | void; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await onConfirm(); onClose(); } catch (e) { setErr(e as Error); } finally { setBusy(false); }
        }}>{confirmLabel}</Button>
      </>}>
      <div className="space-y-3 text-sm text-ink-2">{children}<ErrorBox error={err} /></div>
    </Modal>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);
  const node = msg && (
    <div className={cx("fixed bottom-4 right-4 z-[60] rounded-lg px-4 py-2.5 text-sm shadow-lg animate-in", msg.tone === "good" ? "bg-ink text-bg" : "bg-bad text-white")}>{msg.text}</div>
  );
  return { toast: (text: string, tone: "good" | "bad" = "good") => setMsg({ text, tone }), node };
}

/** Bloco explícito de informação pendente (nunca preenchemos gráficos com dados fictícios). */
export function Pending({ title = "Informação pendente", children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</span>
      {children && <p className="max-w-sm text-xs text-ink-3">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Origem do dado: real (API/pedidos), importado, estimativa, derivado. */
export function SourceTag({ kind }: { kind: "api" | "orders" | "report" | "initial_import" | "import" | "estimate" | "derived" | "manual" | string }) {
  const map: Record<string, [string, Tone]> = {
    api: ["API", "good"], orders: ["Pedidos", "good"], report: ["Relatório importado", "info"], initial_import: ["Importação inicial", "info"],
    import: ["Importado", "info"], estimate: ["Estimativa", "warn"], derived: ["Derivado", "neutral"], manual: ["Manual", "neutral"], report_derived: ["Derivado do relatório", "neutral"],
  };
  const [label, tone] = map[kind] ?? [kind, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Baixa um arquivo da API (cookie de sessão) preservando o nome sugerido pelo servidor. */
export async function download(path: string) {
  const res = await fetch(`/api${path}`, { headers: { "X-Requested-With": "mli" }, credentials: "same-origin" });
  if (!res.ok) { const t = await res.json().catch(() => ({})); throw new Error(t.error ?? `Erro ${res.status}`); }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "relatorio";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function ExportButtons({ path, label = "Exportar" }: { path: string; label?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (fmt: string) => { setBusy(fmt); setErr(null); try { await download(`${path}${path.includes("?") ? "&" : "?"}format=${fmt}`); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };
  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-[11px] text-ink-3 sm:inline">{label}</span>
      <Button size="sm" loading={busy === "xlsx"} onClick={() => go("xlsx")}>Excel</Button>
      <Button size="sm" loading={busy === "pdf"} onClick={() => go("pdf")}>PDF</Button>
      {err && <span className="text-[11px] text-bad">{err}</span>}
    </div>
  );
}

export function NumInput({ value, onChange, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return <Input type="number" inputMode="decimal" step="any" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} {...p} />;
}

export function Kpi({ label, value, hint, delta, invert, source, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; delta?: number | null; invert?: boolean; source?: string; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className="group rounded-xl border border-line bg-surface p-4 transition hover:border-brand/30 animate-in">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
        {icon && <span className={cx("text-ink-3 [&_svg]:size-4", tone === "bad" && "text-bad", tone === "warn" && "text-warn", tone === "good" && "text-good")}>{icon}</span>}
      </div>
      <div className="mt-1.5 text-[22px] font-semibold tracking-tight num leading-tight">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 min-h-4">
        {delta !== undefined && delta !== null && <Delta value={delta} invert={invert} />}
        {hint && <span className="text-[11px] leading-tight text-ink-3">{hint}</span>}
        {source && <SourceTag kind={source} />}
      </div>
    </div>
  );
}
