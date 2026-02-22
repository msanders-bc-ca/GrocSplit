/**
 * routes/cycles.js
 * Create and manage monthly billing cycles.
 */

const express = require("express");
const router = express.Router();
const { cycles, dinners, receipts, tx, people, uuidv4, computeBill } = require("../db");

// GET /api/cycles  — list all (most recent first)
router.get("/", (req, res) => {
  try {
    res.json(cycles.all.all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cycles  { month_key: "2025-01" }
// Creates a new cycle for the given month. Automatically sets date_from/date_to
// to the first and last day of that month.
router.post("/", (req, res) => {
  const { month_key } = req.body; // "YYYY-MM"
  if (!month_key || !/^\d{4}-\d{2}$/.test(month_key)) {
    return res.status(400).json({ error: "month_key must be YYYY-MM" });
  }

  // Prevent duplicates
  const existing = cycles.byMonthKey.get(month_key);
  if (existing) {
    return res.status(409).json({ error: "A cycle for that month already exists.", cycle: existing });
  }

  const [year, month] = month_key.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const date_from = `${month_key}-01`;
  const date_to = `${month_key}-${String(lastDay).padStart(2, "0")}`;

  const monthLabel = new Date(year, month - 1, 1).toLocaleString("en-CA", {
    month: "long",
    year: "numeric",
  });

  try {
    const id = uuidv4();
    cycles.insert.run({ id, month_key, label: monthLabel, date_from, date_to });

    // Pre-seed a dinner_entry row for every active person in this new cycle
    const activePeople = people.all.all();
    for (const p of activePeople) {
      dinners.upsert.run({
        id: uuidv4(),
        cycle_id: id,
        person_id: p.id,
        dinner_count: 0,
        notes: null,
      });
    }

    res.status(201).json(cycles.byId.get(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cycles/:id  — cycle detail including transactions, dinners, receipts, bill
router.get("/:id", (req, res) => {
  try {
    const cycle = cycles.byId.get(req.params.id);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });

    const transactions = tx.byCycle.all(req.params.id);
    const dinnerEntries = dinners.byCycle.all(req.params.id);
    const personalReceipts = receipts.byCycle.all(req.params.id);
    const bill = computeBill(req.params.id);

    res.json({ cycle, transactions, dinnerEntries, personalReceipts, bill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cycles/:id/finalize
router.post("/:id/finalize", (req, res) => {
  try {
    const cycle = cycles.byId.get(req.params.id);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });
    cycles.finalize.run(req.params.id);
    res.json({ ok: true, cycle: cycles.byId.get(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cycles/:id/unfinalize
router.post("/:id/unfinalize", (req, res) => {
  try {
    const cycle = cycles.byId.get(req.params.id);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });
    cycles.unfinalize.run(req.params.id);
    res.json({ ok: true, cycle: cycles.byId.get(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cycles/:id/bill  — just the calculated bill
router.get("/:id/bill", (req, res) => {
  try {
    const cycle = cycles.byId.get(req.params.id);
    if (!cycle) return res.status(404).json({ error: "Cycle not found" });
    res.json(computeBill(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dinner entries ────────────────────────────────────────────────────────

// PUT /api/cycles/:id/dinners  [{ person_id, dinner_count, notes }]
// Bulk upsert dinner counts for the cycle.
router.put("/:id/dinners", (req, res) => {
  const entries = req.body; // array
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: "Body must be an array of dinner entries" });
  }
  try {
    for (const entry of entries) {
      dinners.upsert.run({
        id: uuidv4(),
        cycle_id: req.params.id,
        person_id: entry.person_id,
        dinner_count: Number(entry.dinner_count) || 0,
        notes: entry.notes || null,
      });
    }
    res.json(dinners.byCycle.all(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Personal receipts ─────────────────────────────────────────────────────

// GET /api/cycles/:id/receipts
router.get("/:id/receipts", (req, res) => {
  try {
    res.json(receipts.byCycle.all(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cycles/:id/receipts  { person_id, amount, note, date }
router.post("/:id/receipts", (req, res) => {
  const { person_id, amount, note, date } = req.body;
  if (!person_id || !amount) {
    return res.status(400).json({ error: "person_id and amount are required" });
  }
  try {
    const id = uuidv4();
    receipts.insert.run({
      id,
      cycle_id: req.params.id,
      person_id,
      amount: Number(amount),
      note: note || null,
      date: date || new Date().toISOString().slice(0, 10),
    });
    res.status(201).json(receipts.byCycle.all(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cycles/:id/receipts/:receiptId
router.delete("/:id/receipts/:receiptId", (req, res) => {
  try {
    receipts.delete.run(req.params.receiptId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
