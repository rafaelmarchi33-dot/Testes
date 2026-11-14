import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router";
import {
  LayoutDashboard, Bot, Package, Sparkles, Telescope, Wallet, Boxes, Megaphone, Truck, MessageCircleQuestion, Bell, CheckCheck,
  FileBarChart, Plug, Search, Sun, Moon, LogOut, Menu, X, RefreshCw,
} from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { cx } from "./ui.tsx";
import { relative } from "../lib/format.ts";

export interface User { id: number; name: string; email: string; role: "admin" | "operator" | "viewer" }
export const UserCtx = createContext<User | null>(null);
export const useUser = () => useContext(UserCtx)!;
export const canOperate = (u: User) => u.role !== "viewer";
export const isAdmin = (u: User) => u.role === "admin";

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode; badge?: "alerts" | "actions" | "questions" }[] }[] = [
  { group: "Visão geral", items: [
    { to: "/", label: "Dashboard", icon: <LayoutDashboard /> },
    { to: "/assistente", label: "Gerente IA", icon: <Bot /> },
    { to: "/alertas", label: "Alertas", icon: <Bell />, badge: "alerts" },
    { to: "/aprovacoes", label: "Aprovações", icon: <CheckCheck />, badge: "actions" },
  ] },
  { group: "Operação", items: [
    { to: "/anuncios", label: "Anúncios", icon: <Package /> },
    { to: "/criar", label: "Criar anúncio", icon: <Sparkles /> },
    { to: "/pedidos", label: "Pedidos", icon: <Truck /> },
    { to: "/perguntas", label: "Perguntas", icon: <MessageCircleQuestion /> },
    { to: "/estoque", label: "Estoque e produção", icon: <Boxes /> },
  ] },
  { group: "Inteligência", items: [
    { to: "/financeiro", label: "Financeiro", icon: <Wallet /> },
    { to: "/publicidade", label: "Publicidade", icon: <Megaphone /> },
    { to: "/mercado", label: "Oportunidades", icon: <Telescope /> },
    { to: "/relatorios", label: "Relatórios", icon: <FileBarChart /> },
  ] },
  { group: "Sistema", items: [{ to: "/integracoes", label: "Integrações e ajustes", icon: <Plug /> }] },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("mli-theme", dark ? "dark" : "light"); } catch { /* armazenamento indisponível */ }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function GlobalSearch() {
  const [qv, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (qv.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api(`/search?q=${encodeURIComponent(qv)}`).then(setRes).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [qv]);
  const go = (r: any) => {
    setOpen(false); setQ("");
    const path = r.type === "listing" ? `/anuncios?id=${r.id}` : r.type === "order" ? `/pedidos?q=${r.id}` : r.type === "draft" ? `/criar?draft=${r.id}` : `/estoque?product=${r.id}`;
    nav(path);
  };
  const label: Record<string, string> = { listing: "Anúncio", order: "Pedido", product: "Produto", draft: "Rascunho" };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
      <input
        ref={ref} value={qv} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar anúncios, pedidos, produtos…" aria-label="Busca global"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-12 text-sm placeholder:text-ink-3 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-ink-3 hidden sm:block">Ctrl K</kbd>
      {open && res.length > 0 && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
          {res.map((r) => (
            <button key={r.type + r.id} onMouseDown={() => go(r)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
              <span className="w-16 shrink-0 text-[11px] text-ink-3">{label[r.type]}</span>
              <span className="truncate">{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const theme = useTheme();
  const [mobile, setMobile] = useState(false);
  const loc = useLocation();
  const status = useApi<any>("/system/status", [loc.pathname]);
  useEffect(() => setMobile(false), [loc.pathname]);
  const badges = { alerts: status.data?.open_alerts ?? 0, actions: status.data?.pending_actions ?? 0, questions: 0 };
  const lastSync = (status.data?.sync ?? []).map((s: any) => s.last_success_at).filter(Boolean).sort().at(-1);
  const syncErr = (status.data?.sync ?? []).some((s: any) => s.status === "error");

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-line">
        <div className="grid size-8 place-items-center rounded-lg bg-brand text-white dark:text-[#0b0b10]">
          <svg viewBox="0 0 32 32" className="size-5"><path d="M7 23V9l9 8 9-8v14" stroke="currentColor" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">Mercado Livre</div>
          <div className="text-[10px] font-semibold tracking-[0.18em] text-brand">INTELLIGENCE</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-4">
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{g.group}</div>
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => cx(
                "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors [&_svg]:size-4",
                isActive ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}>
                {i.icon}
                <span className="flex-1">{i.label}</span>
                {i.badge && badges[i.badge] > 0 && <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white dark:text-[#0b0b10] num">{badges[i.badge]}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[11px] text-ink-3">
          <span className={cx("size-2 rounded-full", !status.data?.account ? "bg-ink-3" : syncErr ? "bg-warn" : "bg-good")} />
          {status.data?.account ? <span className="truncate">{status.data.account.nickname} · sinc. {relative(lastSync)}</span> : <span>Mercado Livre desconectado</span>}
        </div>
        <div className="mt-2 flex items-center gap-2 px-1.5">
          <div className="grid size-7 place-items-center rounded-full bg-surface-2 text-[11px] font-semibold">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-medium">{user.name}</div>
            <div className="text-[10px] text-ink-3">{{ admin: "Administrador", operator: "Operador", viewer: "Leitura" }[user.role]}</div>
          </div>
          <button onClick={onLogout} title="Sair" aria-label="Sair" className="rounded-md p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"><LogOut className="size-4" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <UserCtx.Provider value={user}>
      <div className="flex h-full">
        <aside className="hidden lg:block w-60 shrink-0 border-r border-line bg-surface">{sidebar}</aside>
        {mobile && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobile(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-xl animate-in" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur">
            <button className="lg:hidden rounded-md p-1.5 hover:bg-surface-2" onClick={() => setMobile(true)} aria-label="Menu">{mobile ? <X className="size-5" /> : <Menu className="size-5" />}</button>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-1">
              {status.data?.account && (
                <button title="Sincronizar agora" aria-label="Sincronizar agora" onClick={() => api("/sync", { body: {} }).finally(() => status.reload())} className="rounded-md p-2 text-ink-3 hover:bg-surface-2 hover:text-ink">
                  <RefreshCw className="size-4" />
                </button>
              )}
              <button onClick={theme.toggle} title="Alternar tema" aria-label="Alternar tema" className="rounded-md p-2 text-ink-3 hover:bg-surface-2 hover:text-ink">
                {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </UserCtx.Provider>
  );
}
