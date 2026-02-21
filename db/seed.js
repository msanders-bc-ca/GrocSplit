/**
 * db/seed.js
 * Populate the database with sample data for development / testing.
 * Run: node db/seed.js
 *
 * WARNING: This will INSERT sample data — run only on a fresh or dev database.
 */

require("dotenv").config();
const { db, people, cycles, tx, dinners, receipts, uuidv4 } = require("./index");

console.log("\n🌱  Seeding GrocSplit database…\n");

db.transaction(() => {
  // ── People ────────────────────────────────────────────────────────────────
  const peopleData = [
    { id: uuidv4(), name: "Alex" },
    { id: uuidv4(), name: "Jordan" },
    { id: uuidv4(), name: "Taylor" },
  ];

  for (const p of peopleData) {
    try {
      people.insert.run(p);
      console.log(`  ✓ Person: ${p.name}`);
    } catch {
      console.log(`  – Person already exists: ${p.name}`);
    }
  }

  // Re-fetch to get real IDs (in case people already existed)
  const allPeople = people.all.all();

  // ── Cycle: January 2025 ───────────────────────────────────────────────────
  const cycleId = uuidv4();
  try {
    cycles.insert.run({
      id: cycleId,
      month_key: "2025-01",
      label: "January 2025",
      date_from: "2025-01-01",
      date_to: "2025-01-31",
    });
    console.log(`  ✓ Cycle: January 2025`);
  } catch {
    console.log(`  – Cycle January 2025 already exists, skipping transactions.`);
    return;
  }

  // ── Transactions ──────────────────────────────────────────────────────────
  const sampleTx = [
    { merchant: "Loblaws",     amount: 127.43, date: "2025-01-04", source: "visa",    verified: 1 },
    { merchant: "Whole Foods", amount: 89.12,  date: "2025-01-07", source: "visa",    verified: 0 },
    { merchant: "Costco",      amount: 213.55, date: "2025-01-11", source: "visa",    verified: 1 },
    { merchant: "FreshCo",     amount: 54.20,  date: "2025-01-14", source: "visa",    verified: 0 },
    { merchant: "Metro",       amount: 102.87, date: "2025-01-19", source: "visa",    verified: 1 },
    { merchant: "NoFrills",    amount: 78.34,  date: "2025-01-23", source: "receipt", verified: 1 },
  ];

  for (const t of sampleTx) {
    tx.insert.run({ id: uuidv4(), cycle_id: cycleId, plaid_id: null, notes: null, ...t });
    console.log(`  ✓ Transaction: ${t.merchant} $${t.amount}`);
  }

  // ── Dinner entries ────────────────────────────────────────────────────────
  const dinnerCounts = [18, 14, 22]; // Alex, Jordan, Taylor
  allPeople.forEach((p, i) => {
    dinners.upsert.run({
      id: uuidv4(),
      cycle_id: cycleId,
      person_id: p.id,
      dinner_count: dinnerCounts[i] || 0,
      notes: null,
    });
    console.log(`  ✓ Dinners: ${p.name} → ${dinnerCounts[i]}`);
  });

  // ── Personal receipts ─────────────────────────────────────────────────────
  const sampleReceipts = [
    { personIdx: 0, amount: 45.00, note: "Farmers market Jan 5",  date: "2025-01-05" },
    { personIdx: 1, amount: 22.50, note: "Bulk store Jan 12",      date: "2025-01-12" },
  ];

  for (const r of sampleReceipts) {
    const person = allPeople[r.personIdx];
    if (!person) continue;
    receipts.insert.run({
      id: uuidv4(),
      cycle_id: cycleId,
      person_id: person.id,
      amount: r.amount,
      note: r.note,
      date: r.date,
    });
    console.log(`  ✓ Personal receipt: ${person.name} $${r.amount}`);
  }
})();

console.log("\n✅  Seed complete.\n");
