import { q, json } from "../db/index.ts";
import { config } from "../config.ts";
import { ml, MLApiError } from "./client.ts";
import { IntegrationUnavailable } from "../lib/errors.ts";
import { addDays, localDate } from "../lib/dates.ts";

/**
 * Publicidade (Mercado Ads — Product Ads). Somente leitura.
 * Requer que a conta tenha Product Ads ativo e que o app tenha permissão de publicidade.
 * Quando não houver acesso, o erro é registrado no estado de sincronização e a UI exibe a limitação.
 */
const METRICS = "clicks,prints,cost,cpc,ctr,acos,roas,direct_amount,indirect_amount,total_amount,units_quantity";

export async function getAdvertiser(): Promise<{ advertiser_id: string; site_id: string } | null> {
  try {
    const r = await ml<{ advertisers: { advertiser_id: number | string; site_id: string }[] }>(
      "/advertising/advertisers?product_id=PADS",
      { headers: { "Api-Version": "1" } },
    );
    const adv = (r.advertisers ?? []).find((a) => a.site_id === config.ml.siteId) ?? r.advertisers?.[0];
    return adv ? { advertiser_id: String(adv.advertiser_id), site_id: adv.site_id } : null;
  } catch (e) {
    if (e instanceof MLApiError && [401, 403, 404].includes(e.mlStatus)) return null;
    throw e;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v == null ? null : Number(v) || 0);

export async function syncAds(accountId: number) {
  const adv = await getAdvertiser();
  if (!adv) {
    throw new IntegrationUnavailable(
      "Publicidade indisponível: a conta não possui Product Ads ativo ou o aplicativo não tem permissão de leitura de publicidade.",
    );
  }
  const dateTo = localDate(new Date());
  const dateFrom = addDays(dateTo, -29);
  let processed = 0;

  // Campanhas com métricas agregadas do período
  for (let offset = 0; offset < 1000; offset += 50) {
    const qs = new URLSearchParams({ limit: "50", offset: String(offset), date_from: dateFrom, date_to: dateTo, metrics: METRICS });
    const r = await ml<{ results: any[]; paging?: { total: number } }>(
      `/advertising/${adv.site_id}/advertisers/${adv.advertiser_id}/product_ads/campaigns/search?${qs}`,
      { headers: { "api-version": "2" } },
    );
    for (const c of r.results ?? []) {
      q.run(
        `INSERT INTO ads_campaigns (id, account_id, advertiser_id, name, status, budget, strategy, acos_target, raw, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status, budget=excluded.budget, strategy=excluded.strategy,
           acos_target=excluded.acos_target, raw=excluded.raw, synced_at=excluded.synced_at`,
        [String(c.id), accountId, adv.advertiser_id, c.name, c.status, num(c.budget), c.strategy ?? null, num(c.acos_target), JSON.stringify(c), new Date().toISOString()],
      );
      processed++;
      // Série diária da campanha
      try {
        const dqs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, metrics: METRICS, aggregation_type: "DAILY" });
        const d = await ml<any>(`/advertising/${adv.site_id}/product_ads/campaigns/${c.id}?${dqs}`, { headers: { "api-version": "2" } });
        const rows: any[] = Array.isArray(d) ? d : d?.results ?? d?.metrics ?? [];
        for (const m of rows) {
          if (!m?.date) continue;
          q.run(
            `INSERT INTO ads_campaign_daily (campaign_id, date, prints, clicks, cost, direct_amount, indirect_amount, total_amount, units)
             VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id, date) DO UPDATE SET prints=excluded.prints, clicks=excluded.clicks, cost=excluded.cost,
             direct_amount=excluded.direct_amount, indirect_amount=excluded.indirect_amount, total_amount=excluded.total_amount, units=excluded.units`,
            [String(c.id), String(m.date).slice(0, 10), num(m.prints), num(m.clicks), num(m.cost), num(m.direct_amount), num(m.indirect_amount), num(m.total_amount), num(m.units_quantity)],
          );
        }
      } catch {
        /* série diária opcional */
      }
    }
    if (!r.results?.length || offset + 50 >= (r.paging?.total ?? 0)) break;
  }

  // Métricas por anúncio (produto)
  for (let offset = 0; offset < 2000; offset += 50) {
    const qs = new URLSearchParams({ limit: "50", offset: String(offset), date_from: dateFrom, date_to: dateTo, metrics: METRICS });
    const r = await ml<{ results: any[]; paging?: { total: number } }>(
      `/advertising/${adv.site_id}/advertisers/${adv.advertiser_id}/product_ads/ads/search?${qs}`,
      { headers: { "api-version": "2" } },
    );
    for (const a of r.results ?? []) {
      const m = a.metrics ?? {};
      q.run(
        `INSERT INTO ads_item_metrics (listing_id, campaign_id, date_from, date_to, prints, clicks, cost, total_amount, units, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(listing_id, date_from, date_to) DO UPDATE SET campaign_id=excluded.campaign_id, prints=excluded.prints,
         clicks=excluded.clicks, cost=excluded.cost, total_amount=excluded.total_amount, units=excluded.units, synced_at=excluded.synced_at`,
        [a.item_id, a.campaign_id ? String(a.campaign_id) : null, dateFrom, dateTo, num(m.prints), num(m.clicks), num(m.cost), num(m.total_amount), num(m.units_quantity), new Date().toISOString()],
      );
    }
    if (!r.results?.length || offset + 50 >= (r.paging?.total ?? 0)) break;
  }
  return { processed };
}

