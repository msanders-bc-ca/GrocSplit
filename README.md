# 🛒 GrocSplit

A local household grocery bill splitting app with CIBC Visa integration via Plaid.

## How It Works

Each month you run a billing cycle:
1. **Sync** grocery transactions from your CIBC Visa via Plaid (or add receipts manually)
2. **Enter dinner counts** per person (including their guests)
3. **Log personal receipts** — amounts each person paid out of their own pocket
4. **Check off** verified transactions (paper receipt or Visa record confirmed)
5. **View the bill** — each person's share is proportional to their dinner count, minus what they already paid

---

## Project Structure

```
grocsplit/
├── server/
│   └── index.js          ← Express server entry point
├── routes/
│   ├── people.js         ← Household members CRUD
│   ├── cycles.js         ← Monthly billing cycles, dinners, personal receipts
│   ├── transactions.js   ← Transaction management
│   └── plaid.js          ← Plaid Link flow + sync
├── db/
│   ├── index.js          ← SQLite connection + all prepared statements
│   ├── migrate.js        ← Create/upgrade schema (run once)
│   └── seed.js           ← Optional: populate with sample data
├── src/
│   └── api.js            ← Frontend fetch() wrapper (copy into your React app)
├── .env.example          ← Environment variable template
└── package.json
```

---

## Prerequisites

