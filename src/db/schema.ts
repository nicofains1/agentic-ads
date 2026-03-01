// ──────────────────────────────────────────────────────────────────────────────
// Database schema definitions — TypeScript interfaces & SQL DDL
// ──────────────────────────────────────────────────────────────────────────────

// ─── Entity interfaces ───────────────────────────────────────────────────────

export interface Advertiser {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  created_at: string;
}

export interface Developer {
  id: string;
  name: string;
  email: string | null;
  wallet_address: string | null;
  referral_code: string | null;
  reputation_score: number;
  created_at: string;
}

export interface Campaign {
  id: string;
  advertiser_id: string;
  name: string;
  objective: 'awareness' | 'traffic' | 'conversions';
  status: 'draft' | 'active' | 'paused' | 'completed';
  total_budget: number;
  daily_budget: number | null;
  spent: number;
  pricing_model: 'cpm' | 'cpc' | 'cpa' | 'hybrid';
  bid_amount: number;
  start_date: string | null;
  end_date: string | null;
  verification_type: 'trust' | 'on_chain';
  contract_address: string | null;
  chain_ids: number[];
  created_at: string;
}

export interface Ad {
  id: string;
  campaign_id: string;
  creative_text: string;
  link_url: string;
  keywords: string[];
  categories: string[];
  geo: string;
  language: string;
  status: 'pending' | 'active' | 'paused';
  quality_score: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  created_at: string;
}

export type VerificationStatus = 'none' | 'pending' | 'verified' | 'rejected';

export interface Event {
  id: string;
  ad_id: string;
  developer_id: string;
  event_type: 'impression' | 'click' | 'conversion';
  amount_charged: number;
  developer_revenue: number;
  platform_revenue: number;
  context_hash: string | null;
  metadata: Record<string, unknown>;
  tx_hash: string | null;
  chain_id: number | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  verification_details: Record<string, unknown>;
  created_at: string;
}

export interface ChainConfig {
  chain_id: number;
  name: string;
  rpc_url: string;
  explorer_url: string | null;
  created_at: string;
}

export interface ApiKey {
  id: string;
  key_hash: string;
  entity_type: 'advertiser' | 'developer';
  entity_id: string;
  created_at: string;
}

// ─── Raw row types (JSON fields stored as TEXT) ──────────────────────────────

export interface AdRow {
  id: string;
  campaign_id: string;
  creative_text: string;
  link_url: string;
  keywords: string;      // JSON TEXT
  categories: string;    // JSON TEXT
  geo: string;
  language: string;
  status: 'pending' | 'active' | 'paused';
  quality_score: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  created_at: string;
}

export interface CampaignRow {
  id: string;
  advertiser_id: string;
  name: string;
  objective: 'awareness' | 'traffic' | 'conversions';
  status: 'draft' | 'active' | 'paused' | 'completed';
  total_budget: number;
  daily_budget: number | null;
  spent: number;
  pricing_model: 'cpm' | 'cpc' | 'cpa' | 'hybrid';
  bid_amount: number;
  start_date: string | null;
  end_date: string | null;
  verification_type: 'trust' | 'on_chain';
  contract_address: string | null;
  chain_ids: string;     // JSON TEXT
  created_at: string;
}

export interface EventRow {
  id: string;
  ad_id: string;
  developer_id: string;
  event_type: 'impression' | 'click' | 'conversion';
  amount_charged: number;
  developer_revenue: number;
  platform_revenue: number;
  context_hash: string | null;
  metadata: string;      // JSON TEXT
  tx_hash: string | null;
  chain_id: number | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  verification_details: string; // JSON TEXT
  created_at: string;
}

