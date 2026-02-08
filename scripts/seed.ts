#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
// Seed script — populates the database with demo data (#17)
// Usage: npm run seed [-- --clean] [-- --db path/to/db]
// ──────────────────────────────────────────────────────────────────────────────

import {
  initDatabase,
  createAdvertiser,
  createDeveloper,
  createCampaign,
  createAd,
} from '../src/db/index.js';
import { generateApiKey } from '../src/auth/middleware.js';

const args = process.argv.slice(2);
const clean = args.includes('--clean');
const dbPathFlag = args.indexOf('--db');
const dbPath = dbPathFlag !== -1 ? args[dbPathFlag + 1] : 'agentic-ads.db';

// If --clean, delete the DB file first
if (clean) {
  const fs = await import('node:fs');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log(`[seed] Deleted existing database: ${dbPath}`);
  }
}

const db = initDatabase(dbPath);

// Check if data already exists
const existing = db.prepare('SELECT COUNT(*) as count FROM advertisers').get() as { count: number };
if (existing.count > 0 && !clean) {
  console.log('[seed] Database already has data. Use --clean to wipe and re-seed.');
  process.exit(0);
}

console.log(`[seed] Seeding database: ${dbPath}\n`);

// ─── Advertisers ────────────────────────────────────────────────────────────

const adidas = createAdvertiser(db, {
  name: 'Adidas',
  company: 'Adidas AG',
  email: 'ads@adidas.example.com',
});

const spotify = createAdvertiser(db, {
  name: 'Spotify',
  company: 'Spotify AB',
  email: 'ads@spotify.example.com',
});

console.log(`[seed] Created advertisers: Adidas (${adidas.id}), Spotify (${spotify.id})`);

// ─── Developer ──────────────────────────────────────────────────────────────

const testBot = createDeveloper(db, {
  name: 'TestBot',
  email: 'dev@testbot.example.com',
});

console.log(`[seed] Created developer: TestBot (${testBot.id})`);

// ─── API Keys ───────────────────────────────────────────────────────────────

const adidasKey = generateApiKey(db, 'advertiser', adidas.id);
const spotifyKey = generateApiKey(db, 'advertiser', spotify.id);
const testBotKey = generateApiKey(db, 'developer', testBot.id);

// ─── Campaigns ──────────────────────────────────────────────────────────────

const adidasCampaign = createCampaign(db, {
  advertiser_id: adidas.id,
  name: 'Ultraboost Summer 2026',
  objective: 'traffic',
  total_budget: 100,
  daily_budget: 10,
  pricing_model: 'cpc',
  bid_amount: 0.50,
  start_date: '2026-01-01',
  end_date: '2026-08-31',
});

const spotifyCampaign = createCampaign(db, {
  advertiser_id: spotify.id,
  name: 'Premium Q1',
  objective: 'awareness',
  total_budget: 50,
  pricing_model: 'cpm',
  bid_amount: 15,
  start_date: '2026-01-01',
  end_date: '2026-03-31',
});

console.log(`[seed] Created campaigns: Adidas (${adidasCampaign.id}), Spotify (${spotifyCampaign.id})`);

// ─── Ads ────────────────────────────────────────────────────────────────────

const adidasAd1 = createAd(db, {
  campaign_id: adidasCampaign.id,
  creative_text: 'Adidas Ultraboost 24 — 30% off! Free shipping on orders over $50. The ultimate running shoe for comfort and performance.',
  link_url: 'https://www.adidas.com/ultraboost',
  keywords: ['running shoes', 'sneakers', 'athletic shoes', 'ultraboost'],
  categories: ['footwear', 'sports', 'running'],
  geo: 'ALL',
  language: 'en',
});

const adidasAd2 = createAd(db, {
  campaign_id: adidasCampaign.id,
  creative_text: 'Adidas Samba Classic — The icon is back. Timeless style meets modern comfort.',
  link_url: 'https://www.adidas.com/samba',
  keywords: ['casual shoes', 'samba', 'sneakers', 'retro'],
  categories: ['footwear', 'fashion', 'casual'],
  geo: 'ALL',
  language: 'en',
});

const spotifyAd1 = createAd(db, {
  campaign_id: spotifyCampaign.id,
  creative_text: '3 months of Spotify Premium for $9.99 — Ad-free music, offline listening, and unlimited skips.',
  link_url: 'https://www.spotify.com/premium',
  keywords: ['music', 'streaming', 'podcast', 'playlist'],
  categories: ['entertainment', 'music', 'streaming'],
  geo: 'ALL',
  language: 'en',
});

console.log(`[seed] Created ads: Adidas (${adidasAd1.id}, ${adidasAd2.id}), Spotify (${spotifyAd1.id})`);

// ─── Print API Keys ─────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('  API KEYS (save these — they cannot be retrieved later)');
console.log('═'.repeat(70));
console.log(`\n  Adidas (advertiser):\n  ${adidasKey}\n`);
console.log(`  Spotify (advertiser):\n  ${spotifyKey}\n`);
console.log(`  TestBot (developer):\n  ${testBotKey}\n`);
console.log('═'.repeat(70));
console.log('\n[seed] Done! Database seeded successfully.');
