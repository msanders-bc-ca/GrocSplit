/**
 * server/index.js
 * GrocSplit Express API server.
 *
 * Start with:   npm start          (production)
 *               npm run dev        (development, auto-restarts on change)
 *
 * Make sure you've run:
 *   cp .env.example .env        (fill in your Plaid credentials)
 *   node db/migrate.js          (create the SQLite schema)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin: [
    "http://localhost:3000",  // React dev server (Create React App / Vite)
    "http://localhost:5173",  // Vite alternative port
  ],
  credentials: true,
}));

app.use(express.json());

// Request logger (simple, no dependencies)
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)} ${req.path}`);
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

const peopleRouter      = require("../routes/people");
const cyclesRouter      = require("../routes/cycles");
const transactionsRouter = require("../routes/transactions");
const plaidRouter       = require("../routes/plaid");

app.use("/api/people",       peopleRouter);
app.use("/api/cycles",       cyclesRouter);
app.use("/api/plaid",        plaidRouter);

// Transactions are nested under cycles
app.use("/api/cycles/:cycleId/transactions", transactionsRouter);

// ── Health check ─────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", env: process.env.PLAID_ENV || "not set", ts: new Date().toISOString() });
});

// ── 404 fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ── Global error handler ──────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error("[Error]", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  GrocSplit API running                   ║
║  http://localhost:${PORT}                   ║
║  Plaid env: ${(process.env.PLAID_ENV || "not set").padEnd(29)}║
╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
