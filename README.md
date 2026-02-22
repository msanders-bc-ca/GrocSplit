# GrocSplit

A household grocery bill splitting app. Track shared grocery spending across a monthly billing cycle, log how many dinners each person ate, and automatically calculate what each person owes — with support for bank sync via Plaid, CSV import from CIBC, and manual entry.

---

## How It Works

Each month you run a billing cycle:

1. **Import transactions** — sync from your CIBC Visa via Plaid, upload a CIBC CSV export, or enter purchases manually
2. **Enter dinner counts** — use the +/− stepper for each person to record how many dinners they ate that month (guests count toward the person who hosted them)
3. **Log personal receipts** — if someone paid for groceries out of pocket (cash, their own card), record it under their name in the per-person breakdown
4. **Review and verify** — check off transactions in the Transactions tab once you've confirmed them against your records
5. **View the bill** — each person's share is proportional to their dinner count, minus anything they already paid out of pocket
6. **Finalize** — lock the cycle when the month is settled; you can always unfinalize to make corrections

**Billing formula:**
> Total grocery spend = shared transactions + all personal receipts
> Each person owes = total × (their dinners / total dinners) − what they already paid

---

## Project Structure

```
GrocSplit/
├── client/                     ← React + Vite frontend
│   ├── src/
│   │   ├── App.jsx             ← Single-file React app (all UI + state)
│   │   ├── api.js              ← fetch() wrapper for the backend API
│   │   └── main.jsx            ← Vite entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── server/
│   └── index.js                ← Express server entry point
├── routes/
│   ├── people.js               ← Household members CRUD
│   ├── cycles.js               ← Billing cycles, dinners, personal receipts
│   ├── transactions.js         ← Shared transaction management + CSV import
│   └── plaid.js                ← Plaid Link flow + bank sync
├── db/
│   ├── index.js                ← sql.js (SQLite) connection + all queries
│   ├── migrate.js              ← Create/upgrade schema (run once)
│   └── seed.js                 ← Optional: populate with sample data
├── scripts/
│   └── check-plaid.js          ← Validate Plaid credentials
├── start.sh                    ← One-command launcher for both servers
├── .env                        ← Your local environment config (not committed)
├── .env.example                ← Template for .env
└── package.json
```

---

## Prerequisites

