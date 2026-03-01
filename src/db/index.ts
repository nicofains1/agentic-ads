// ──────────────────────────────────────────────────────────────────────────────
// Database module — SQLite schema bootstrap and CRUD operations
// ──────────────────────────────────────────────────────────────────────────────

import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import {
  SCHEMA_SQL,
  MIGRATION_V2_SQL,
  CHAIN_CONFIGS_SEED,
  type Ad,
  type AdRow,
  type Advertiser,
  type ApiKey,
  type Campaign,
  type CampaignRow,
  type ChainConfig,
  type Developer,
  type Event,
  type EventRow,
  type VerificationStatus,
} from './schema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAdRow(row: AdRow): Ad {
  return {
    ...row,
    keywords: JSON.parse(row.keywords) as string[],
    categories: JSON.parse(row.categories) as string[],
  };
}

function parseCampaignRow(row: CampaignRow): Campaign {
  return {
    ...row,
    chain_ids: JSON.parse(row.chain_ids) as number[],
  };
}

function parseEventRow(row: EventRow): Event {
  return {
    ...row,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    verification_details: JSON.parse(row.verification_details) as Record<string, unknown>,
  };
}

// ─── Database initialisation ─────────────────────────────────────────────────

export function initDatabase(dbPath?: string): InstanceType<typeof Database> {
  const db = new Database(dbPath ?? ':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  migrateToV2(db);
  seedChainConfigs(db);
  return db;
}

/** Idempotent migration: add V2 columns if they don't exist yet. */
function migrateToV2(db: InstanceType<typeof Database>): void {
  const devCols = (db.pragma('table_info(developers)') as Array<{ name: string }>).map(c => c.name);
  if (devCols.includes('wallet_address')) return; // Already migrated

  // Run each ALTER TABLE individually (SQLite doesn't support multi-ALTER)
  for (const stmt of MIGRATION_V2_SQL.split(';')) {
    const trimmed = stmt.trim();
    if (trimmed) {
      try { db.exec(trimmed); } catch { /* index/table already exists */ }
    }
  }
}

/** Seed chain_configs with public RPCs if empty. */
function seedChainConfigs(db: InstanceType<typeof Database>): void {
  const count = (db.prepare('SELECT COUNT(*) as c FROM chain_configs').get() as { c: number }).c;
  if (count > 0) return;

  const stmt = db.prepare('INSERT OR IGNORE INTO chain_configs (chain_id, name, rpc_url, explorer_url) VALUES (?, ?, ?, ?)');
  for (const cfg of CHAIN_CONFIGS_SEED) {
    stmt.run(cfg.chain_id, cfg.name, cfg.rpc_url, cfg.explorer_url);
  }
}

// ─── Advertisers ─────────────────────────────────────────────────────────────

export function createAdvertiser(
  db: InstanceType<typeof Database>,
  data: { name: string; company?: string; email?: string },
): Advertiser {
  const id = crypto.randomUUID();
  const stmt = db.prepare(
    'INSERT INTO advertisers (id, name, company, email) VALUES (?, ?, ?, ?)',
  );
  stmt.run(id, data.name, data.company ?? null, data.email ?? null);
  return db.prepare('SELECT * FROM advertisers WHERE id = ?').get(id) as Advertiser;
}

// ─── Developers ──────────────────────────────────────────────────────────────

export function createDeveloper(
  db: InstanceType<typeof Database>,
  data: { name: string; email?: string },
): Developer {
  const id = crypto.randomUUID();
  const stmt = db.prepare(
    'INSERT INTO developers (id, name, email) VALUES (?, ?, ?)',
  );
  stmt.run(id, data.name, data.email ?? null);
  return db.prepare('SELECT * FROM developers WHERE id = ?').get(id) as Developer;
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export function createCampaign(
  db: InstanceType<typeof Database>,
  data: {
    advertiser_id: string;
    name: string;
    objective: Campaign['objective'];
    total_budget: number;
    daily_budget?: number;
    pricing_model: Campaign['pricing_model'];
    bid_amount: number;
    start_date?: string;
    end_date?: string;
    verification_type?: Campaign['verification_type'];
    contract_address?: string;
    chain_ids?: number[];
  },
): Campaign {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO campaigns
      (id, advertiser_id, name, objective, total_budget, daily_budget, pricing_model, bid_amount, start_date, end_date, verification_type, contract_address, chain_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.advertiser_id,
    data.name,
    data.objective,
    data.total_budget,
    data.daily_budget ?? null,
    data.pricing_model,
    data.bid_amount,
    data.start_date ?? null,
    data.end_date ?? null,
    data.verification_type ?? 'trust',
    data.contract_address ?? null,
    JSON.stringify(data.chain_ids ?? []),
  );
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow;
  return parseCampaignRow(row);
}

export function getCampaignById(
  db: InstanceType<typeof Database>,
  id: string,
): Campaign | null {
  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
  return row ? parseCampaignRow(row) : null;
}

export function getCampaignsByAdvertiser(
  db: InstanceType<typeof Database>,
  advertiser_id: string,
): Campaign[] {
  const rows = db
    .prepare('SELECT * FROM campaigns WHERE advertiser_id = ?')
    .all(advertiser_id) as CampaignRow[];
  return rows.map(parseCampaignRow);
}

export function updateCampaignSpent(
  db: InstanceType<typeof Database>,
  campaign_id: string,
  amount: number,
): void {
  db.prepare('UPDATE campaigns SET spent = spent + ? WHERE id = ?').run(amount, campaign_id);
}

export function updateCampaignStatus(
  db: InstanceType<typeof Database>,
  campaign_id: string,
  status: Campaign['status'],
): void {
  db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(status, campaign_id);
}

export function updateCampaign(
  db: InstanceType<typeof Database>,
  campaign_id: string,
  data: {
    name?: string;
    objective?: Campaign['objective'];
    status?: Campaign['status'];
    total_budget?: number;
    daily_budget?: number | null;
    bid_amount?: number;
    start_date?: string | null;
    end_date?: string | null;
  },
): Campaign | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (sets.length === 0) return getCampaignById(db, campaign_id);

  params.push(campaign_id);
  db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getCampaignById(db, campaign_id);
}

export function listCampaigns(
  db: InstanceType<typeof Database>,
  advertiser_id: string,
  filters?: { status?: Campaign['status'] },
): Campaign[] {
  let sql = 'SELECT * FROM campaigns WHERE advertiser_id = ?';
  const params: unknown[] = [advertiser_id];

  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }

  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params) as CampaignRow[];
  return rows.map(parseCampaignRow);
}

