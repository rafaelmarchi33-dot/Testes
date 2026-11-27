import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate, useLocation, Link } from "react-router";
import {
  LayoutDashboard, Brain, Store, Truck, MessageCircleQuestion, Megaphone, Swords, Radar, FlaskConical, Sparkles, Factory, Boxes,
  Wallet, Target, FileUp, FileBarChart, Bell, CheckCheck, CalendarClock, Plug, Search, Sun, Moon, LogOut, Menu, X, RefreshCw,
  PanelLeftClose, PanelLeftOpen, ChevronDown, CalendarRange, BadgeDollarSign,
} from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { cx, Input, Button } from "./ui.tsx";
import { relative } from "../lib/format.ts";
import { BrandLockup, M2Mark } from "./Brand.tsx";
import { useGlobal, PERIODS, CHANNELS } from "../lib/global.tsx";

export interface User { id: number; name: string; email: string; role: "admin" | "operator" | "viewer" }
export const UserCtx = createContext<User | null>(null);
export const useUser = () => useContext(UserCtx)!;
export const canOperate = (u: User) => u.role !== "viewer";
export const isAdmin = (u: User) => u.role === "admin";

type BadgeKey = "alerts" | "actions";
const NAV: { group: string; items: { to: string; label: string; icon: ReactNode; badge?: BadgeKey }[] }[] = [
  { group: "Comando", items: [
    { to: "/", label: "Visão geral", icon: <LayoutDashboard /> },
    { to: "/mind", label: "Mind AI", icon: <Brain /> },
    { to: "/alertas", label: "Central de alertas", icon: <Bell />, badge: "alerts" },
    { to: "/aprovacoes", label: "Aprovações", icon: <CheckCheck />, badge: "actions" },
  ] },
  { group: "Comercial", items: [
    { to: "/seller", label: "Mercado Livre Seller", icon: <Store /> },
    { to: "/pedidos", label: "Pedidos", icon: <Truck /> },
    { to: "/perguntas", label: "Perguntas", icon: <MessageCircleQuestion /> },
    { to: "/marketing", label: "Anúncios e marketing", icon: <Megaphone /> },
    { to: "/concorrencia", label: "Concorrência", icon: <Swords /> },
  ] },
  { group: "Produto", items: [
    { to: "/radar", label: "Radar de produtos 3D", icon: <Radar /> },
    { to: "/laboratorio", label: "Laboratório", icon: <FlaskConical /> },
    { to: "/criar", label: "Criar anúncio (ML)", icon: <Sparkles /> },
  ] },
  { group: "Operação", items: [
    { to: "/fabrica", label: "Mind Factory", icon: <Factory /> },
    { to: "/estoque", label: "Estoque", icon: <Boxes /> },
  ] },
  { group: "Finanças e crescimento", items: [
    { to: "/financeiro", label: "Financeiro — CFO", icon: <Wallet /> },
    { to: "/rentabilidade", label: "Rentabilidade real", icon: <BadgeDollarSign /> },
    { to: "/metas", label: "Metas e crescimento", icon: <Target /> },
    { to: "/publicidade", label: "Publicidade (ML Ads)", icon: <Megaphone /> },
  ] },
  { group: "Dados", items: [
    { to: "/importacao", label: "Importação", icon: <FileUp /> },
    { to: "/relatorios", label: "Relatórios", icon: <FileBarChart /> },
  ] },
  { group: "Sistema", items: [
    { to: "/rotinas", label: "Rotinas da diretoria", icon: <CalendarClock /> },
    { to: "/integracoes", label: "Integrações e ajustes", icon: <Plug /> },
  ] },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("mli-theme", dark ? "dark" : "light"); } catch { /* armazenamento indisponível */ }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

