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
];
