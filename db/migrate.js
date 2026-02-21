/**
 * db/migrate.js
 * Creates (or upgrades) the GrocSplit SQLite schema using sql.js.
 * Run once: node db/migrate.js
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS everywhere.
 */

require("dotenv").config();
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.resolve(process.env.DB_PATH || "./grocsplit.db");

const migrations = [
  // ── 1. People ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS people (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── 2. Billing Cycles ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS cycles (
    id            TEXT PRIMARY KEY,
    month_key     TEXT NOT NULL UNIQUE,
    label         TEXT NOT NULL,
    date_from     TEXT NOT NULL,
    date_to       TEXT NOT NULL,
    finalized     INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── 3. Plaid Access Tokens ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS plaid_items (
    id            TEXT PRIMARY KEY,
    item_id       TEXT NOT NULL UNIQUE,
    access_token  TEXT NOT NULL,
    institution   TEXT,
    last_synced   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── 4. Transactions ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,
    cycle_id      TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    plaid_id      TEXT,
    date          TEXT NOT NULL,
    merchant      TEXT NOT NULL,
    amount        REAL NOT NULL,
    source        TEXT NOT NULL DEFAULT 'visa',
    verified      INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_transactions_cycle ON transactions(cycle_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_plaid ON transactions(plaid_id)`,

  // ── 5. Dinner Entries ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS dinner_entries (
    id            TEXT PRIMARY KEY,
    cycle_id      TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    person_id     TEXT NOT NULL REFERENCES people(id),
    dinner_count  INTEGER NOT NULL DEFAULT 0,
    notes         TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cycle_id, person_id)
  )`,

  // ── 6. Personal Receipts ───────────────────────────────────────────────────
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

async function migrate() {
  console.log(`\n🗄️  Running GrocSplit migrations on: ${DB_PATH}\n`);

  const SQL = await initSqlJs();

  // Load existing DB from disk, or create a fresh one
  let db;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log("  📂 Loaded existing database\n");
  } else {
    db = new SQL.Database();
    console.log("  🆕 Creating new database\n");
  }

  db.run("PRAGMA foreign_keys = ON");

  for (const sql of migrations) {
    const preview = sql.trim().slice(0, 60).replace(/\s+/g, " ");
    db.run(sql);
    console.log(`  ✓ ${preview}…`);
  }

  // Save back to disk
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log(`\n✅  Schema ready. Database saved to: ${DB_PATH}\n`);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