// ─── Ads ─────────────────────────────────────────────────────────────────────

export function createAd(
  db: InstanceType<typeof Database>,
  data: {
    campaign_id: string;
    creative_text: string;
    link_url: string;
    keywords: string[];
    categories?: string[];
    geo?: string;
    language?: string;
  },
): Ad {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO ads
      (id, campaign_id, creative_text, link_url, keywords, categories, geo, language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.campaign_id,
    data.creative_text,
    data.link_url,
    JSON.stringify(data.keywords),
    JSON.stringify(data.categories ?? []),
    data.geo ?? 'ALL',
    data.language ?? 'en',
  );
  const row = db.prepare('SELECT * FROM ads WHERE id = ?').get(id) as AdRow;
  return parseAdRow(row);
}

export function getAdById(
  db: InstanceType<typeof Database>,
  id: string,
): Ad | null {
  const row = db.prepare('SELECT * FROM ads WHERE id = ?').get(id) as AdRow | undefined;
  return row ? parseAdRow(row) : null;
}

export function getAdsByCampaign(
  db: InstanceType<typeof Database>,
  campaign_id: string,
): Ad[] {
  const rows = db
    .prepare('SELECT * FROM ads WHERE campaign_id = ?')
    .all(campaign_id) as AdRow[];
  return rows.map(parseAdRow);
}

export function getActiveAds(
  db: InstanceType<typeof Database>,
  filters?: { geo?: string; language?: string },
): Ad[] {
  let sql = `
    SELECT a.*
    FROM ads a
    JOIN campaigns c ON a.campaign_id = c.id
    WHERE a.status = 'active'
      AND c.status = 'active'
      AND c.spent < c.total_budget
  `;
  const params: unknown[] = [];

  if (filters?.geo) {
    sql += " AND (a.geo = 'ALL' OR a.geo = ?)";
    params.push(filters.geo);
  }
  if (filters?.language) {
    sql += ' AND a.language = ?';
    params.push(filters.language);
  }

  const rows = db.prepare(sql).all(...params) as AdRow[];
  return rows.map(parseAdRow);
}