/** Indicadores derivados (CTR, CPC, ACOS, ROAS) calculados de forma consistente a partir dos brutos. */
export function adsDerived(m: { prints?: number | null; clicks?: number | null; cost?: number | null; total_amount?: number | null }) {
  const prints = m.prints ?? 0, clicks = m.clicks ?? 0, cost = m.cost ?? 0, amount = m.total_amount ?? 0;
  return {
    ctr: prints > 0 ? clicks / prints : null,
    cpc: clicks > 0 ? cost / clicks : null,
    acos: amount > 0 ? cost / amount : null,
    roas: cost > 0 ? amount / cost : null,
  };
}

export function adsOverview() {
  const sync = q.get<any>("SELECT status, message, last_success_at FROM sync_state WHERE resource='ads'");
  const campaigns = q.all<any>("SELECT id, name, status, budget, strategy, acos_target, raw, synced_at FROM ads_campaigns ORDER BY name").map((c) => {
    const m = json.parse<any>(c.raw, {}).metrics ?? {};
    const base = { prints: num(m.prints), clicks: num(m.clicks), cost: num(m.cost), total_amount: num(m.total_amount), units: num(m.units_quantity) };
    return { id: c.id, name: c.name, status: c.status, budget: c.budget, strategy: c.strategy, acos_target: c.acos_target, ...base, ...adsDerived(base) };
  });
  const items = q.all<any>(
    `SELECT a.*, l.title, l.thumbnail FROM ads_item_metrics a LEFT JOIN listings l ON l.id = a.listing_id
     WHERE a.date_to = (SELECT MAX(date_to) FROM ads_item_metrics) ORDER BY a.cost DESC`,
  ).map((a) => ({ ...a, ...adsDerived(a) }));
  const daily = q.all<any>(
    "SELECT date, SUM(cost) cost, SUM(clicks) clicks, SUM(prints) prints, SUM(total_amount) total_amount FROM ads_campaign_daily GROUP BY date ORDER BY date",
  );
  const totals = campaigns.reduce(
    (s, c) => ({ prints: s.prints + (c.prints ?? 0), clicks: s.clicks + (c.clicks ?? 0), cost: s.cost + (c.cost ?? 0), total_amount: s.total_amount + (c.total_amount ?? 0), units: s.units + (c.units ?? 0) }),
    { prints: 0, clicks: 0, cost: 0, total_amount: 0, units: 0 },
  );
  return {
    available: sync?.status === "ok" || campaigns.length > 0,
    sync: sync ?? null,
    totals: { ...totals, ...adsDerived(totals) },
    campaigns,
    items,
    daily,
  };
}
