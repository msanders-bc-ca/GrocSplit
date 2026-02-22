#!/usr/bin/env node
/**
 * scripts/check-plaid.js
 * Validates your Plaid credentials by making a real API call.
 * Run: node scripts/check-plaid.js
 */

require("dotenv").config();
const { PlaidApi, PlaidEnvironments, Configuration } = require("plaid");

const clientId = process.env.PLAID_CLIENT_ID;
const secret   = process.env.PLAID_SECRET;
const env      = process.env.PLAID_ENV || "sandbox";

console.log("\n── Plaid credential check ──────────────────────────");
console.log(`  PLAID_ENV       : ${env}`);
console.log(`  PLAID_CLIENT_ID : ${clientId || "(not set)"}`);
console.log(`  PLAID_SECRET    : ${secret ? secret.slice(0, 4) + "…" + secret.slice(-4) : "(not set)"}`);
console.log(`  Base URL        : ${PlaidEnvironments[env] || "(unknown env)"}`);
console.log("────────────────────────────────────────────────────\n");

if (!clientId || !secret) {
  console.error("❌  Missing credentials — set PLAID_CLIENT_ID and PLAID_SECRET in .env");
  process.exit(1);
}

if (!PlaidEnvironments[env]) {
  console.error(`❌  Unknown PLAID_ENV "${env}" — must be sandbox, development, or production`);
  process.exit(1);
}

const client = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: { headers: {
    "PLAID-CLIENT-ID": clientId,
    "PLAID-SECRET":    secret,
  }},
}));

console.log("Testing credentials with a link token request…\n");

client.linkTokenCreate({
  user:          { client_user_id: "grocsplit-check" },
  client_name:   "GrocSplit",
  products:      ["transactions"],
  country_codes: ["CA"],
  language:      "en",
}).then(() => {
  console.log("✅  Credentials are valid!\n");
  console.log("Next step: click 'Connect Bank' in the app to link your account.");
}).catch((err) => {
  const d = err.response?.data;
  if (d) {
    console.error("❌  Plaid API error:");
    console.error(`    error_code    : ${d.error_code}`);
    console.error(`    error_message : ${d.error_message}`);
    if (d.error_code === "INVALID_API_KEYS") {
      console.error("\n  How to fix:");
      console.error("  1. Go to https://dashboard.plaid.com");
      console.error("  2. Team Settings → Keys");
      console.error("  3. Copy your client_id and the secret for your environment:");
      console.error(`       ${env} secret → paste as PLAID_SECRET in .env`);
      if (env !== "production") {
        console.error("  4. If you want to connect a real bank, change PLAID_ENV=development");
        console.error("     and paste the development secret instead.");
      }
    }
  } else {
    console.error("❌  Request failed:", err.message);
  }
  process.exit(1);
});
