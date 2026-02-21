/**
 * server/index.js
 * GrocSplit Express API server.
 *
 * sql.js initialises asynchronously (loads WASM), so we await db.init()
 * before registering routes and starting the listener.
 *
 * Start with:   npm start          (production)
 *               npm run dev        (development, auto-restarts on change)
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");

async function startServer() {
  // ── 1. Initialise the database first ──────────────────────────────────────
  const dbModule = require("../db");
  await dbModule.init();      // loads sql.js WASM + opens/creates grocsplit.db
  dbModule.buildQueries();    // prepares all SQL statements against the live db

  // ── 2. Create Express app ─────────────────────────────────────────────────
  const app = express();
  const PORT = process.env.PORT || 3001;

  app.use(cors({
    origin: [
      "http://localhost:3000",   // React dev server (CRA)
      "http://localhost:5173",   // Vite dev server
      // Codespaces forwards a dynamic HTTPS URL — allow any *.app.github.dev origin
      /https:\/\/.*\.app\.github\.dev$/,
    ],
    credentials: true,
  }));

  app.use(express.json());

  // Simple request logger
  app.use((req, _res, next) => {
    console.log(`${new Date().toISOString()}  ${req.method.padEnd(6)} ${req.path}`);
    next();
  });

  // ── 3. Mount routes ───────────────────────────────────────────────────────
  const peopleRouter       = require("../routes/people");
  const cyclesRouter       = require("../routes/cycles");
  const transactionsRouter = require("../routes/transactions");
  const plaidRouter        = require("../routes/plaid");

  app.use("/api/people",                          peopleRouter);
  app.use("/api/cycles",                          cyclesRouter);
  app.use("/api/plaid",                           plaidRouter);
  app.use("/api/cycles/:cycleId/transactions",    transactionsRouter);

  // ── 4. Health check ───────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      db: "sql.js",
      plaid_env: process.env.PLAID_ENV || "not set",
      ts: new Date().toISOString(),
    });
  });

  // ── 5. 404 + error handlers ───────────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  app.use((err, _req, res, _next) => {
    console.error("[Error]", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  // ── 6. Listen ─────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║  GrocSplit API running                   ║
║  http://localhost:${PORT}                   ║
║  DB engine : sql.js (pure JS)            ║
║  Plaid env : ${(process.env.PLAID_ENV || "not set").padEnd(29)}║
╚══════════════════════════════════════════╝
    `);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