export function updateAdStats(
  db: InstanceType<typeof Database>,
  ad_id: string,
  event_type: 'impression' | 'click' | 'conversion',
  spend_amount: number,
): void {
  const column =
    event_type === 'impression'
      ? 'impressions'
      : event_type === 'click'
        ? 'clicks'
        : 'conversions';

  db.prepare(`UPDATE ads SET ${column} = ${column} + 1, spend = spend + ? WHERE id = ?`).run(
    spend_amount,
    ad_id,
  );
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function insertEvent(
  db: InstanceType<typeof Database>,
  data: {
    ad_id: string;
    developer_id: string;
    event_type: Event['event_type'];
    amount_charged: number;
    developer_revenue: number;
    platform_revenue: number;
    context_hash?: string;
    metadata?: Record<string, unknown>;
    tx_hash?: string;
    chain_id?: number;
    verification_status?: VerificationStatus;
    verification_details?: Record<string, unknown>;
  },
): Event {
  const id = crypto.randomUUID();
  const stmt = db.prepare(`
    INSERT INTO events
      (id, ad_id, developer_id, event_type, amount_charged, developer_revenue, platform_revenue, context_hash, metadata, tx_hash, chain_id, verification_status, verification_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    data.ad_id,
    data.developer_id,
    data.event_type,
    data.amount_charged,
    data.developer_revenue,
    data.platform_revenue,
    data.context_hash ?? null,
    JSON.stringify(data.metadata ?? {}),
    data.tx_hash ?? null,
    data.chain_id ?? null,
    data.verification_status ?? 'none',
    JSON.stringify(data.verification_details ?? {}),
  );
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow;
  return parseEventRow(row);
}

export function getEventsByAd(
  db: InstanceType<typeof Database>,
  ad_id: string,
): Event[] {
  const rows = db.prepare('SELECT * FROM events WHERE ad_id = ?').all(ad_id) as EventRow[];
  return rows.map(parseEventRow);
}

export function getDailySpent(
  db: InstanceType<typeof Database>,
  campaign_id: string,
): number {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(e.amount_charged), 0) AS total
       FROM events e
       JOIN ads a ON e.ad_id = a.id
       WHERE a.campaign_id = ?
         AND e.created_at >= ?`,
    )
    .get(campaign_id, today) as { total: number };
  return row.total;
}

// ─── API Keys ────────────────────────────────────────────────────────────────

export function createApiKey(
  db: InstanceType<typeof Database>,
  data: { key_hash: string; entity_type: ApiKey['entity_type']; entity_id: string },
): ApiKey {
  const id = crypto.randomUUID();
  const stmt = db.prepare(
    'INSERT INTO api_keys (id, key_hash, entity_type, entity_id) VALUES (?, ?, ?, ?)',
  );
  stmt.run(id, data.key_hash, data.entity_type, data.entity_id);
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKey;
}

export function findApiKey(
  db: InstanceType<typeof Database>,
  key_hash: string,
): ApiKey | null {
  return (
    (db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(key_hash) as ApiKey) ?? null
  );
}

// ─── Developer Wallet Management ────────────────────────────────────────────

export function updateDeveloperWallet(
  db: InstanceType<typeof Database>,
  developerId: string,
  walletAddress: string,
  referralCode: string,
): Developer {
  db.prepare('UPDATE developers SET wallet_address = ?, referral_code = ? WHERE id = ?')
    .run(walletAddress, referralCode, developerId);
  return db.prepare('SELECT * FROM developers WHERE id = ?').get(developerId) as Developer;
}

export function getDeveloperById(
  db: InstanceType<typeof Database>,
  id: string,
): Developer | null {
  return (db.prepare('SELECT * FROM developers WHERE id = ?').get(id) as Developer) ?? null;
}

export function findDeveloperByWallet(
  db: InstanceType<typeof Database>,
  walletAddress: string,
): Developer | null {
  return (db.prepare('SELECT * FROM developers WHERE wallet_address = ?').get(walletAddress) as Developer) ?? null;
}

export function findDeveloperByReferral(
  db: InstanceType<typeof Database>,
  referralCode: string,
): Developer | null {
  return (db.prepare('SELECT * FROM developers WHERE referral_code = ?').get(referralCode) as Developer) ?? null;
}

// ─── Chain Configs ──────────────────────────────────────────────────────────

export function getChainConfig(
  db: InstanceType<typeof Database>,
  chainId: number,
): ChainConfig | null {
  return (db.prepare('SELECT * FROM chain_configs WHERE chain_id = ?').get(chainId) as ChainConfig) ?? null;
}

export function upsertChainConfig(
  db: InstanceType<typeof Database>,
  config: { chain_id: number; name: string; rpc_url: string; explorer_url?: string },
): ChainConfig {
  db.prepare(`
    INSERT INTO chain_configs (chain_id, name, rpc_url, explorer_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chain_id) DO UPDATE SET name = excluded.name, rpc_url = excluded.rpc_url, explorer_url = excluded.explorer_url
  `).run(config.chain_id, config.name, config.rpc_url, config.explorer_url ?? null);
  return db.prepare('SELECT * FROM chain_configs WHERE chain_id = ?').get(config.chain_id) as ChainConfig;
}

// ─── Event Verification ─────────────────────────────────────────────────────

export function updateEventVerification(
  db: InstanceType<typeof Database>,
  eventId: string,
  status: VerificationStatus,
  details?: Record<string, unknown>,
): Event {
  db.prepare(`
    UPDATE events SET verification_status = ?, verified_at = ?, verification_details = ?
    WHERE id = ?
  `).run(
    status,
    status === 'verified' || status === 'rejected' ? new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '') : null,
    JSON.stringify(details ?? {}),
    eventId,
  );
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as EventRow;
  return parseEventRow(row);
}

export function getPendingVerifications(
  db: InstanceType<typeof Database>,
  limit: number,
): Event[] {
  const rows = db.prepare(`
    SELECT * FROM events WHERE verification_status = 'pending' ORDER BY created_at ASC LIMIT ?
  `).all(limit) as EventRow[];
  return rows.map(parseEventRow);
}

export function findEventByTxHash(
  db: InstanceType<typeof Database>,
  txHash: string,
): Event | null {
  const row = db.prepare('SELECT * FROM events WHERE tx_hash = ?').get(txHash) as EventRow | undefined;
  return row ? parseEventRow(row) : null;
}

export function getEventById(
  db: InstanceType<typeof Database>,
  eventId: string,
): Event | null {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as EventRow | undefined;
  return row ? parseEventRow(row) : null;
}
