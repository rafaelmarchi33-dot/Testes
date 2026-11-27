/**
 * Migrações versionadas do banco. Cada item é aplicado uma única vez, em ordem.
 * Nunca altere uma migração já publicada: adicione uma nova.
 */
export const migrations: string[] = [
  /* 001 — núcleo */ `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT, ip TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE ml_accounts (
  id INTEGER PRIMARY KEY,               -- user_id do Mercado Livre
  nickname TEXT, site_id TEXT, email TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'connected',  -- connected | needs_reauth | disconnected
  last_error TEXT,
  connected_by INTEGER, connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY, code_verifier_enc TEXT NOT NULL, user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sync_state (
  resource TEXT NOT NULL, account_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle', cursor TEXT,
  last_run_at TEXT, last_success_at TEXT, message TEXT, processed INTEGER DEFAULT 0,
  PRIMARY KEY (resource, account_id)
);
CREATE TABLE api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  service TEXT NOT NULL, method TEXT, path TEXT, status INTEGER, duration_ms INTEGER, error TEXT
);
CREATE INDEX idx_api_logs_at ON api_logs(at);
CREATE TABLE ml_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT, resource TEXT, user_id INTEGER, application_id TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT, error TEXT
);

/* ---------- Catálogo ---------- */
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE, name TEXT NOT NULL, category TEXT,
  made_to_order INTEGER NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  lead_time_days INTEGER NOT NULL DEFAULT 2,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE product_costs (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  material_cost REAL NOT NULL DEFAULT 0,
  manufacturing_cost REAL NOT NULL DEFAULT 0,
  energy_cost REAL NOT NULL DEFAULT 0,
  production_minutes REAL NOT NULL DEFAULT 0,
  labor_cost_per_hour REAL NOT NULL DEFAULT 0,
  packaging_cost REAL NOT NULL DEFAULT 0,
  operational_cost REAL NOT NULL DEFAULT 0,
  shipping_cost_seller REAL NOT NULL DEFAULT 0,
  ads_cost_per_unit REAL NOT NULL DEFAULT 0,
  tax_rate_pct REAL NOT NULL DEFAULT 0,
  other_cost REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE listings (
  id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  title TEXT, category_id TEXT, price REAL, original_price REAL, currency_id TEXT,
  available_quantity INTEGER, sold_quantity INTEGER, status TEXT, sub_status TEXT,
  listing_type_id TEXT, permalink TEXT, thumbnail TEXT, condition TEXT, health REAL,
  catalog_listing INTEGER, logistic_type TEXT, free_shipping INTEGER, sku TEXT,
  date_created TEXT, last_updated TEXT, raw TEXT, synced_at TEXT
);
CREATE INDEX idx_listings_status ON listings(status);
CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, path TEXT, max_title_length INTEGER, raw TEXT, fetched_at TEXT);
CREATE INDEX idx_listings_product ON listings(product_id);

/* ---------- Vendas ---------- */
CREATE TABLE orders (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL,
  status TEXT, status_detail TEXT, payment_status TEXT,
  date_created TEXT, date_closed TEXT, last_updated TEXT,
  total_amount REAL, paid_amount REAL, currency_id TEXT,
  buyer_id INTEGER, buyer_nickname TEXT, shipping_id INTEGER, pack_id INTEGER,
  tags TEXT, raw TEXT, synced_at TEXT
);
CREATE INDEX idx_orders_date ON orders(date_created);
CREATE INDEX idx_orders_status ON orders(status);
CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL, variation_id TEXT NOT NULL DEFAULT '',
  title TEXT, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, sale_fee REAL,
  listing_type_id TEXT, category_id TEXT, seller_sku TEXT,
  PRIMARY KEY (order_id, listing_id, variation_id)
);
CREATE INDEX idx_order_items_listing ON order_items(listing_id);
CREATE TABLE shipments (
  id INTEGER PRIMARY KEY, order_id INTEGER,
  status TEXT, substatus TEXT, logistic_type TEXT, mode TEXT,
  tracking_number TEXT, tracking_method TEXT,
  date_created TEXT, handling_limit TEXT, delivery_estimate TEXT,
  seller_cost REAL, raw TEXT, synced_at TEXT
);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE TABLE questions (
  id INTEGER PRIMARY KEY, listing_id TEXT, text TEXT, status TEXT,
  date_created TEXT, answer_text TEXT, answer_date TEXT, from_id INTEGER, raw TEXT, synced_at TEXT
);
CREATE INDEX idx_questions_status ON questions(status);
CREATE TABLE reputation_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  level_id TEXT, power_seller_status TEXT, transactions TEXT, metrics TEXT
);
CREATE TABLE visits_daily (
  scope TEXT NOT NULL,      -- 'store' ou id do anúncio
  date TEXT NOT NULL, visits INTEGER NOT NULL,
  PRIMARY KEY (scope, date)
);

/* ---------- Estoque ---------- */
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('in','out','adjust','sale','sale_reversal','production')),
  qty INTEGER NOT NULL, reason TEXT, ref TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_stock_idem ON stock_movements(product_id, type, ref) WHERE ref IS NOT NULL;

/* ---------- Publicidade ---------- */
CREATE TABLE ads_campaigns (
  id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, advertiser_id TEXT,
  name TEXT, status TEXT, budget REAL, strategy TEXT, acos_target REAL, raw TEXT, synced_at TEXT
);
CREATE TABLE ads_campaign_daily (
  campaign_id TEXT NOT NULL, date TEXT NOT NULL,
  prints INTEGER, clicks INTEGER, cost REAL, direct_amount REAL, indirect_amount REAL, total_amount REAL, units INTEGER,
  PRIMARY KEY (campaign_id, date)
);
CREATE TABLE ads_item_metrics (
  listing_id TEXT NOT NULL, campaign_id TEXT, date_from TEXT NOT NULL, date_to TEXT NOT NULL,
  prints INTEGER, clicks INTEGER, cost REAL, total_amount REAL, units INTEGER, synced_at TEXT,
  PRIMARY KEY (listing_id, date_from, date_to)
);

/* ---------- Anúncios gerados por IA ---------- */
CREATE TABLE listing_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | pending_approval | publishing | published | failed
  input TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]',
  ai_output TEXT, final TEXT,
  ml_item_id TEXT, permalink TEXT, ml_status TEXT, error TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* ---------- Aprovações ---------- */
CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',      -- user | ai | system
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | executed | failed
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_by INTEGER, decided_at TEXT, executed_at TEXT, result TEXT, error TEXT
);
CREATE INDEX idx_actions_status ON actions(status);

/* ---------- Alertas ---------- */
CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical','opportunity')),
  title TEXT NOT NULL, message TEXT NOT NULL,
  entity TEXT, entity_id TEXT, data TEXT,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',       -- open | read | resolved
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('email','whatsapp','webhook')),
  target TEXT NOT NULL, min_severity TEXT NOT NULL DEFAULT 'warning', enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel_id INTEGER NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* ---------- IA e mercado ---------- */
CREATE TABLE ai_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                        -- daily | chat
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by INTEGER, question TEXT, content TEXT NOT NULL, data_snapshot TEXT, model TEXT, usage TEXT
);
CREATE TABLE market_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL, category_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by INTEGER, data TEXT NOT NULL, limitations TEXT
);
CREATE TABLE opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  research_id INTEGER REFERENCES market_research(id) ON DELETE SET NULL,
  name TEXT NOT NULL, image TEXT, category_id TEXT, category_name TEXT,
  price_min REAL, price_median REAL, price_max REAL,
  competitors INTEGER, sold_signal INTEGER, demand_note TEXT,
  est_cost REAL, margin_pct REAL, difficulty TEXT, potential TEXT,
  rationale TEXT, evidence TEXT, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`,
  /* 002 — Mind2Matter Intelligence: empresa, fábrica, laboratório, radar, concorrência, importações, metas, rotinas */ `
CREATE TABLE companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, segment TEXT,
  monthly_revenue_min REAL, monthly_revenue_max REAL,   -- faturamento informado pelo dono (faixa)
  monthly_goal REAL,                                     -- meta de faturamento bruto mensal
  listings_identified INTEGER,                           -- anúncios identificados (informado)
  channels TEXT, catalog TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* Relatórios agregados por período (ex.: painel de métricas do ML exportado ou informado). */
CREATE TABLE period_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'mercadolivre',
  date_from TEXT NOT NULL, date_to TEXT NOT NULL,
  gross_sales REAL, units INTEGER, sales_count INTEGER, visits INTEGER, conversion_pct REAL, avg_unit_price REAL,
  var_gross_sales_pct REAL, var_units_pct REAL, var_sales_count_pct REAL, var_visits_pct REAL, var_avg_price_pct REAL, var_conversion_pp REAL,
  source TEXT NOT NULL,             -- initial_import | import | manual
  import_id INTEGER, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* Canais de venda e tarifas configuráveis (nunca presumidas). */
CREATE TABLE channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  fee_pct REAL, fixed_fee REAL, shipping_cost REAL, active INTEGER NOT NULL DEFAULT 1, notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE listing_fee_overrides (
  listing_id TEXT PRIMARY KEY, fee_pct REAL, fixed_fee REAL, shipping_cost REAL, ads_pct REAL, notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

ALTER TABLE orders ADD COLUMN channel TEXT NOT NULL DEFAULT 'mercadolivre';
ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'api';
ALTER TABLE orders ADD COLUMN import_id INTEGER;
ALTER TABLE listings ADD COLUMN channel TEXT NOT NULL DEFAULT 'mercadolivre';
ALTER TABLE listings ADD COLUMN source TEXT NOT NULL DEFAULT 'api';
ALTER TABLE listings ADD COLUMN import_id INTEGER;
ALTER TABLE listings ADD COLUMN visits_total INTEGER;
ALTER TABLE listings ADD COLUMN quality_score REAL;
ALTER TABLE listings ADD COLUMN competition_status TEXT;
ALTER TABLE ads_campaigns ADD COLUMN import_id INTEGER;
ALTER TABLE ads_campaign_daily ADD COLUMN import_id INTEGER;
ALTER TABLE visits_daily ADD COLUMN import_id INTEGER;
ALTER TABLE products ADD COLUMN weight_g REAL;
ALTER TABLE products ADD COLUMN print_minutes REAL;
ALTER TABLE products ADD COLUMN material TEXT;
ALTER TABLE products ADD COLUMN units_per_plate INTEGER;
ALTER TABLE products ADD COLUMN lab_product_id INTEGER;

CREATE VIEW customers AS
  SELECT buyer_id id, MAX(buyer_nickname) nickname, channel, COUNT(*) orders, SUM(CASE WHEN status='paid' THEN total_amount ELSE 0 END) revenue,
         MIN(date_created) first_order, MAX(date_created) last_order
  FROM orders WHERE buyer_id IS NOT NULL GROUP BY buyer_id, channel;

/* ---------- Fábrica ---------- */
CREATE TABLE machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, model TEXT NOT NULL, technology TEXT DEFAULT 'FDM', nozzle_mm REAL,
  materials TEXT, build_volume TEXT, multicolor TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','printing','maintenance','inactive')),
  hours_worked REAL NOT NULL DEFAULT 0, hours_per_day REAL NOT NULL DEFAULT 16,
  power_watts REAL, purchase_price REAL, lifetime_hours REAL, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE machine_maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  date TEXT NOT NULL, type TEXT NOT NULL, description TEXT, cost REAL, hours_at REAL,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE filaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT, material TEXT NOT NULL, color TEXT,
  total_g REAL NOT NULL DEFAULT 0, available_g REAL NOT NULL DEFAULT 0, min_g REAL NOT NULL DEFAULT 0,
  cost_per_kg REAL, purchased_at TEXT, notes TEXT, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE filament_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filament_id INTEGER NOT NULL REFERENCES filaments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('purchase','consumption','adjust','waste')),
  grams REAL NOT NULL, ref TEXT, reason TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_filament_idem ON filament_movements(filament_id, type, ref) WHERE ref IS NOT NULL;
CREATE TABLE production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL CHECK (quantity > 0),
  material TEXT, color TEXT, filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL,
  machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  weight_g_unit REAL, minutes_unit REAL, units_per_plate INTEGER,
  start_date TEXT, due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','scheduled','printing','finishing','packing','done','cancelled')),
  sale_price_unit REAL, notes TEXT, failed_units INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_prod_status ON production_orders(status);

/* ---------- Laboratório de produtos ---------- */
CREATE TABLE lab_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, sku TEXT, category TEXT,
  model_supplier TEXT, license TEXT, weight_g REAL, print_minutes REAL, material TEXT,
  est_cost REAL, sale_price REAL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','research','development','testing','approved','production','selling','discontinued')),
  opportunity_id INTEGER, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT, notes TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE lab_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_product_id INTEGER NOT NULL REFERENCES lab_products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('image','stl','3mf','other')),
  filename TEXT NOT NULL, original_name TEXT, size INTEGER,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE lab_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_product_id INTEGER NOT NULL REFERENCES lab_products(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,     -- test | change | status | note
  title TEXT NOT NULL, details TEXT, result TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* ---------- Radar (oportunidades): pontuação 0–100 e separação observado x estimado ---------- */
ALTER TABLE opportunities ADD COLUMN source TEXT NOT NULL DEFAULT 'ml_research';
ALTER TABLE opportunities ADD COLUMN links TEXT;
ALTER TABLE opportunities ADD COLUMN competitor_prices TEXT;
ALTER TABLE opportunities ADD COLUMN observed TEXT;
ALTER TABLE opportunities ADD COLUMN estimates TEXT;
ALTER TABLE opportunities ADD COLUMN scores TEXT;
ALTER TABLE opportunities ADD COLUMN score REAL;
ALTER TABLE opportunities ADD COLUMN weight_g REAL;
ALTER TABLE opportunities ADD COLUMN print_minutes REAL;
ALTER TABLE opportunities ADD COLUMN lab_product_id INTEGER;

/* ---------- Concorrência ---------- */
CREATE TABLE competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, product TEXT, price REAL, url TEXT, ml_item_id TEXT,
  rating REAL, reviews INTEGER, public_sales TEXT, differentials TEXT, photos_note TEXT, thumbnail TEXT,
  our_listing_id TEXT, our_product_id INTEGER, our_price REAL,
  analyzed_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', notes TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* ---------- Importações ---------- */
CREATE TABLE imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT, file_type TEXT,
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','imported','undone','failed')),
  mapping TEXT, headers TEXT, rows_total INTEGER DEFAULT 0, rows_imported INTEGER DEFAULT 0, rows_skipped INTEGER DEFAULT 0,
  issues TEXT, summary TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  imported_at TEXT, undone_at TEXT
);

/* ---------- Metas, despesas, marketing ---------- */
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, target_revenue REAL NOT NULL, deadline TEXT, kind TEXT NOT NULL DEFAULT 'milestone', achieved_at TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL, category TEXT NOT NULL, description TEXT, amount REAL NOT NULL, recurring INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE marketing_contents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER, lab_product_id INTEGER, listing_id TEXT, name TEXT NOT NULL,
  content TEXT NOT NULL, photo_plan TEXT, model TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* ---------- IA: conversas ---------- */
CREATE TABLE ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL DEFAULT 'mind', title TEXT NOT NULL, user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL, model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

/* ---------- Alertas configuráveis e rotinas ---------- */
CREATE TABLE alert_rules (
  type TEXT PRIMARY KEY, label TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  severity TEXT, threshold REAL, threshold_label TEXT
);
CREATE TABLE routines (
  key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly_end')), weekday INTEGER, hour INTEGER NOT NULL DEFAULT 7,
  enabled INTEGER NOT NULL DEFAULT 1, use_ai INTEGER NOT NULL DEFAULT 1, webhook_url TEXT,
  last_run_at TEXT, last_status TEXT, next_run_at TEXT
);
CREATE TABLE routine_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_key TEXT NOT NULL REFERENCES routines(key) ON DELETE CASCADE,
  started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, trigger TEXT NOT NULL,
  data TEXT, ai_summary TEXT, error TEXT
);
`,
  /* 003 — dados iniciais reais informados pela Mind2Matter (identificados como importação inicial) */ `
INSERT INTO companies (name, segment, monthly_revenue_min, monthly_revenue_max, monthly_goal, listings_identified, channels, catalog, notes) VALUES (
  'Mind2Matter', 'Fabricação e comercialização de produtos por impressão 3D', 1000, 3000, 20000, 95,
  '["Mercado Livre","Shopee","Outros marketplaces (futuro)"]',
  '["Produtos funcionais","Organizadores","Acessórios tecnológicos","Acessórios gamer","Produtos personalizados","Colecionáveis","Decoração","Acessórios para criadores de conteúdo"]',
  'Dados iniciais informados pelo proprietário: faturamento mensal entre R$ 1.000 e R$ 3.000, 95 anúncios identificados, meta de R$ 20.000/mês.'
);
INSERT INTO period_reports (channel, date_from, date_to, gross_sales, units, sales_count, visits, conversion_pct, avg_unit_price,
  var_gross_sales_pct, var_units_pct, var_sales_count_pct, var_visits_pct, var_avg_price_pct, var_conversion_pp, source, notes)
VALUES ('mercadolivre', '2026-11-19', '2026-11-26', 1872, 39, 37, 534, 6.9, 48, 79.1, 85.7, 106, 311, -3.5, -7, 'initial_import',
  'Relatório de métricas do Mercado Livre informado na implantação. Variações em relação ao período anterior de mesma duração.');
INSERT INTO channels (id, name, fee_pct, fixed_fee, shipping_cost, active, notes) VALUES
  ('mercadolivre', 'Mercado Livre', NULL, NULL, NULL, 1, 'Tarifas não informadas: configure ou use a tarifa oficial consultada pela API.'),
  ('shopee', 'Shopee', NULL, NULL, NULL, 1, 'Tarifas não informadas: configure antes de calcular margens deste canal.');
INSERT INTO machines (name, model, technology, nozzle_mm, materials, build_volume, multicolor, status, notes)
VALUES ('A1 Combo #1', 'Bambu Lab A1 Combo', 'FDM', 0.4, '["PLA","PETG"]', '256 × 256 × 256 mm', 'AMS lite (até 4 cores)', 'available',
  'Equipamento inicial informado. Potência, valor de compra e horas trabalhadas não informados — preencha para calcular energia e depreciação.');
INSERT INTO products (sku, name, category, made_to_order, stock_qty, notes)
VALUES (NULL, 'Ímã de reposição para Hollyland Lark M2', 'Acessórios para criadores de conteúdo', 1, 0,
  'Produto identificado na importação inicial. Estoque físico e custos não informados.');
INSERT INTO listings (id, account_id, product_id, title, price, original_price, currency_id, available_quantity, status, health, quality_score, competition_status, channel, source, synced_at)
VALUES ('INICIAL-HOLLYLAND-M2', 0, (SELECT id FROM products WHERE name='Ímã de reposição para Hollyland Lark M2'),
  'Ímã de reposição para Hollyland Lark M2', 45, 50, 'BRL', 949, 'active', 0.94, 94,
  'Ganhando — recebendo a maioria das visitas', 'mercadolivre', 'initial_import', '2026-11-26T23:59:00.000Z');
INSERT INTO goals (name, target_revenue, kind, notes) VALUES
  ('Meta principal mensal', 20000, 'main', 'Faturamento bruto mensal'),
  ('Marco 1 — consolidar R$ 5 mil/mês', 5000, 'milestone', 'Meta intermediária sugerida; ajuste conforme o plano'),
  ('Marco 2 — R$ 10 mil/mês', 10000, 'milestone', NULL),
  ('Marco 3 — R$ 15 mil/mês', 15000, 'milestone', NULL);
INSERT INTO alert_rules (type, label, enabled, severity, threshold, threshold_label) VALUES
  ('out_of_stock','Anúncio sem estoque',1,'critical',NULL,NULL),
  ('low_stock','Estoque interno abaixo do mínimo',1,'warning',NULL,NULL),
  ('champion_low_stock','Produto campeão com estoque baixo',1,'critical',7,'dias de cobertura mínima'),
  ('unanswered_questions','Perguntas aguardando resposta',1,NULL,NULL,NULL),
  ('shipping_deadline','Prazo de postagem',1,'critical',NULL,NULL),
  ('sales_spike','Produto vendendo acima da média',1,'opportunity',NULL,NULL),
  ('performance_drop','Anúncio perdeu desempenho',1,'warning',40,'% de queda em unidades (30d)'),
  ('stale_listing','Anúncio parado',1,'info',NULL,NULL),
  ('low_margin','Margem abaixo do mínimo',1,'warning',NULL,NULL),
  ('negative_margin','Produto com margem negativa',1,'critical',0,'% de margem'),
  ('price_increase_opportunity','Oportunidade de aumentar preço',1,'opportunity',NULL,NULL),
  ('cancellations','Aumento de cancelamentos',1,'warning',NULL,NULL),
  ('campaign_potential','Produto com potencial para campanha',1,'opportunity',NULL,NULL),
  ('campaign_no_return','Campanha consumindo orçamento sem retorno',1,'warning',35,'% de ACOS máximo'),
  ('conversion_drop','Queda de conversão',1,'warning',2,'pontos percentuais de queda'),
  ('below_goal','Faturamento abaixo da trajetória da meta',1,'warning',90,'% da trajetória esperada'),
  ('filament_low','Filamento abaixo do mínimo',1,'warning',NULL,NULL),
  ('production_delay','Risco de atraso na produção',1,'critical',NULL,NULL),
  ('market_opportunity','Oportunidade de mercado identificada',1,'opportunity',75,'pontos mínimos no radar'),
  ('ml_reauth','Reautorização do Mercado Livre',1,'critical',NULL,NULL);
INSERT INTO routines (key, name, description, frequency, weekday, hour) VALUES
  ('daily','Rotina diária','Resumo de vendas, faturamento, conversão, pedidos, estoque, problemas operacionais e ações recomendadas.','daily',NULL,7),
  ('monday','Segunda — Mercado','Pesquisa de mercado, produtos vencedores e concorrência.','weekly',1,8),
  ('tuesday','Terça — Anúncios','Otimização de anúncios, conversão e fotografias.','weekly',2,8),
  ('wednesday','Quarta — Preços','Preços, margens e kits.','weekly',3,8),
  ('thursday','Quinta — Produção','Produção, filamento e capacidade produtiva.','weekly',4,8),
  ('friday','Sexta — Relatório executivo','Resultados da semana e planejamento da semana seguinte.','weekly',5,17),
  ('month_end','Fechamento do mês','DRE gerencial, faturamento, lucro, despesas, margens, crescimento, metas e plano do próximo mês.','monthly_end',NULL,18);
`,
  /* 004 — métricas diárias de desempenho (relatório "Métricas do desempenho dos seus produtos" do ML) */ `
CREATE TABLE daily_metrics (
  channel TEXT NOT NULL DEFAULT 'mercadolivre',
  date TEXT NOT NULL,
  unique_visits INTEGER, total_visits INTEGER, likes INTEGER,
  intent_unique_visitors INTEGER, intent_units INTEGER, intent_count INTEGER, intent_value REAL,
  sales_count INTEGER, unique_buyers INTEGER, units INTEGER, gross_sales REAL,
  source TEXT NOT NULL DEFAULT 'import', import_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (channel, date)
);
`,
];