- **Node.js** 18+ — check with `node -v`
- **npm** 9+ — check with `npm -v`
- A **Plaid** developer account (free at [plaid.com](https://plaid.com)) — only needed for bank sync; CSV import and manual entry work without it

---

## Setup

### 1. Install dependencies

```bash
npm run setup
```

This installs both the root (API) and `client/` (frontend) dependencies in one step.

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
PLAID_CLIENT_ID=your_client_id       # from Plaid Dashboard → Team Settings → Keys
PLAID_SECRET=your_sandbox_secret     # use Sandbox secret to start
PLAID_ENV=sandbox                    # sandbox | development | production
DB_PATH=./grocsplit.db
```

You can leave the Plaid fields blank if you only plan to use CSV import or manual entry.

### 3. Initialize the database

```bash
node db/migrate.js
```

Creates `grocsplit.db` with all tables. Safe to re-run — it uses `CREATE TABLE IF NOT EXISTS`.

### 4. Start the app

```bash
./start.sh
```

This single command:
- Checks that `.env` exists (copies `.env.example` if not)
- Installs any missing dependencies automatically
- Starts the API server at **http://localhost:3001**
- Starts the Vite frontend at **http://localhost:5173**
- Press `Ctrl+C` to stop both

Open **http://localhost:5173** in your browser.

**Optional — start with sample data:**
```bash
./start.sh --seed
```

---

## Using the App

The app has four tabs: **Cycle**, **Transactions**, **People**, and **History**.

### People tab

Add everyone in the household here first. People persist across all billing cycles. To remove someone, click Remove — they are soft-deleted and won't appear in new cycles.

### Cycle tab

The main billing view for the current month.

**Navigating months** — use the ← and → arrows to move between billing cycles. Click **+ New Month** to create a cycle for an upcoming or past month.

**Dinner entry** — each person has a +/− stepper. Tap + for every dinner they ate that month. Dinner counts save automatically after a short pause.

**Personal receipts** — click the receipt area under a person's name to expand it. Enter an amount, note, and date, then click Add. These represent grocery purchases that person paid for out of their own pocket — they are included in the household total and credited back to that person's balance.

**Bill summary** — once dinners are entered, the Final Bill Summary table shows each person's share, what they've paid, and their remaining balance. Use **Copy Summary** to copy a formatted text version to your clipboard (useful for sharing in a group chat).

**Finalize / Unfinalize** — click **Finalize Month** to lock the cycle. Finalized cycles are read-only. Click **Unfinalize** to reopen if corrections are needed.

### Transactions tab

All grocery charges for the current cycle in one place.

**Plaid bank sync** — if you've connected your CIBC Visa, click **Sync Now** to pull transactions for this cycle's date range. Only transactions matching grocery categories or your `GROCERY_KEYWORDS` list are imported. Re-syncing is safe — duplicates are skipped automatically.

**Connect Bank** — click to open the Plaid Link flow and authorize your bank account. You only need to do this once; the connection persists for future syncs.

**Import CSV** — click **Import CSV** and select a CIBC credit card CSV export file. The file format expected is:

```
2025-12-29,"PHARMASAVE 115 VICTORIA, BC",51.20,,4500********6473
```

Five columns: `date, vendor, debit amount, credit amount, card number`. Credits (refunds) are skipped automatically. Re-importing the same file is safe — rows are deduplicated by a fingerprint of the date, vendor, and amount.

**Manual entry** — click **+ Manual** to add a cash or debit grocery purchase directly.

**Transaction list** — all entries are shown in a unified table sorted by date. Rows from the bank show a Visa badge, CSV imports show a CSV badge, and manual entries show a Manual badge. Use the checkbox to mark a transaction as verified. Use **Remove** to delete an entry.

### History tab

Lists all billing cycles from newest to oldest. Click **Summary** to view a pop-up with the bill breakdown for that month. Click **Switch to** to navigate to that cycle in the Cycle tab.

---

## Plaid Setup (optional — for bank sync)

1. Go to [dashboard.plaid.com](https://dashboard.plaid.com) and sign up for a free account
2. Create an app and copy your **Client ID** and **Sandbox Secret** into `.env`
3. Verify credentials work:
   ```bash
   npm run check-plaid
   ```
4. When ready for real CIBC data, switch to Development:
   - Set `PLAID_ENV=development` in `.env`
   - Use your **Development Secret** instead of the Sandbox secret
   - Plaid Development supports real Canadian bank accounts including CIBC

You can also filter which transactions are imported as groceries by adding keywords to `.env`:
```env
GROCERY_KEYWORDS=superstore,sobeys,safeway,walmart,save-on,pharmasave,costco
```

---

## npm Scripts

| Command | Description |
|---------|-------------|
| `./start.sh` | Start both API and frontend (recommended) |
| `npm run dev` | Same as start.sh — runs API + frontend via concurrently |
| `npm run dev:api` | API server only (nodemon, auto-restarts) |
| `npm run dev:ui` | Vite frontend only |
| `npm start` | Production API server (no auto-restart) |
| `npm run setup` | Install all dependencies (root + client) |
| `npm run check-plaid` | Validate Plaid credentials against the API |
| `node db/migrate.js` | Create or update the database schema |
| `node db/seed.js` | Load sample data |

---

## Full API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/people` | List active household members |
| POST | `/api/people` | Add a person `{ name }` |
| PATCH | `/api/people/:id` | Rename a person `{ name }` |
| DELETE | `/api/people/:id` | Soft-remove a person |
| GET | `/api/cycles` | List all billing cycles |
| POST | `/api/cycles` | Create a cycle `{ month_key: "2025-02" }` |
| GET | `/api/cycles/:id` | Full cycle detail (transactions, dinners, receipts, bill) |
| GET | `/api/cycles/:id/bill` | Computed bill only |
| POST | `/api/cycles/:id/finalize` | Lock a cycle |
| POST | `/api/cycles/:id/unfinalize` | Unlock a cycle |
| PUT | `/api/cycles/:id/dinners` | Save dinner counts (array) |
| POST | `/api/cycles/:id/receipts` | Add personal receipt `{ person_id, amount, note, date }` |
| DELETE | `/api/cycles/:id/receipts/:rid` | Remove personal receipt |
| GET | `/api/cycles/:id/transactions` | List transactions |
| POST | `/api/cycles/:id/transactions` | Add manual transaction `{ merchant, amount, date }` |
| POST | `/api/cycles/:id/transactions/import-csv` | Import CIBC CSV `{ csv: "<text>" }` |
| PATCH | `/api/cycles/:id/transactions/:tid` | Toggle verified `{ verified: true }` |
| DELETE | `/api/cycles/:id/transactions/:tid` | Remove a transaction |
| GET | `/api/plaid/status` | Check if a bank account is connected |
| POST | `/api/plaid/link-token` | Create Plaid Link token |
| POST | `/api/plaid/exchange` | Exchange public_token for access_token |
| POST | `/api/plaid/sync/:cycleId` | Pull grocery transactions from Plaid |

---

## Database Schema

```
people              — household members (persist across cycles)
cycles              — one row per month (month_key, date_from, date_to, finalized)
plaid_items         — stored Plaid access token after bank link
transactions        — all grocery charges (source: visa | csv | receipt)
dinner_entries      — per-person dinner counts per cycle
personal_receipts   — out-of-pocket payments per person per cycle
```

---

## Security Notes

- **Access tokens** — Plaid access tokens are stored in plaintext in the local SQLite file. For a household-only tool on localhost this is acceptable. Do not expose the API server to the internet.
- **Local only** — designed to run on `localhost`. For multi-device access within your home, run it on a Raspberry Pi or home server and restrict to your LAN.
- **`.env` file** — already in `.gitignore`. Never commit it.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| App won't start | Run `npm run setup` to install missing dependencies |
| `PLAID_CLIENT_ID not set` | Check your `.env` file |
| Plaid returns `INVALID_API_KEYS` | Run `npm run check-plaid` — verify keys at dashboard.plaid.com |
| Plaid imports 0 grocery transactions | Add store names to `GROCERY_KEYWORDS` in `.env` |
| CSV import shows parse errors | Check the file is a CIBC credit card CSV (not chequing) |
| SQLite error on startup | Run `node db/migrate.js` to create the schema |
| CORS error in browser | Frontend must run on port 5173 (Vite default) — `./start.sh` handles this |
| Changes not saving | The cycle may be finalized — click Unfinalize to edit |
