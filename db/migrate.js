/**
 * db/migrate.js
 * Creates (or upgrades) the GrocSplit SQLite schema.
 * Run once: node db/migrate.js
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS everywhere.
 */

require("dotenv").config();
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.resolve(process.env.DB_PATH || "./grocsplit.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const migrations = [
  // ── 1. People ────────────────────────────────────────────────────────────
  // Persisted across billing cycles.
  `CREATE TABLE IF NOT EXISTS people (
    id          TEXT PRIMARY KEY,          -- UUID
    name        TEXT NOT NULL UNIQUE,
    active      INTEGER NOT NULL DEFAULT 1, -- 0 = soft-deleted / moved out
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── 2. Billing Cycles ────────────────────────────────────────────────────
  // One row per month. month_key is e.g. "2025-01".
  `CREATE TABLE IF NOT EXISTS cycles (
    id            TEXT PRIMARY KEY,         -- UUID
    month_key     TEXT NOT NULL UNIQUE,     -- "YYYY-MM"
    label         TEXT NOT NULL,            -- "January 2025"
    date_from     TEXT NOT NULL,            -- ISO date "YYYY-MM-DD"
    date_to       TEXT NOT NULL,            -- ISO date "YYYY-MM-DD"
    finalized     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── 3. Plaid Access Tokens ───────────────────────────────────────────────
  // Stores the long-lived access token after a user completes Plaid Link.
  `CREATE TABLE IF NOT EXISTS plaid_items (
    id            TEXT PRIMARY KEY,
    item_id       TEXT NOT NULL UNIQUE,     -- Plaid item_id
    access_token  TEXT NOT NULL,            -- encrypted in prod ideally
    institution   TEXT,
    last_synced   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── 4. Transactions ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,         -- Plaid transaction_id or manual UUID
    cycle_id      TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    plaid_id      TEXT,                     -- NULL for manually entered receipts
    date          TEXT NOT NULL,
    merchant      TEXT NOT NULL,
    amount        REAL NOT NULL,            -- positive = expense
    source        TEXT NOT NULL DEFAULT 'visa',  -- 'visa' | 'receipt'
    verified      INTEGER NOT NULL DEFAULT 0,    -- checkbox: paper receipt confirmed
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_transactions_cycle ON transactions(cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_plaid ON transactions(plaid_id)`,

  // ── 5. Dinner Entries ────────────────────────────────────────────────────
  // One row per person per cycle. dinner_count includes guest dinners.
  `CREATE TABLE IF NOT EXISTS dinner_entries (
    id            TEXT PRIMARY KEY,
    cycle_id      TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    person_id     TEXT NOT NULL REFERENCES people(id),
    dinner_count  INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cycle_id, person_id)
  )`,

  // ── 6. Personal Receipts ─────────────────────────────────────────────────
  // Amounts a specific person paid out-of-pocket (deducted from their balance).
  `CREATE TABLE IF NOT EXISTS personal_receipts (
    id            TEXT PRIMARY KEY,
    cycle_id      TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    person_id     TEXT NOT NULL REFERENCES people(id),
    amount        REAL NOT NULL,
    note          TEXT,
    date          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_receipts_cycle ON personal_receipts(cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_person ON personal_receipts(person_id)`,
];

console.log(`\n🗄️  Running GrocSplit migrations on: ${DB_PATH}\n`);

db.transaction(() => {
  for (const sql of migrations) {
    const preview = sql.trim().slice(0, 60).replace(/\s+/g, " ");
    db.prepare(sql).run();
    console.log(`  ✓ ${preview}…`);
  }
})();

console.log("\n✅  Schema ready.\n");
db.close();