const SEARCH_LABEL: Record<string, string> = { listing: "Anúncio", order: "Pedido", product: "Produto", lab: "Laboratório", opportunity: "Radar", competitor: "Concorrente", production: "Produção" };
function searchPath(r: any) {
  switch (r.type) {
    case "listing": return `/seller?id=${encodeURIComponent(r.id)}`;
    case "order": return `/pedidos?q=${r.id}`;
    case "lab": return `/laboratorio?id=${r.id}`;
    case "opportunity": return `/radar?id=${r.id}`;
    case "competitor": return "/concorrencia";
    case "production": return "/fabrica";
    default: return `/estoque?product=${r.id}`;
  }
}

function GlobalSearch() {
  const [qv, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => {
    if (qv.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api(`/search2?q=${encodeURIComponent(qv)}`).then((r) => { setRes(r); setSel(0); }).catch(() => setRes([])), 180);
    return () => clearTimeout(t);
  }, [qv]);
  const go = (r: any) => { setOpen(false); setQ(""); nav(searchPath(r)); };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
      <input
        ref={ref} value={qv} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(res.length - 1, s + 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          if (e.key === "Enter" && res[sel]) go(res[sel]);
        }}
        placeholder="Buscar anúncios, produtos, pedidos, laboratório…" aria-label="Busca global"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-14 text-sm placeholder:text-ink-3 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      <kbd className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-ink-3 sm:block">Ctrl K</kbd>
      {open && qv.trim().length >= 2 && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
          {res.length === 0 && <div className="px-3 py-3 text-xs text-ink-3">Nada encontrado para “{qv}”.</div>}
          {res.map((r, i) => (
            <button key={r.type + r.id} onMouseDown={() => go(r)} className={cx("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", i === sel ? "bg-surface-2" : "hover:bg-surface-2")}>
              <span className="w-20 shrink-0 text-[11px] text-ink-3">{SEARCH_LABEL[r.type] ?? r.type}</span>
              <span className="truncate">{r.label}</span>
              {r.extra && <span className="ml-auto shrink-0 text-[10px] text-ink-3">{r.extra}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Popover({ button, children, align = "right" }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h); window.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {button(open, () => setOpen((o) => !o))}
      {open && <div className={cx("absolute z-50 mt-2 rounded-xl border border-line bg-surface shadow-2xl animate-in", align === "right" ? "right-0" : "left-0")}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function PeriodSelector() {
  const g = useGlobal();
  const [from, setFrom] = useState(g.period.from ?? "");
  const [to, setTo] = useState(g.period.to ?? "");
  const cur = PERIODS.find((p) => p.value === g.period.period) ?? PERIODS[2]!;
  return (
    <Popover
      button={(open, toggle) => (
        <button onClick={toggle} aria-expanded={open} className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-medium hover:border-brand/40">
          <CalendarRange className="size-4 text-brand" />
          <span className="hidden sm:inline">{cur.value === "custom" && g.period.from ? `${g.period.from.split("-").reverse().join("/")} – ${g.period.to?.split("-").reverse().join("/")}` : cur.label}</span>
          <span className="hidden text-ink-3 md:inline">· {CHANNELS.find((c) => c.value === g.channel)?.label}</span>
          <ChevronDown className="size-3.5 text-ink-3" />
        </button>
      )}
    >
      {(close) => (
        <div className="w-72 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Período e comparação</div>
          <div className="grid grid-cols-2 gap-1">
            {PERIODS.filter((p) => p.value !== "custom").map((p) => (
              <button key={p.value} onClick={() => { g.setPeriod({ period: p.value }); close(); }} className={cx("rounded-md px-2 py-1.5 text-left text-xs", g.period.period === p.value ? "bg-brand-soft text-brand" : "hover:bg-surface-2")}>
                <div className="font-medium">{p.label}</div><div className="text-[10px] text-ink-3">{p.compare}</div>
              </button>
            ))}
          </div>
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Personalizado</div>
          <div className="mt-1 flex items-center gap-1.5">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-xs" aria-label="De" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 text-xs" aria-label="Até" />
          </div>
          <Button size="sm" variant="primary" className="mt-1.5 w-full" disabled={!from || !to} onClick={() => { g.setPeriod({ period: "custom", from, to }); close(); }}>Aplicar período</Button>
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Canal</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {CHANNELS.map((c) => (
              <button key={c.value} onClick={() => g.setChannel(c.value)} className={cx("rounded-md border px-2 py-1 text-xs", g.channel === c.value ? "border-brand/50 bg-brand-soft text-brand" : "border-line hover:bg-surface-2")}>{c.label}</button>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}

const SEV_DOT: Record<string, string> = { critical: "bg-bad", warning: "bg-warn", opportunity: "bg-brand", info: "bg-info" };
function Notifications({ count, onChange }: { count: number; onChange: () => void }) {
  const list = useApi<any[]>("/alerts?status=open", [count]);
  return (
    <Popover
      button={(open, toggle) => (
        <button onClick={toggle} aria-expanded={open} aria-label="Notificações" className="relative rounded-md p-2 text-ink-3 hover:bg-surface-2 hover:text-ink">
          <Bell className="size-4" />
          {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[9px] font-bold text-white num">{count > 99 ? "99+" : count}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="w-[min(92vw,380px)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Notificações</span>
            {count > 0 && <button className="text-[11px] text-brand hover:underline" onClick={async () => { await api("/alerts/read-all", { body: {} }); list.reload(); onChange(); }}>Marcar todas como lidas</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(list.data ?? []).length === 0 && <div className="px-4 py-8 text-center text-xs text-ink-3">Nenhum alerta em aberto.</div>}
            {(list.data ?? []).slice(0, 12).map((a) => (
              <Link key={a.id} to="/alertas" onClick={close} className="flex gap-2.5 border-b border-line/60 px-4 py-2.5 last:border-0 hover:bg-surface-2">
                <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", SEV_DOT[a.severity])} />
                <div className="min-w-0"><div className="truncate text-xs font-medium">{a.title}</div><div className="line-clamp-2 text-[11px] text-ink-3">{a.message}</div></div>
              </Link>
            ))}
          </div>
          <Link to="/alertas" onClick={close} className="block border-t border-line px-4 py-2 text-center text-xs font-medium text-brand hover:bg-surface-2">Abrir central de alertas</Link>
        </div>
      )}
    </Popover>
  );
}

const ROLE: Record<string, string> = { admin: "Administrador", operator: "Operador", viewer: "Leitura" };

export default function Layout({ user, onLogout }: { user: User; onLogout: () => void }) {
  const theme = useTheme();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("m2m-sidebar") === "1"; } catch { return false; } });
  const loc = useLocation();
  const status = useApi<any>("/system/status", [loc.pathname]);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => setMobile(false), [loc.pathname]);
  useEffect(() => { try { localStorage.setItem("m2m-sidebar", collapsed ? "1" : "0"); } catch { /* indisponível */ } }, [collapsed]);
  const badges: Record<BadgeKey, number> = { alerts: status.data?.open_alerts ?? 0, actions: status.data?.pending_actions ?? 0 };
  const lastSync = (status.data?.sync ?? []).map((s: any) => s.last_success_at).filter(Boolean).sort().at(-1);
  const syncErr = (status.data?.sync ?? []).some((s: any) => s.status === "error");

  const sidebar = (mini: boolean) => (
    <nav className="flex h-full flex-col">
      <div className="relative flex h-16 items-center border-b border-line px-4">
        {mini ? <M2Mark className="size-9" /> : <BrandLockup />}
        <div className="filament absolute inset-x-0 -bottom-px opacity-70" />
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3.5">
            {!mini && <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">{g.group}</div>}
            {mini && <div className="mx-2 mb-1.5 border-t border-line" />}
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} title={mini ? i.label : undefined} className={({ isActive }) => cx(
                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                mini && "justify-center",
                isActive ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}>
                {i.icon}
                {!mini && <span className="flex-1 truncate">{i.label}</span>}
                {i.badge && badges[i.badge] > 0 && (mini
                  ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-brand" />
                  : <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white num dark:text-[#04130d]">{badges[i.badge]}</span>)}
              </NavLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-line p-3">
        <div className={cx("flex items-center gap-2 rounded-lg px-1.5 py-1 text-[11px] text-ink-3", mini && "justify-center")} title={status.data?.account ? `Mercado Livre: ${status.data.account.nickname}` : "Mercado Livre desconectado"}>
          <span className={cx("size-2 shrink-0 rounded-full", !status.data?.account ? "bg-ink-3" : syncErr ? "bg-warn" : "bg-good")} />
          {!mini && (status.data?.account ? <span className="truncate">ML {status.data.account.nickname} · {relative(lastSync)}</span> : <span>Mercado Livre desconectado</span>)}
        </div>
        <button onClick={() => setCollapsed((c) => !c)} className={cx("mt-1 hidden w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-[11px] text-ink-3 hover:bg-surface-2 hover:text-ink lg:flex", mini && "justify-center")} aria-label={mini ? "Expandir menu" : "Recolher menu"}>
          {mini ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Recolher menu</>}
        </button>
      </div>
    </nav>
  );

  return (
    <UserCtx.Provider value={user}>
      <div className="flex h-full">
        <aside className={cx("hidden shrink-0 border-r border-line bg-surface transition-[width] duration-200 lg:block", collapsed ? "w-[68px]" : "w-64")}>{sidebar(collapsed)}</aside>
        {mobile && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobile(false)}>
            <div className="absolute inset-0 bg-black/50" />
            <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl animate-in" onClick={(e) => e.stopPropagation()}>{sidebar(false)}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur sm:gap-3 sm:px-4">
            <button className="rounded-md p-1.5 hover:bg-surface-2 lg:hidden" onClick={() => setMobile(true)} aria-label="Abrir menu">{mobile ? <X className="size-5" /> : <Menu className="size-5" />}</button>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-1">
              <PeriodSelector />
              {status.data?.account && (
                <button title="Sincronizar com o Mercado Livre" aria-label="Sincronizar agora" disabled={syncing}
                  onClick={async () => { setSyncing(true); try { await api("/sync", { body: {} }); } finally { setSyncing(false); status.reload(); } }}
                  className="rounded-md p-2 text-ink-3 hover:bg-surface-2 hover:text-ink">
                  <RefreshCw className={cx("size-4", syncing && "animate-spin")} />
                </button>
              )}
              <Notifications count={badges.alerts} onChange={status.reload} />
              <Popover
                button={(open, toggle) => (
                  <button onClick={toggle} aria-expanded={open} aria-label="Perfil" className="ml-1 flex items-center gap-2 rounded-lg p-1 hover:bg-surface-2">
                    <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{user.name.slice(0, 1).toUpperCase()}</span>
                    <span className="hidden text-left leading-tight xl:block"><span className="block text-xs font-medium">{user.name}</span><span className="block text-[10px] text-ink-3">{ROLE[user.role]}</span></span>
                  </button>
                )}
              >
                {(close) => (
                  <div className="w-60 p-1.5">
                    <div className="px-2.5 py-2"><div className="text-sm font-medium">{user.name}</div><div className="truncate text-[11px] text-ink-3">{user.email}</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-brand">{ROLE[user.role]}</div></div>
                    <div className="my-1 border-t border-line" />
                    <button onClick={theme.toggle} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-surface-2">{theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />} Tema {theme.dark ? "claro" : "Emerald Night"}</button>
                    <Link to="/integracoes" onClick={close} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-surface-2"><Plug className="size-4" /> Integrações e usuários</Link>
                    <Link to="/aprovacoes" onClick={close} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-surface-2"><CheckCheck className="size-4" /> Aprovações e histórico</Link>
                    <button onClick={onLogout} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-bad hover:bg-bad-soft"><LogOut className="size-4" /> Sair</button>
                  </div>
                )}
              </Popover>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </UserCtx.Provider>
  );
}
