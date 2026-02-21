/**
 * src/api.js
 * Thin wrapper around fetch() for the GrocSplit backend.
 * Import and use in your React components.
 */

const BASE = "http://localhost:3001/api";

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── People ─────────────────────────────────────────────────────────────────
export const getPeople     = ()              => request("GET",    "/people");
export const addPerson     = (name)          => request("POST",   "/people", { name });
export const renamePerson  = (id, name)      => request("PATCH",  `/people/${id}`, { name });
export const removePerson  = (id)            => request("DELETE", `/people/${id}`);

// ── Cycles ─────────────────────────────────────────────────────────────────
export const getCycles     = ()              => request("GET",    "/cycles");
export const createCycle   = (month_key)     => request("POST",   "/cycles", { month_key });
export const getCycle      = (id)            => request("GET",    `/cycles/${id}`);
export const finalizeCycle = (id)            => request("POST",   `/cycles/${id}/finalize`);
export const getBill       = (id)            => request("GET",    `/cycles/${id}/bill`);

// ── Dinners ────────────────────────────────────────────────────────────────
// entries: [{ person_id, dinner_count, notes }]
export const saveDinners   = (cycleId, entries) =>
  request("PUT", `/cycles/${cycleId}/dinners`, entries);

// ── Personal receipts ──────────────────────────────────────────────────────
export const getReceipts   = (cycleId)       => request("GET",    `/cycles/${cycleId}/receipts`);
export const addReceipt    = (cycleId, body) => request("POST",   `/cycles/${cycleId}/receipts`, body);
export const deleteReceipt = (cycleId, id)   => request("DELETE", `/cycles/${cycleId}/receipts/${id}`);

// ── Transactions ───────────────────────────────────────────────────────────
export const getTransactions    = (cycleId)      => request("GET",    `/cycles/${cycleId}/transactions`);
export const addTransaction     = (cycleId, body) => request("POST",  `/cycles/${cycleId}/transactions`, body);
export const setVerified        = (cycleId, txId, verified) =>
  request("PATCH", `/cycles/${cycleId}/transactions/${txId}`, { verified });
export const deleteTransaction  = (cycleId, txId) =>
  request("DELETE", `/cycles/${cycleId}/transactions/${txId}`);

// ── Plaid ──────────────────────────────────────────────────────────────────
export const getPlaidStatus    = ()         => request("GET",  "/plaid/status");
export const getLinkToken      = ()         => request("POST", "/plaid/link-token");
export const exchangeToken     = (body)     => request("POST", "/plaid/exchange", body);
export const syncPlaid         = (cycleId)  => request("POST", `/plaid/sync/${cycleId}`);
