/**
 * routes/plaid.js
 *
 * Handles the full Plaid Link flow:
 *   1. POST /api/plaid/link-token    → create a Link token (frontend opens Plaid Link)
 *   2. POST /api/plaid/exchange      → exchange public_token for access_token, store it
 *   3. POST /api/plaid/sync/:cycleId → pull grocery transactions for a cycle's date range
 *   4. GET  /api/plaid/status        → check whether an item is connected
 */

const express = require("express");
const router = express.Router();
const { PlaidApi, PlaidEnvironments, Configuration } = require("plaid");
const { plaid: plaidDb, tx, cycles, uuidv4 } = require("../db");

// ── Plaid client setup ───────────────────────────────────────────────────────

const plaidEnv = process.env.PLAID_ENV || "sandbox";

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

// ── Grocery filter ───────────────────────────────────────────────────────────

function isGrocery(transaction) {
  const keywords = (process.env.GROCERY_KEYWORDS || "").split(",").map((k) => k.trim().toLowerCase());

  const name = (transaction.merchant_name || transaction.name || "").toLowerCase();

  // Match by keyword
  if (keywords.some((kw) => kw && name.includes(kw))) return true;

  // Match by Plaid category: personal_finance_category or legacy categories
  const cats = [
    ...(transaction.personal_finance_category?.detailed ? [transaction.personal_finance_category.detailed] : []),
    ...(transaction.category || []),
  ].map((c) => c.toLowerCase());

  return cats.some((c) =>
    c.includes("groceries") || c.includes("supermarket") || c.includes("food and drink")
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

// 1. Create a Link token — called when the user clicks "Connect Bank"
// POST /api/plaid/link-token
router.post("/link-token", async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "grocsplit-household" },
      client_name: "GrocSplit",
      products: ["transactions"],
      country_codes: ["CA"],      // Canada — CIBC is supported
      language: "en",
      // Optional: pre-select CIBC
      // institution_id: "ins_9",  // Plaid's ID for CIBC in sandbox
    });

    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error("[Plaid] link-token error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to create Plaid link token", detail: err.response?.data });
  }
});

// 2. Exchange the public_token from Plaid Link for a persistent access_token
// POST /api/plaid/exchange  { public_token, institution_name }
router.post("/exchange", async (req, res) => {
  const { public_token, institution_name } = req.body;
  if (!public_token) return res.status(400).json({ error: "public_token is required" });

  try {
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    plaidDb.insert.run({
      id: uuidv4(),
      item_id,
      access_token,
      institution: institution_name || "Unknown",
    });

    res.json({ ok: true, item_id, institution: institution_name });
  } catch (err) {
    console.error("[Plaid] exchange error:", err.response?.data || err.message);
    res.status(500).json({ error: "Failed to exchange token", detail: err.response?.data });
  }
});

// 3. Sync grocery transactions for a cycle
// POST /api/plaid/sync/:cycleId
router.post("/sync/:cycleId", async (req, res) => {
  const cycle = cycles.byId.get(req.params.cycleId);
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });

  const item = plaidDb.first.get();
  if (!item) {
    return res.status(400).json({ error: "No Plaid account connected. Complete Link first." });
  }

  try {
    // Fetch all transactions in the cycle's date window
    const txResponse = await plaidClient.transactionsGet({
      access_token: item.access_token,
      start_date: cycle.date_from,
      end_date: cycle.date_to,
      options: {
        count: 500,
        include_personal_finance_category: true,
      },
    });

    const allTransactions = txResponse.data.transactions;

    // Filter to grocery-related transactions
    const groceryTxs = allTransactions.filter(isGrocery);

    let added = 0;
    let skipped = 0;

    for (const t of groceryTxs) {
      // Plaid amounts are positive for debits in Canada; confirm positive
      const amount = Math.abs(t.amount);
      if (amount <= 0) { skipped++; continue; }

      // Skip if this Plaid transaction was already imported (any cycle)
      const existing = tx.byPlaidId.get({ plaid_id: t.transaction_id });
      if (existing) { skipped++; continue; }

      tx.insert.run({
        id: uuidv4(),
        cycle_id: cycle.id,
        plaid_id: t.transaction_id,
        date: t.date,
        merchant: t.merchant_name || t.name,
        amount,
        source: "visa",
        notes: null,
      });

      added++;
    }

    // Mark item as synced
    plaidDb.updateSynced.run(item.item_id);

    res.json({
      ok: true,
      added,
      skipped,
      total_plaid_transactions: allTransactions.length,
      grocery_transactions: groceryTxs.length,
      date_range: { from: cycle.date_from, to: cycle.date_to },
    });
  } catch (err) {
    console.error("[Plaid] sync error:", err.response?.data || err.message);
    res.status(500).json({ error: "Plaid sync failed", detail: err.response?.data });
  }
});

// 4. Check connection status
// GET /api/plaid/status
router.get("/status", (req, res) => {
  const item = plaidDb.first.get();
  if (!item) return res.json({ connected: false });
  res.json({
    connected: true,
    institution: item.institution,
    last_synced: item.last_synced,
  });
});

module.exports = router;
