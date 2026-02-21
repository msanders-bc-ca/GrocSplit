/**
 * db/index.js
 * Opens (or creates) the SQLite database and exposes prepared-statement helpers.
 * This module is required once; the same db instance is reused across all routes.
 */

require("dotenv").config();
const Database = require("better-sqlite3");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.resolve(process.env.DB_PATH || "./grocsplit.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── People ────────────────────────────────────────────────────────────────

const peopleQueries = {
  all: db.prepare("SELECT * FROM people WHERE active = 1 ORDER BY name"),

  byId: db.prepare("SELECT * FROM people WHERE id = ?"),

  insert: db.prepare(
    "INSERT INTO people (id, name) VALUES (@id, @name)"
  ),

  deactivate: db.prepare("UPDATE people SET active = 0 WHERE id = ?"),

  rename: db.prepare("UPDATE people SET name = @name WHERE id = @id"),
};

// ── Cycles ────────────────────────────────────────────────────────────────

const cycleQueries = {
  all: db.prepare("SELECT * FROM cycles ORDER BY month_key DESC"),

  byId: db.prepare("SELECT * FROM cycles WHERE id = ?"),

  byMonthKey: db.prepare("SELECT * FROM cycles WHERE month_key = ?"),

  insert: db.prepare(
    `INSERT INTO cycles (id, month_key, label, date_from, date_to)
     VALUES (@id, @month_key, @label, @date_from, @date_to)`
  ),

  finalize: db.prepare("UPDATE cycles SET finalized = 1 WHERE id = ?"),
};

// ── Plaid Items ───────────────────────────────────────────────────────────

const plaidQueries = {
  first: db.prepare("SELECT * FROM plaid_items ORDER BY created_at LIMIT 1"),

  insert: db.prepare(
    `INSERT OR REPLACE INTO plaid_items (id, item_id, access_token, institution)
     VALUES (@id, @item_id, @access_token, @institution)`
  ),

  updateSynced: db.prepare(
    "UPDATE plaid_items SET last_synced = datetime('now') WHERE item_id = ?"
  ),
};

// ── Transactions ──────────────────────────────────────────────────────────

const txQueries = {
  byCycle: db.prepare(
    "SELECT * FROM transactions WHERE cycle_id = ? ORDER BY date DESC"
  ),

  insert: db.prepare(
    `INSERT OR IGNORE INTO transactions
       (id, cycle_id, plaid_id, date, merchant, amount, source, notes)
     VALUES
       (@id, @cycle_id, @plaid_id, @date, @merchant, @amount, @source, @notes)`
  ),

  setVerified: db.prepare(
    "UPDATE transactions SET verified = @verified WHERE id = @id"
  ),

  delete: db.prepare("DELETE FROM transactions WHERE id = ?"),

  totalForCycle: db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE cycle_id = ?"
  ),
};

// ── Dinner Entries ────────────────────────────────────────────────────────

const dinnerQueries = {
  byCycle: db.prepare(
    `SELECT de.*, p.name AS person_name
     FROM dinner_entries de
     JOIN people p ON p.id = de.person_id
     WHERE de.cycle_id = ?`
  ),

  upsert: db.prepare(
    `INSERT INTO dinner_entries (id, cycle_id, person_id, dinner_count, notes, updated_at)
     VALUES (@id, @cycle_id, @person_id, @dinner_count, @notes, datetime('now'))
     ON CONFLICT(cycle_id, person_id) DO UPDATE SET
       dinner_count = excluded.dinner_count,
       notes = excluded.notes,
       updated_at = datetime('now')`
  ),
};

// ── Personal Receipts ─────────────────────────────────────────────────────

const receiptQueries = {
  byCycle: db.prepare(
    `SELECT pr.*, p.name AS person_name
     FROM personal_receipts pr
     JOIN people p ON p.id = pr.person_id
     WHERE pr.cycle_id = ?
     ORDER BY pr.created_at DESC`
  ),

  byPersonAndCycle: db.prepare(
    `SELECT * FROM personal_receipts WHERE cycle_id = ? AND person_id = ?`
  ),

  insert: db.prepare(
    `INSERT INTO personal_receipts (id, cycle_id, person_id, amount, note, date)
     VALUES (@id, @cycle_id, @person_id, @amount, @note, @date)`
  ),

  delete: db.prepare("DELETE FROM personal_receipts WHERE id = ?"),
};

// ── Billing calculation (pure SQL) ────────────────────────────────────────

function computeBill(cycleId) {
  const { total } = txQueries.totalForCycle.get(cycleId);
  const dinners = dinnerQueries.byCycle.all(cycleId);
  const receipts = receiptQueries.byCycle.all(cycleId);

  const totalDinners = dinners.reduce((s, d) => s + d.dinner_count, 0);

  const billRows = dinners.map((d) => {
    const pct = totalDinners > 0 ? d.dinner_count / totalDinners : 0;
    const owes = total * pct;
    const paid = receipts
      .filter((r) => r.person_id === d.person_id)
      .reduce((s, r) => s + r.amount, 0);
    return {
      person_id: d.person_id,
      person_name: d.person_name,
      dinner_count: d.dinner_count,
      pct: Math.round(pct * 10000) / 100, // percent with 2 dp
      owes: Math.round(owes * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((owes - paid) * 100) / 100,
    };
  });

  return { total, totalDinners, billRows };
}

module.exports = {
  db,
  uuidv4,
  people: peopleQueries,
  cycles: cycleQueries,
  plaid: plaidQueries,
  tx: txQueries,
  dinners: dinnerQueries,
  receipts: receiptQueries,
  computeBill,
};