// ─── SQL DDL ─────────────────────────────────────────────────────────────────

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS advertisers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT,
  email       TEXT,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS developers (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  email             TEXT,
  wallet_address    TEXT,
  referral_code     TEXT,
  reputation_score  REAL DEFAULT 1.0,
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  advertiser_id   TEXT NOT NULL REFERENCES advertisers(id),
  name            TEXT NOT NULL,
  objective       TEXT NOT NULL CHECK(objective IN ('awareness','traffic','conversions')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','paused','completed')),
  total_budget    REAL NOT NULL,
  daily_budget    REAL,
  spent           REAL DEFAULT 0,
  pricing_model   TEXT NOT NULL CHECK(pricing_model IN ('cpm','cpc','cpa','hybrid')),
  bid_amount      REAL NOT NULL,
  start_date          TEXT,
  end_date            TEXT,
  verification_type   TEXT DEFAULT 'trust' CHECK(verification_type IN ('trust','on_chain')),
  contract_address    TEXT,
  chain_ids           TEXT DEFAULT '[]',
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ads (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL REFERENCES campaigns(id),
  creative_text   TEXT NOT NULL,
  link_url        TEXT NOT NULL,
  keywords        TEXT NOT NULL,
  categories      TEXT DEFAULT '[]',
  geo             TEXT DEFAULT 'ALL',
  language        TEXT DEFAULT 'en',
  status          TEXT DEFAULT 'active' CHECK(status IN ('pending','active','paused')),
  quality_score   REAL DEFAULT 1.0,
  impressions     INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  conversions     INTEGER DEFAULT 0,
  spend           REAL DEFAULT 0,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  ad_id             TEXT NOT NULL REFERENCES ads(id),
  developer_id      TEXT NOT NULL REFERENCES developers(id),
  event_type        TEXT NOT NULL CHECK(event_type IN ('impression','click','conversion')),
  amount_charged    REAL NOT NULL DEFAULT 0,
  developer_revenue REAL NOT NULL DEFAULT 0,
  platform_revenue  REAL NOT NULL DEFAULT 0,
  context_hash          TEXT,
  metadata              TEXT DEFAULT '{}',
  tx_hash               TEXT,
  chain_id              INTEGER,
  verification_status   TEXT DEFAULT 'none' CHECK(verification_status IN ('none','pending','verified','rejected')),
  verified_at           TEXT,
  verification_details  TEXT DEFAULT '{}',
  created_at            TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chain_configs (
  chain_id      INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  rpc_url       TEXT NOT NULL,
  explorer_url  TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('advertiser','developer')),
  entity_id   TEXT NOT NULL,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_ads_campaign_id      ON ads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ads_status            ON ads(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser  ON campaigns(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status      ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_events_ad_id          ON events(ad_id);
CREATE INDEX IF NOT EXISTS idx_events_developer_id   ON events(developer_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at     ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash     ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_events_dedup          ON events(developer_id, ad_id, event_type, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_wallet   ON developers(wallet_address) WHERE wallet_address IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_referral ON developers(referral_code) WHERE referral_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_tx_hash      ON events(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_verification        ON events(verification_status) WHERE verification_status = 'pending';
`;

// ─── Migration SQL (for existing databases) ────────────────────────────────

export const MIGRATION_V2_SQL = `
-- developers: add wallet fields
ALTER TABLE developers ADD COLUMN wallet_address TEXT;
ALTER TABLE developers ADD COLUMN referral_code TEXT;

-- campaigns: add verification fields
ALTER TABLE campaigns ADD COLUMN verification_type TEXT DEFAULT 'trust' CHECK(verification_type IN ('trust','on_chain'));
ALTER TABLE campaigns ADD COLUMN contract_address TEXT;
ALTER TABLE campaigns ADD COLUMN chain_ids TEXT DEFAULT '[]';

-- events: add blockchain verification fields
ALTER TABLE events ADD COLUMN tx_hash TEXT;
ALTER TABLE events ADD COLUMN chain_id INTEGER;
ALTER TABLE events ADD COLUMN verification_status TEXT DEFAULT 'none' CHECK(verification_status IN ('none','pending','verified','rejected'));
ALTER TABLE events ADD COLUMN verified_at TEXT;
ALTER TABLE events ADD COLUMN verification_details TEXT DEFAULT '{}';

-- chain_configs table
CREATE TABLE IF NOT EXISTS chain_configs (
  chain_id      INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  rpc_url       TEXT NOT NULL,
  explorer_url  TEXT,
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- new indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_wallet   ON developers(wallet_address) WHERE wallet_address IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_developers_referral ON developers(referral_code) WHERE referral_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_tx_hash      ON events(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_verification        ON events(verification_status) WHERE verification_status = 'pending';
`;

// ─── Chain config seed data ─────────────────────────────────────────────────

export const CHAIN_CONFIGS_SEED = [
  { chain_id: 1, name: 'Ethereum', rpc_url: 'https://eth.drpc.org', explorer_url: 'https://etherscan.io' },
  { chain_id: 10, name: 'Optimism', rpc_url: 'https://mainnet.optimism.io', explorer_url: 'https://optimistic.etherscan.io' },
  { chain_id: 137, name: 'Polygon', rpc_url: 'https://polygon-bor-rpc.publicnode.com', explorer_url: 'https://polygonscan.com' },
  { chain_id: 8453, name: 'Base', rpc_url: 'https://mainnet.base.org', explorer_url: 'https://basescan.org' },
  { chain_id: 42161, name: 'Arbitrum', rpc_url: 'https://arb1.arbitrum.io/rpc', explorer_url: 'https://arbiscan.io' },
  { chain_id: 43114, name: 'Avalanche', rpc_url: 'https://api.avax.network/ext/bc/C/rpc', explorer_url: 'https://snowtrace.io' },
];

// ─── Withdrawal types ────────────────────────────────────────────────────────

export type WithdrawalStatus = 'pending' | 'completed' | 'failed';

export interface Withdrawal {
  id: string;
  developer_id: string;
  amount: number;
  wallet_address: string;
  tx_hash: string | null;
  status: WithdrawalStatus;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export const WITHDRAWAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS withdrawals (
  id              TEXT PRIMARY KEY,
  developer_id    TEXT NOT NULL REFERENCES developers(id),
  amount          REAL NOT NULL,
  wallet_address  TEXT NOT NULL,
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
  error           TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_developer ON withdrawals(developer_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status    ON withdrawals(status);
`;
