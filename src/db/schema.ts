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
  start_date      TEXT,
  end_date        TEXT,
  created_at      TEXT DEFAULT CURRENT_TIMESTAMP
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
  context_hash      TEXT,
  metadata          TEXT DEFAULT '{}',
  created_at        TEXT DEFAULT CURRENT_TIMESTAMP
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
`;
