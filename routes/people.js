/**
 * routes/people.js
 * CRUD for household members.
 */

const express = require("express");
const router = express.Router();
const { people, uuidv4 } = require("../db");

// GET /api/people
router.get("/", (req, res) => {
  try {
    const rows = people.all.all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/people  { name }
router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    const id = uuidv4();
    people.insert.run({ id, name: name.trim() });
    res.status(201).json(people.byId.get(id));
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "A person with that name already exists." });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/people/:id  { name }
router.patch("/:id", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  try {
    people.rename.run({ id: req.params.id, name: name.trim() });
    res.json(people.byId.get(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/people/:id  (soft delete)
router.delete("/:id", (req, res) => {
  try {
    people.deactivate.run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
