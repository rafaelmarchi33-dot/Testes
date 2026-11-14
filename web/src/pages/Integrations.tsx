import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Plug, RefreshCw, Unplug, CheckCircle2, XCircle, Bot, Database, Users, ScrollText, BellRing, Settings } from "lucide-react";
import { api, useApi } from "../lib/api.ts";
import { Card, PageHeader, Spinner, ErrorBox, Table, Badge, Tabs, Button, Field, Input, Select, Notice, Empty, ConfirmDialog, useToast } from "../components/ui.tsx";
import { dateTime, relative, int } from "../lib/format.ts";
import { useUser, isAdmin, canOperate } from "../components/Layout.tsx";

const RES: Record<string, string> = { reputation: "Reputação", listings: "Anúncios", orders: "Pedidos e envios", questions: "Perguntas", visits: "Visitas", ads: "Publicidade" };

function Connection() {
  const user = useUser();
  const [params] = useSearchParams();
  const ml = useApi<any>("/ml/oauth/status");
  const sys = useApi<any>("/system/status");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [disc, setDisc] = useState(false);
  const { toast, node } = useToast();
  const flash = params.get("ml");
  const acc = ml.data?.account;
  const sync = async (body: any, label: string) => {
    setBusy(label); setErr(null);
    try { await api("/sync", { body }); toast("Sincronização concluída"); sys.reload(); } catch (e) { setErr(e as Error); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6">
      {node}
      {flash === "connected" && <Notice>Conta conectada com sucesso. A importação inicial foi iniciada e pode levar alguns minutos.</Notice>}
      {flash === "error" && <ErrorBox error={new Error(params.get("msg") ?? "Falha na conexão")} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Plug className="size-4 text-brand" />Mercado Livre</span>} subtitle="OAuth 2.0 oficial com PKCE. Os tokens ficam criptografados no servidor e nunca chegam ao navegador.">
          {ml.loading ? <Spinner /> : (
            <div className="space-y-4 text-sm">
              {!ml.data?.configured && (
                <Notice tone="warn" title="Aplicativo não configurado.">Crie um aplicativo no DevCenter do Mercado Livre e defina ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI no arquivo .env do servidor. Veja docs/MERCADO_LIVRE.md.</Notice>
              )}
              {acc ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">{acc.status === "connected" ? <CheckCircle2 className="size-4 text-good" /> : <XCircle className="size-4 text-bad" />}<b>{acc.nickname ?? acc.id}</b><Badge tone={acc.status === "connected" ? "good" : "bad"}>{acc.status === "connected" ? "conectada" : "reautorização necessária"}</Badge></div>
                  <div className="text-xs text-ink-3">ID {acc.id} · site {acc.site_id} · token renova automaticamente (próxima expiração {dateTime(acc.expires_at)})</div>
                  {acc.scope && <div className="text-xs text-ink-3">Permissões: {acc.scope}</div>}
                  {acc.last_error && <p className="text-xs text-bad">{acc.last_error}</p>}
                </div>
              ) : <p className="text-ink-2">Nenhuma conta conectada.</p>}
              <div className="text-xs text-ink-3">URL de retorno (cadastre no DevCenter): <code className="rounded bg-surface-2 px-1">{ml.data?.redirectUri}</code></div>
              {isAdmin(user) && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" icon={<Plug className="size-4" />} disabled={!ml.data?.configured} loading={busy === "connect"} onClick={async () => {
                    setBusy("connect"); setErr(null);
                    try { window.location.href = (await api("/ml/oauth/start")).url; } catch (e) { setErr(e as Error); setBusy(null); }
                  }}>{acc ? "Reconectar" : "Conectar minha conta"}</Button>
                  {acc && <Button variant="ghost" icon={<Unplug className="size-4" />} onClick={() => setDisc(true)}>Desconectar</Button>}
                </div>
              )}
            </div>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><Bot className="size-4 text-brand" />Inteligência artificial</span>} subtitle="Modelos Claude (Anthropic) via API oficial.">
          {sys.data && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">{sys.data.ai_configured ? <CheckCircle2 className="size-4 text-good" /> : <XCircle className="size-4 text-bad" />}{sys.data.ai_configured ? "Configurada" : "Não configurada"}</div>
              <div className="text-xs text-ink-3">Modelo: {sys.data.ai_model}</div>
              {!sys.data.ai_configured && <Notice tone="warn">Defina ANTHROPIC_API_KEY no .env do servidor para habilitar o gerente de IA, a geração de anúncios e a análise de mercado.</Notice>}
            </div>
          )}
        </Card>
      </div>
      <ErrorBox error={err} />
      <Card title="Sincronização" subtitle="Incremental automática (a cada 15 min por padrão) + notificações em tempo real (webhook). Recursos sem permissão aparecem com erro explícito."
        action={acc && canOperate(user) && <div className="flex gap-2"><Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy === "inc"} onClick={() => sync({}, "inc")}>Sincronizar</Button><Button size="sm" loading={busy === "full"} onClick={() => sync({ full: true }, "full")}>Importação completa</Button></div>}>
        <Table rows={Object.keys(RES).map((r) => sys.data?.sync?.find((s: any) => s.resource === r) ?? { resource: r })} rowKey={(r: any) => r.resource}
          cols={[
            { key: "resource", header: "Recurso", render: (r: any) => <span className="font-medium">{RES[r.resource]}</span> },
            { key: "status", header: "Status", render: (r: any) => !r.status ? <Badge>nunca executado</Badge> : r.status === "ok" ? <Badge tone="good">ok</Badge> : r.status === "running" ? <Badge tone="info">executando</Badge> : <Badge tone="bad">erro</Badge> },
            { key: "last_success_at", header: "Último sucesso", render: (r: any) => <span className="text-xs">{relative(r.last_success_at)}</span> },
            { key: "processed", header: "Registros", align: "right", render: (r: any) => int(r.processed) },
            { key: "message", header: "Detalhe", render: (r: any) => <span className="text-xs text-bad">{r.message ?? ""}</span> },
          ]} />
        {sys.data?.data_gaps?.length > 0 && <div className="mt-4 space-y-1">{sys.data.data_gaps.map((g: string) => <Notice key={g} tone="warn">{g}</Notice>)}</div>}
        <p className="mt-3 text-[11px] text-ink-3">Webhook de notificações: configure no DevCenter a URL <code>{"{seu domínio}"}/api/ml/notifications</code> com os tópicos orders_v2, items, questions e shipments.</p>
      </Card>
      <ConfirmDialog open={disc} onClose={() => setDisc(false)} title="Desconectar Mercado Livre" danger confirmLabel="Desconectar" onConfirm={async () => { await api("/ml/oauth/disconnect", { body: {} }); ml.reload(); sys.reload(); }}>
        Os tokens de acesso serão apagados. Os dados já importados continuam disponíveis para relatórios.
      </ConfirmDialog>
    </div>
  );
}

