import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PeriodValue } from "../components/ui.tsx";

/** Filtros globais compartilhados entre os módulos (período e canal). */
interface GlobalFilters { period: PeriodValue; setPeriod: (p: PeriodValue) => void; channel: string; setChannel: (c: string) => void; query: string }
const Ctx = createContext<GlobalFilters | null>(null);

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } };

export function GlobalProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PeriodValue>(() => load("m2m-period", { period: "30d" }));
  const [channel, setChannel] = useState<string>(() => load("m2m-channel", "all"));
  useEffect(() => save("m2m-period", period), [period]);
  useEffect(() => save("m2m-channel", channel), [channel]);
  const query = `period=${period.period}${period.period === "custom" && period.from && period.to ? `&from=${period.from}&to=${period.to}` : ""}&channel=${channel}`;
  return <Ctx.Provider value={{ period, setPeriod, channel, setChannel, query }}>{children}</Ctx.Provider>;
}
export const useGlobal = () => useContext(Ctx)!;

export const PERIODS = [
  { value: "today", label: "Hoje", compare: "vs. ontem" },
  { value: "7d", label: "7 dias", compare: "vs. 7 dias anteriores" },
  { value: "30d", label: "30 dias", compare: "vs. 30 dias anteriores" },
  { value: "month", label: "Mês atual", compare: "vs. mesmo período do mês anterior" },
  { value: "90d", label: "90 dias", compare: "vs. 90 dias anteriores" },
  { value: "custom", label: "Personalizado", compare: "vs. período anterior equivalente" },
];
export const CHANNELS = [{ value: "all", label: "Todos os canais" }, { value: "mercadolivre", label: "Mercado Livre" }, { value: "shopee", label: "Shopee" }];