- **Node.js** 18+ (check: `node -v`)
- **npm** 9+ (check: `npm -v`)
- A **Plaid** developer account (free at [plaid.com](https://plaid.com))

---

## 1. Install

```bash
cd grocsplit
npm install
```

---

## 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
PLAID_CLIENT_ID=your_client_id       # from Plaid Dashboard
PLAID_SECRET=your_sandbox_secret     # use Sandbox secret to start
PLAID_ENV=sandbox                    # sandbox → development → production
DB_PATH=./grocsplit.db
```

### Plaid Setup Steps

1. Go to [dashboard.plaid.com](https://dashboard.plaid.com) → sign up free
2. Create an app → copy your **Client ID** and **Sandbox Secret**
3. Under "API" settings, add `http://localhost:3000` to allowed redirect URIs
4. When ready for real CIBC data:
   - Switch `PLAID_ENV=development` and use your **Development Secret**
   - Plaid Development supports real Canadian bank accounts (CIBC is supported)
   - Apply for Production access when needed (requires Plaid approval)

---

## 3. Initialize the Database

```bash
node db/migrate.js
```

This creates `grocsplit.db` (SQLite file) with all tables. Safe to re-run.

Optional — load sample data for testing:
```bash
node db/seed.js
```

---

## 4. Start the Server

```bash
npm run dev     # development (auto-restarts on file changes)
# or
npm start       # production
```

Server runs at **http://localhost:3001**

Verify it's working:
```bash
curl http://localhost:3001/api/health
```

---

## 5. Connect the React Frontend

In your React app's root, copy `src/api.js` and install the Plaid Link SDK:

```bash
npm install react-plaid-link
```

### Plaid Link Flow in React

```jsx
import { usePlaidLink } from 'react-plaid-link';
import { getLinkToken, exchangeToken, syncPlaid } from './api';

function ConnectBankButton({ cycleId, onSynced }) {
  const [linkToken, setLinkToken] = React.useState(null);

  React.useEffect(() => {
    getLinkToken().then(d => setLinkToken(d.link_token));
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      // Step 1: Exchange public_token for persistent access_token
      await exchangeToken({
        public_token,
        institution_name: metadata.institution?.name,
      });
      // Step 2: Sync grocery transactions for this cycle
      const result = await syncPlaid(cycleId);
      console.log(`Synced: ${result.added} new grocery transactions`);
      onSynced();
    },
  });

  return (
    <button onClick={() => open()} disabled={!ready}>
      Connect CIBC via Plaid
    </button>
  );
}
```

Once connected, subsequent syncs (new months) only need `syncPlaid(cycleId)` — no need to re-link.

---

## 6. Monthly Workflow

### Start a new month

```bash
# Via the API (or wire a button in your React app)
curl -X POST http://localhost:3001/api/cycles \
  -H "Content-Type: application/json" \
  -d '{"month_key": "2025-02"}'
```

### Sync transactions from Plaid

```bash
curl -X POST http://localhost:3001/api/plaid/sync/{cycleId}
```

### Save dinner counts

```bash
curl -X PUT http://localhost:3001/api/cycles/{cycleId}/dinners \
  -H "Content-Type: application/json" \
  -d '[
    {"person_id": "uuid-alex",   "dinner_count": 18},
    {"person_id": "uuid-jordan", "dinner_count": 14},
    {"person_id": "uuid-taylor", "dinner_count": 22}
  ]'
```

### Add a personal receipt (what someone paid out of pocket)

```bash
curl -X POST http://localhost:3001/api/cycles/{cycleId}/receipts \
  -H "Content-Type: application/json" \
  -d '{"person_id": "uuid-alex", "amount": 45.00, "note": "Farmers market", "date": "2025-02-08"}'
```

### View the final bill

```bash
curl http://localhost:3001/api/cycles/{cycleId}/bill
```

Response:
```json
{
  "total": 665.51,
  "totalDinners": 54,
  "billRows": [
    {
      "person_name": "Alex",
      "dinner_count": 18,
      "pct": 33.33,
      "owes": 221.84,
      "paid": 45.00,
      "balance": 176.84
    },
    ...
  ]
}
```

---

## Full API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/people` | List all active household members |
| POST | `/api/people` | Add a person `{ name }` |
| PATCH | `/api/people/:id` | Rename a person |
| DELETE | `/api/people/:id` | Soft-remove a person |
| GET | `/api/cycles` | List all billing cycles |
| POST | `/api/cycles` | Create a new cycle `{ month_key }` |
| GET | `/api/cycles/:id` | Full cycle detail (transactions, dinners, receipts, bill) |
| GET | `/api/cycles/:id/bill` | Computed bill only |
| POST | `/api/cycles/:id/finalize` | Lock a cycle |
| PUT | `/api/cycles/:id/dinners` | Save dinner counts (array) |
| POST | `/api/cycles/:id/receipts` | Add personal receipt |
| DELETE | `/api/cycles/:id/receipts/:rid` | Remove personal receipt |
| GET | `/api/cycles/:id/transactions` | List transactions |
| POST | `/api/cycles/:id/transactions` | Add manual transaction |
| PATCH | `/api/cycles/:id/transactions/:tid` | Toggle verified `{ verified: true }` |
| DELETE | `/api/cycles/:id/transactions/:tid` | Remove transaction |
| GET | `/api/plaid/status` | Check if a bank account is connected |
| POST | `/api/plaid/link-token` | Create Plaid Link token |
| POST | `/api/plaid/exchange` | Exchange public_token → access_token |
| POST | `/api/plaid/sync/:cycleId` | Pull grocery transactions from Plaid |

---

## Database Schema

```
people              — household members (persist across cycles)
cycles              — one row per month (month_key, date_from, date_to)
plaid_items         — stored access tokens after Plaid Link
transactions        — grocery charges (Plaid or manual)
dinner_entries      — per-person dinner counts per cycle
personal_receipts   — out-of-pocket payments per person per cycle
```

---

## Security Notes

- **Access tokens**: Plaid access tokens are stored in plaintext in SQLite. For a household-only tool this is acceptable. For extra security, encrypt the `access_token` column using `node-sqlite3-wasm` with SQLCipher, or store tokens in the OS keychain.
- **Local only**: This server is designed to run on `localhost` and should not be exposed to the internet. If you want multi-device access within your home, run it on a Raspberry Pi or home server and restrict to your LAN.
- **`.env` file**: Never commit `.env` to git. Add it to `.gitignore`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `PLAID_CLIENT_ID not set` | Check your `.env` file and re-run `npm run dev` |
| Plaid returns 0 grocery transactions | Add your store names to `GROCERY_KEYWORDS` in `.env` |
| `UNIQUE constraint failed: people.name` | Person already exists — use rename instead |
| SQLite error on startup | Run `node db/migrate.js` first |
| CORS error in browser | Ensure React runs on port 3000 or 5173 (configured in server/index.js) |