function SettingsTab() {
  const user = useUser();
  const { data, error, reload } = useApi<any>("/settings");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error | null>(null);
  const { toast, node } = useToast();
  useEffect(() => { if (data) setF(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))); }, [data]);
  const fields: [string, string, string?][] = [
    ["target_margin_pct", "Margem-alvo (%)", "usada no preço recomendado"], ["min_margin_pct", "Margem mínima aceitável (%)", "abaixo disso gera alerta"],
    ["default_tax_rate_pct", "Impostos padrão (% da venda)"], ["monthly_fixed_costs", "Custos fixos mensais (R$)", "para ponto de equilíbrio"],
    ["labor_cost_per_hour", "Mão de obra (R$/hora)"], ["energy_kwh_price", "Energia (R$/kWh)"], ["stale_days", "Dias sem venda para alerta de anúncio parado"],
  ];
  return (
    <Card title="Parâmetros comerciais">
      {node}
      <ErrorBox error={error ?? err} />
      <fieldset disabled={!isAdmin(user)} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([k, l, h]) => <Field key={k} label={l} hint={h}><Input inputMode="decimal" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}
        <Field label="Tipo de anúncio padrão"><Select value={f.default_listing_type ?? "gold_special"} onChange={(e) => setF({ ...f, default_listing_type: e.target.value })}><option value="gold_special">Clássico</option><option value="gold_pro">Premium</option></Select></Field>
      </fieldset>
      {isAdmin(user) && <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={async () => {
        setBusy(true); setErr(null);
        try {
          const body: any = Object.fromEntries(fields.map(([k]) => [k, Number((f[k] ?? "0").replace(",", "."))]));
          body.default_listing_type = f.default_listing_type; body.stale_days = Math.round(body.stale_days);
          await api("/settings", { method: "PUT", body }); toast("Parâmetros salvos"); reload();
        } catch (e) { setErr(e as Error); } finally { setBusy(false); }
      }}>Salvar</Button></div>}
    </Card>
  );
}

