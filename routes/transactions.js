/**
 * routes/transactions.js
 * Manage transactions within a cycle: add manual, toggle verified, delete.
 * Plaid sync is in routes/plaid.js.
 */

const express = require("express");
const router = express.Router({ mergeParams: true }); // inherits :cycleId from parent
const { tx, cycles, uuidv4 } = require("../db");

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

module.exports = router;
