/**
 * db/index.js
 * SQLite database layer using sql.js (pure JavaScript — no native compilation).
 *
 * sql.js keeps the database in memory. This module loads it from disk on
 * startup and saves it back to disk after every write operation, so data
 * persists exactly as it did with better-sqlite3.
 *
 * The public API (people, cycles, tx, dinners, receipts, computeBill) is
 * identical to the better-sqlite3 version — no changes needed in routes/.
 */

require("dotenv").config();
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DB_PATH = path.resolve(process.env.DB_PATH || "./grocsplit.db");

// ── Bootstrap (synchronous-style via module-level await pattern) ─────────────
// sql.js is async to initialise (loads the WASM binary), so we export a
// promise that resolves once the db is ready. The Express server awaits this
// before listening — see server/index.js.

let db; // sql.js Database instance (in-memory)

// ── Persistence helpers ───────────────────────────────────────────────────────

function saveToDisk() {
  const data = db.export(); // Uint8Array
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function loadFromDisk(SQL) {
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    return new SQL.Database(fileBuffer);
  }
  return new SQL.Database(); // fresh in-memory db
}

// ── sql.js thin query helpers ─────────────────────────────────────────────────
// sql.js has a different API to better-sqlite3:
//   db.run(sql, params)          → executes, no return rows
//   db.exec(sql)                 → executes DDL strings
//   db.prepare(sql).getAsObject(params) → single row as object
//   db.prepare(sql).all(params)  is NOT built-in — we add it below

/**
 * Run a write statement (INSERT / UPDATE / DELETE).
 * Automatically saves the database to disk after execution.
 * Returns { changes } to mirror better-sqlite3's .run() return value.
 */
function run(sql, params = {}) {
  const stmt = db.prepare(sql);
  stmt.run(namedToPositional(sql, params));
  stmt.free();
  saveToDisk();
  // sql.js doesn't expose changed row count easily; return a compatible shape
  return { changes: 1 };
}

/**
 * Fetch a single row as a plain object, or undefined if not found.
 */