function UsersTab() {
  const { data, error, reload } = useApi<any[]>("/users");
  const [f, setF] = useState({ name: "", email: "", password: "", role: "operator" });
  const [err, setErr] = useState<Error | null>(null);
  return (
    <div className="space-y-6">
      <Card title="Usuários e permissões" subtitle="Administrador: tudo, inclusive aprovar ações. Operador: prepara ações e edita dados. Leitura: apenas visualiza.">
        <ErrorBox error={error} />
        <Table rows={data ?? []} rowKey={(r) => r.id}
          cols={[
            { key: "name", header: "Nome", render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-[11px] text-ink-3">{r.email}</div></div> },
            { key: "role", header: "Papel", render: (r) => <Select className="h-8 w-36 text-xs" value={r.role} onChange={async (e) => { try { await api(`/users/${r.id}`, { method: "PATCH", body: { role: e.target.value } }); reload(); } catch (x) { setErr(x as Error); } }}><option value="admin">Administrador</option><option value="operator">Operador</option><option value="viewer">Leitura</option></Select> },
            { key: "last_login_at", header: "Último acesso", render: (r) => <span className="text-xs">{dateTime(r.last_login_at)}</span> },
            { key: "del", header: "", render: (r) => <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/users/${r.id}`, { method: "DELETE" }); reload(); } catch (x) { setErr(x as Error); } }}>Remover</Button> },
          ]} />
      </Card>
      <Card title="Adicionar usuário">
        <div className="grid gap-3 sm:grid-cols-4">
          <Input placeholder="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input placeholder="E-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Input placeholder="Senha (mín. 10)" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="admin">Administrador</option><option value="operator">Operador</option><option value="viewer">Leitura</option></Select>
        </div>
        <ErrorBox error={err} />
        <div className="mt-3 flex justify-end"><Button variant="primary" onClick={async () => { setErr(null); try { await api("/users", { body: f }); setF({ name: "", email: "", password: "", role: "operator" }); reload(); } catch (e) { setErr(e as Error); } }}>Adicionar</Button></div>
      </Card>
    </div>
  );
}

function NotificationsTab() {
  const { data, reload } = useApi<any[]>("/notification-channels");
  const [f, setF] = useState({ type: "email", target: "", min_severity: "warning" });
  const [err, setErr] = useState<Error | null>(null);
  return (
    <Card title="Canais de notificação externos" subtitle="Estrutura preparada: alertas são enfileirados por canal. O envio por e-mail/WhatsApp requer conectar um provedor (veja docs/ARQUITETURA.md).">
      <Notice tone="warn">Nenhum provedor de envio está configurado: os alertas aparecem dentro do sistema e ficam na fila para envio futuro. Nada é reportado como enviado.</Notice>
      <div className="mt-4"><Table rows={data ?? []} rowKey={(r) => r.id} empty={<Empty title="Nenhum canal cadastrado" />}
        cols={[{ key: "type", header: "Tipo" }, { key: "target", header: "Destino" }, { key: "min_severity", header: "Severidade mínima" }, { key: "enabled", header: "Ativo", render: (r) => (r.enabled ? "sim" : "não") }]} /></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="email">E-mail</option><option value="whatsapp">WhatsApp</option><option value="webhook">Webhook</option></Select>
        <Input placeholder="Destino" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
        <Select value={f.min_severity} onChange={(e) => setF({ ...f, min_severity: e.target.value })}><option value="critical">Crítico</option><option value="warning">Atenção</option><option value="opportunity">Oportunidade</option><option value="info">Todos</option></Select>
        <Button onClick={async () => { setErr(null); try { await api("/notification-channels", { body: { ...f, enabled: true } }); reload(); } catch (e) { setErr(e as Error); } }}>Adicionar canal</Button>
      </div>
      <ErrorBox error={err} />
    </Card>
  );
}

function AuditTab() {
  const audit = useApi<any[]>("/audit");
  const backups = useApi<any[]>("/backups");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-6">
      <Card title={<span className="flex items-center gap-2"><Database className="size-4" />Backups</span>} subtitle="Backup automático diário do banco (tokens permanecem criptografados). Guarde a chave ENCRYPTION_KEY separadamente."
        action={<Button size="sm" loading={busy} onClick={async () => { setBusy(true); try { await api("/backups", { body: {} }); backups.reload(); } finally { setBusy(false); } }}>Gerar backup agora</Button>}>
        <Table rows={(backups.data ?? []).slice(0, 10)} rowKey={(r) => r.file} empty={<Empty title="Nenhum backup ainda" />}
          cols={[{ key: "file", header: "Arquivo" }, { key: "size", header: "Tamanho", align: "right", render: (r) => `${(r.size / 1024 / 1024).toFixed(2)} MB` }]} />
      </Card>
      <Card title={<span className="flex items-center gap-2"><ScrollText className="size-4" />Log de auditoria</span>} subtitle="Todas as ações relevantes: logins, conexões, aprovações, publicações, alterações de custos e exportações.">
        {audit.loading ? <Spinner /> : (
          <Table rows={audit.data ?? []} rowKey={(r) => r.id}
            cols={[
              { key: "at", header: "Quando", render: (r) => <span className="text-xs whitespace-nowrap">{dateTime(r.at)}</span> },
              { key: "user_name", header: "Usuário", render: (r) => <span className="text-xs">{r.user_name ?? "sistema"}</span> },
              { key: "action", header: "Ação", render: (r) => <code className="text-xs">{r.action}</code> },
              { key: "entity", header: "Entidade", render: (r) => <span className="text-xs">{r.entity ? `${r.entity} ${r.entity_id ?? ""}` : "—"}</span> },
              { key: "details", header: "Detalhes", render: (r) => <span className="block max-w-[360px] truncate text-[11px] text-ink-3">{r.details ? JSON.stringify(r.details) : ""}</span> },
            ]} />
        )}
      </Card>
    </div>
  );
}

export default function Integrations() {
  const user = useUser();
  const [tab, setTab] = useState("conn");
  const items = [
    { value: "conn", label: <span className="flex items-center gap-1"><Plug className="size-3" />Integrações</span> },
    { value: "settings", label: <span className="flex items-center gap-1"><Settings className="size-3" />Parâmetros</span> },
    ...(isAdmin(user) ? [
      { value: "users", label: <span className="flex items-center gap-1"><Users className="size-3" />Usuários</span> },
      { value: "notif", label: <span className="flex items-center gap-1"><BellRing className="size-3" />Notificações</span> },
      { value: "audit", label: <span className="flex items-center gap-1"><ScrollText className="size-3" />Auditoria e backup</span> },
    ] : []),
  ];
  return (
    <>
      <PageHeader title="Integrações e ajustes" subtitle="Conexão com o Mercado Livre, IA, parâmetros, usuários e segurança." actions={<Tabs value={tab} onChange={setTab} items={items} />} />
      {tab === "conn" && <Connection />}
      {tab === "settings" && <SettingsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "notif" && <NotificationsTab />}
      {tab === "audit" && <AuditTab />}
    </>
  );
}
