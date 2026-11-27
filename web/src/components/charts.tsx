import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, LineChart, Line, Legend } from "recharts";
import { brl, brlShort, dayShort, int } from "../lib/format.ts";

const axis = { stroke: "var(--color-ink-3)", fontSize: 11, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />;

function Tip({ active, payload, label, money = true, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-ink">{labelFmt ? labelFmt(label, payload) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="ml-auto font-medium text-ink num">{money ? brl(p.value) : int(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function RevenueTrend({ data }: { data: { date: string; revenue: number; prev_revenue: number; prev_date?: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey="date" tickFormatter={dayShort} {...axis} minTickGap={24} />
        <YAxis tickFormatter={(v) => brlShort(v)} {...axis} width={70} />
        <Tooltip content={<Tip labelFmt={(l: string, p: any[]) => `${dayShort(l)} (anterior: ${p[0]?.payload?.prev_date ? dayShort(p[0].payload.prev_date) : "—"})`} />} />
        <Area type="monotone" dataKey="prev_revenue" name="Período anterior" stroke="var(--color-ink-3)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="revenue" name="Faturamento" stroke="var(--color-brand)" fill="url(#rev)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBars({ data }: { data: { month: string; revenue: number; orders: number }[] }) {
  const label = (m: string) => new Date(m + "-15").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey="month" tickFormatter={label} {...axis} />
        <YAxis tickFormatter={(v) => brlShort(v)} {...axis} width={70} />
        <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<Tip labelFmt={label} />} />
        <Bar dataKey="revenue" name="Faturamento" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((_, i) => <Cell key={i} fill={i === data.length - 1 ? "var(--color-brand)" : "var(--color-brand-2)"} fillOpacity={i === data.length - 1 ? 1 : 0.45} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Barras horizontais com rótulo; usada para produto, categoria e lucro. */
export function HBars({ data, labelKey, valueKey, money = true, color = "var(--color-brand)", negativeColor = "var(--color-bad)" }: { data: any[]; labelKey: string; valueKey: string; money?: boolean; color?: string; negativeColor?: string }) {
  const max = Math.max(...data.map((d) => Math.abs(d[valueKey] ?? 0)), 1);
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const v = d[valueKey] ?? 0;
        return (
          <div key={i} className="text-xs">
            <div className="mb-1 flex justify-between gap-3">
              <span className="truncate text-ink-2" title={d[labelKey]}>{d[labelKey] ?? "—"}</span>
              <span className="shrink-0 font-medium num">{money ? brl(v) : int(v)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-2">
              <div className="h-1.5 rounded-full transition-all" style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? negativeColor : color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SmallLine({ data, keys }: { data: any[]; keys: { key: string; name: string; color: string; money?: boolean }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey="date" tickFormatter={dayShort} {...axis} minTickGap={24} />
        <YAxis {...axis} width={60} tickFormatter={(v) => (keys[0]?.money ? brlShort(v) : int(v))} />
        <Tooltip content={<Tip money={!!keys[0]?.money} labelFmt={dayShort} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {keys.map((k) => <Line key={k.key} type="monotone" dataKey={k.key} name={k.name} stroke={k.color} strokeWidth={2} dot={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Barras verticais genéricas (semanal, mensal com relatório importado, cenários). */
export function Bars({ data, xKey, bars, xFmt, money = true, height = 240 }: { data: any[]; xKey: string; bars: { key: string; name: string; color: string; stack?: string }[]; xFmt?: (v: any) => string; money?: boolean; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey={xKey} tickFormatter={xFmt} {...axis} minTickGap={8} />
        <YAxis tickFormatter={(v) => (money ? brlShort(v) : int(v))} {...axis} width={70} />
        <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<Tip money={money} labelFmt={xFmt} />} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {bars.map((b) => <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} stackId={b.stack} radius={[4, 4, 0, 0]} maxBarSize={38} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Evolução da meta: acumulado real x trajetória linear x projeção. */
export function GoalChart({ data, goal }: { data: { date: string; actual: number | null; target: number; projected: number | null }[]; goal: number }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="goalA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis dataKey="date" tickFormatter={dayShort} {...axis} minTickGap={24} />
        <YAxis tickFormatter={(v) => brlShort(v)} {...axis} width={70} domain={[0, Math.max(goal, ...data.map((d) => d.projected ?? 0))]} />
        <Tooltip content={<Tip labelFmt={dayShort} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="target" name="Trajetória da meta" stroke="var(--color-chart-2)" strokeDasharray="4 4" fill="none" strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="projected" name="Projeção (estimativa)" stroke="var(--color-warn)" strokeDasharray="2 3" fill="none" strokeWidth={1.5} dot={false} connectNulls />
        <Area type="monotone" dataKey="actual" name="Faturamento acumulado" stroke="var(--color-brand)" fill="url(#goalA)" strokeWidth={2} dot={false} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Investimento x retorno (publicidade). */
export function AdsReturn({ data }: { data: { date: string; cost: number; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        {grid}
        <XAxis dataKey="date" tickFormatter={dayShort} {...axis} minTickGap={20} />
        <YAxis tickFormatter={(v) => brlShort(v)} {...axis} width={70} />
        <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<Tip labelFmt={dayShort} />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="cost" name="Investimento" fill="var(--color-warn)" radius={[3, 3, 0, 0]} maxBarSize={18} />
        <Bar dataKey="revenue" name="Receita atribuída" fill="var(--color-brand)" radius={[3, 3, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Anel de progresso (meta mensal). */
export function Ring({ pct, size = 132, label }: { pct: number | null; size?: number; label?: string }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${v.toFixed(0)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={10} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-brand)" strokeWidth={10} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dasharray .6s ease" }} />
      <text x="50%" y="48%" textAnchor="middle" fontSize={size / 5.2} fontWeight={600} fill="var(--color-ink)" style={{ fontVariantNumeric: "tabular-nums" }}>{pct === null ? "—" : `${pct.toFixed(1)}%`}</text>
      <text x="50%" y="64%" textAnchor="middle" fontSize={10} fill="var(--color-ink-3)">da meta</text>
    </svg>
  );
}