function get(sql, params = {}) {
  const stmt = db.prepare(sql);
  stmt.bind(namedToPositional(sql, params));
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

/**
 * Fetch all matching rows as an array of plain objects.
 */
function all(sql, params = {}) {
  const stmt = db.prepare(sql);
  stmt.bind(namedToPositional(sql, params));
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/**
 * sql.js uses positional parameters ($1, $2 …) internally.
 * Our SQL uses named parameters (@name, @id …) matching better-sqlite3 style.
 * This converts a named-params object into the array sql.js expects,
 * preserving the order parameters appear in the SQL string.
 */
function namedToPositional(sql, params) {
  if (Array.isArray(params)) return params; // already positional (? style)
  if (!params || typeof params !== "object") return [];

  // Find all @name occurrences in order
  const names = [];
  const re = /@(\w+)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (!names.includes(m[1])) names.push(m[1]);
  }

  if (names.length === 0) {
    // Might be ? style with array — return as-is
    return Object.values(params);
  }

  return names.map((n) => {
    const v = params[n];
    return v === undefined ? null : v;
  });
}

// ── Prepared statement factory ────────────────────────────────────────────────
// Returns an object that mimics better-sqlite3's prepared statement interface.
// Routes call e.g. people.all.all() or people.insert.run({id, name}).

function prepare(sql) {
  // Rewrite named params (@foo) to $foo so sql.js can parse the statement
  const sqlForSqlJs = sql.replace(/@(\w+)/g, "\$$1");

  return {
    // For SELECT — return all rows
    all: (params = {}) => {
      const rewrittenParams = rewriteKeys(params);
      const stmt = db.prepare(sqlForSqlJs);
      if (Object.keys(rewrittenParams).length || Array.isArray(rewrittenParams)) {
        stmt.bind(Array.isArray(rewrittenParams) ? rewrittenParams : rewrittenParams);
      }
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },

    // For SELECT — return first row or undefined
    get: (params = {}) => {
      const rewrittenParams = rewriteKeys(params);
      const stmt = db.prepare(sqlForSqlJs);
      if (Object.keys(rewrittenParams).length || Array.isArray(rewrittenParams)) {
        stmt.bind(rewrittenParams);
      }
      const row = stmt.step() ? stmt.getAsObject() : undefined;
      stmt.free();
      return row;
    },

    // For INSERT / UPDATE / DELETE
    run: (params = {}) => {
      const rewrittenParams = rewriteKeys(params);
      const stmt = db.prepare(sqlForSqlJs);
      stmt.run(rewrittenParams);
      stmt.free();
      saveToDisk();
      return { changes: 1 };
    },
  };
}

/**
 * sql.js named params use $key syntax. Convert our @key params object
 * to { $key: value } format that sql.js expects for named binding.
 */
function rewriteKeys(params) {
  if (Array.isArray(params)) return params;
  if (!params || typeof params !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[`$${k}`] = v === undefined ? null : v;
  }
  return out;
}

// ── Transaction wrapper ───────────────────────────────────────────────────────
// sql.js doesn't have a .transaction() helper like better-sqlite3.
// We implement a simple BEGIN/COMMIT wrapper. seed.js uses db.transaction(fn)().

function transaction(fn) {
  return () => {
    db.run("BEGIN");
    try {
      fn();
      db.run("COMMIT");
      saveToDisk();
    } catch (err) {
      db.run("ROLLBACK");
      throw err;
    }
  };
}

// ── Initialisation ────────────────────────────────────────────────────────────

async function init() {
  const SQL = await initSqlJs();
  db = loadFromDisk(SQL);

  // Enable foreign keys for this connection
  db.run("PRAGMA foreign_keys = ON");

  console.log(`🗄️  Database loaded from: ${DB_PATH}`);
}

// ── Query objects (mirrors better-sqlite3 version exactly) ────────────────────

const peopleQueries = () => ({
  all:        prepare("SELECT * FROM people WHERE active = 1 ORDER BY name"),
  byId:       prepare("SELECT * FROM people WHERE id = @id"),
  insert:     prepare("INSERT INTO people (id, name) VALUES (@id, @name)"),
  deactivate: prepare("UPDATE people SET active = 0 WHERE id = @id"),
  rename:     prepare("UPDATE people SET name = @name WHERE id = @id"),
});

const cycleQueries = () => ({
  all:        prepare("SELECT * FROM cycles ORDER BY month_key DESC"),
  byId:       prepare("SELECT * FROM cycles WHERE id = @id"),
  byMonthKey: prepare("SELECT * FROM cycles WHERE month_key = @month_key"),
  insert:     prepare(
    `INSERT INTO cycles (id, month_key, label, date_from, date_to)
     VALUES (@id, @month_key, @label, @date_from, @date_to)`
  ),
  finalize:   prepare("UPDATE cycles SET finalized = 1 WHERE id = @id"),
});

const plaidQueryDefs = () => ({
  first:       prepare("SELECT * FROM plaid_items ORDER BY created_at LIMIT 1"),
  insert:      prepare(
    `INSERT OR REPLACE INTO plaid_items (id, item_id, access_token, institution)
     VALUES (@id, @item_id, @access_token, @institution)`
  ),
  updateSynced: prepare(
    "UPDATE plaid_items SET last_synced = datetime('now') WHERE item_id = @item_id"
  ),
});

const txQueryDefs = () => ({
  byCycle: prepare(
    "SELECT * FROM transactions WHERE cycle_id = @cycle_id ORDER BY date DESC"
  ),
  insert: prepare(
    `INSERT OR IGNORE INTO transactions
       (id, cycle_id, plaid_id, date, merchant, amount, source, notes)
     VALUES (@id, @cycle_id, @plaid_id, @date, @merchant, @amount, @source, @notes)`
  ),
  setVerified: prepare(
    "UPDATE transactions SET verified = @verified WHERE id = @id"
  ),
  delete: prepare("DELETE FROM transactions WHERE id = @id"),
  totalForCycle: prepare(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE cycle_id = @cycle_id"
  ),
});

const dinnerQueryDefs = () => ({
  byCycle: prepare(
    `SELECT de.*, p.name AS person_name
     FROM dinner_entries de
     JOIN people p ON p.id = de.person_id
     WHERE de.cycle_id = @cycle_id`
  ),
  upsert: prepare(
    `INSERT INTO dinner_entries (id, cycle_id, person_id, dinner_count, notes, updated_at)
     VALUES (@id, @cycle_id, @person_id, @dinner_count, @notes, datetime('now'))
     ON CONFLICT(cycle_id, person_id) DO UPDATE SET
       dinner_count = excluded.dinner_count,
       notes = excluded.notes,
       updated_at = datetime('now')`
  ),
});

const receiptQueryDefs = () => ({
  byCycle: prepare(
    `SELECT pr.*, p.name AS person_name
     FROM personal_receipts pr
     JOIN people p ON p.id = pr.person_id
     WHERE pr.cycle_id = @cycle_id
     ORDER BY pr.created_at DESC`
  ),
  byPersonAndCycle: prepare(
    "SELECT * FROM personal_receipts WHERE cycle_id = @cycle_id AND person_id = @person_id"
  ),
  insert: prepare(
    `INSERT INTO personal_receipts (id, cycle_id, person_id, amount, note, date)
     VALUES (@id, @cycle_id, @person_id, @amount, @note, @date)`
  ),
  delete: prepare("DELETE FROM personal_receipts WHERE id = @id"),
});

// ── Billing calculation ───────────────────────────────────────────────────────

function computeBill(cycleId) {
  const totalRow = txQueryDefs().totalForCycle.get({ cycle_id: cycleId });
  const total = totalRow ? Number(totalRow.total) : 0;
  const dinnerRows = dinnerQueryDefs().byCycle.all({ cycle_id: cycleId });
  const receiptRows = receiptQueryDefs().byCycle.all({ cycle_id: cycleId });

  const totalDinners = dinnerRows.reduce((s, d) => s + Number(d.dinner_count), 0);

  const billRows = dinnerRows.map((d) => {
    const pct = totalDinners > 0 ? Number(d.dinner_count) / totalDinners : 0;
    const owes = total * pct;
    const paid = receiptRows
      .filter((r) => r.person_id === d.person_id)
      .reduce((s, r) => s + Number(r.amount), 0);
    return {
      person_id: d.person_id,
      person_name: d.person_name,
      dinner_count: Number(d.dinner_count),
      pct: Math.round(pct * 10000) / 100,
      owes: Math.round(owes * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      balance: Math.round((owes - paid) * 100) / 100,
    };
  });

  return { total, totalDinners, billRows };
}

// ── Exports ───────────────────────────────────────────────────────────────────
// Routes import these. Because sql.js prepares statements against the live db
// object, we expose factory functions that are called after init() completes.
// server/index.js calls init() then builds these before starting Express.

module.exports = {
  init,
  uuidv4,
  saveToDisk,
  // These are populated after init() by calling buildQueries()
  people: null,
  cycles: null,
  plaid: null,
  tx: null,
  dinners: null,
  receipts: null,
  computeBill,
  // Called by server/index.js after init() resolves
  buildQueries() {
    module.exports.people   = peopleQueries();
    module.exports.cycles   = cycleQueries();
    module.exports.plaid    = plaidQueryDefs();
    module.exports.tx       = txQueryDefs();
    module.exports.dinners  = dinnerQueryDefs();
    module.exports.receipts = receiptQueryDefs();
  },
  // Expose db and transaction() for seed.js
  get db() { return { transaction, run: (sql) => db.run(sql) }; },
};
