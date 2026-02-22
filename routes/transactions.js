/**
 * routes/transactions.js
 * Manage transactions within a cycle: add manual, toggle verified, delete.
 * Plaid sync is in routes/plaid.js.
 */

const express = require("express");
const router = express.Router({ mergeParams: true }); // inherits :cycleId from parent
const { tx, cycles, uuidv4 } = require("../db");

// ── CIBC CSV parser ──────────────────────────────────────────────────────────
// CIBC CSV format: date,"vendor",debit,credit,card_number
// Vendor field may contain commas and is RFC 4180 quoted.

function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field — handle escaped quotes ("")
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; } // closing quote
        else { field += line[i++]; }
      }
      if (i < line.length && line[i] === ',') i++; // skip comma
      fields.push(field);
    } else {
      // Unquoted field
      const start = i;
      while (i < line.length && line[i] !== ',') i++;
      fields.push(line.slice(start, i));
      if (i < line.length) i++; // skip comma
    }
  }
  return fields;
}

function parseCibcRow(line) {
  // Expected: [date, vendor, debit, credit, card_number]
  const fields = parseCsvLine(line);
  if (fields.length < 3) return null;

  const date     = fields[0].trim();
  const merchant = fields[1].trim();
  const debit    = fields[2].trim(); // positive = expense
  const credit   = fields[3]?.trim() || ""; // positive = refund — we skip these

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!merchant) return null;

  // Prefer debit column; skip credits/refunds
  if (!debit || debit === "0") return null;
  const amount = parseFloat(debit);
  if (isNaN(amount) || amount <= 0) return null;

  return { date, merchant, amount };
}

// GET /api/cycles/:cycleId/transactions
router.get("/", (req, res) => {
  try {
    const rows = tx.byCycle.all(req.params.cycleId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cycles/:cycleId/transactions  (manual receipt entry)
// { date, merchant, amount, source, notes }
router.post("/", (req, res) => {
  const { date, merchant, amount, source = "receipt", notes } = req.body;

  if (!merchant || !amount) {
    return res.status(400).json({ error: "merchant and amount are required" });
  }

  const cycle = cycles.byId.get(req.params.cycleId);
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });
  if (cycle.finalized) return res.status(409).json({ error: "Cycle is finalized" });

  try {
    const id = uuidv4();
    tx.insert.run({
      id,
      cycle_id: req.params.cycleId,
      plaid_id: null,
      date: date || new Date().toISOString().slice(0, 10),
      merchant: merchant.trim(),
      amount: Math.abs(Number(amount)), // always store as positive expense
      source,
      notes: notes || null,
    });
    res.status(201).json(tx.byCycle.all(req.params.cycleId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/cycles/:cycleId/transactions/:txId  { verified: true|false }
router.patch("/:txId", (req, res) => {
  const { verified } = req.body;
  if (verified === undefined) {
    return res.status(400).json({ error: "verified field required" });
  }
  try {
    tx.setVerified.run({ id: req.params.txId, verified: verified ? 1 : 0 });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cycles/:cycleId/transactions/:txId
router.delete("/:txId", (req, res) => {
  try {
    tx.delete.run(req.params.txId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cycles/:cycleId/import-csv  { csv: "<raw csv text>" }
// Imports CIBC-format CSV transactions. Skips duplicates and credits.
router.post("/import-csv", (req, res) => {
  const { csv } = req.body;
  if (!csv || typeof csv !== "string") {
    return res.status(400).json({ error: "csv field required" });
  }

  const cycle = cycles.byId.get(req.params.cycleId);
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });
  if (cycle.finalized) return res.status(409).json({ error: "Cycle is finalized" });

  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0, skipped = 0, errors = 0;

  for (const line of lines) {
    // Skip header rows (any line that doesn't start with a date)
    if (!/^\d{4}-\d{2}-\d{2}/.test(line)) continue;

    const parsed = parseCibcRow(line);
    if (!parsed) { errors++; continue; }

    const { date, merchant, amount } = parsed;

    // Deduplicate: generate a fingerprint stored as plaid_id
    const fingerprint = `csv:${date}:${merchant}:${amount.toFixed(2)}`;
    const existing = tx.byPlaidId.get({ plaid_id: fingerprint });
    if (existing) { skipped++; continue; }

    try {
      tx.insert.run({
        id: uuidv4(),
        cycle_id: req.params.cycleId,
        plaid_id: fingerprint,
        date,
        merchant: merchant.slice(0, 200),
        amount,
        source: "csv",
        notes: null,
      });
      added++;
    } catch (err) {
      console.error("[CSV import] row error:", err.message, line);
      errors++;
    }
  }

  res.json({
    added,
    skipped,
    errors,
    transactions: tx.byCycle.all(req.params.cycleId),
  });
});

module.exports = router;
