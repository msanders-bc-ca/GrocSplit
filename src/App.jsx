import { useState, useEffect, useRef } from "react";
import * as api from "./api";

// ── Palette & fonts injected via style tag ──────────────────────────────────
const GLOBAL_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;800&family=IBM+Plex+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0f1117;
    --surface: #181c27;
    --surface2: #1f2436;
    --border: #2a3050;
    --accent: #4fffb0;
    --accent2: #ff6b6b;
    --accent3: #ffcc44;
    --text: #e8eaf6;
    --muted: #6b7399;
    --font-head: 'Syne', sans-serif;
    --font-mono: 'IBM Plex Mono', monospace;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--font-head); }

  input, select, textarea {
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    border-radius: 6px;
    padding: 8px 12px;
    outline: none;
    width: 100%;
    transition: border-color .15s;
  }
  input:focus, select:focus { border-color: var(--accent); }

  button {
    cursor: pointer;
    font-family: var(--font-head);
    font-weight: 600;
    border: none;
    border-radius: 6px;
    padding: 9px 18px;
    font-size: 13px;
    transition: opacity .15s, transform .1s;
  }
  button:active { transform: scale(.97); }
  button:hover { opacity: .88; }

  .btn-primary { background: var(--accent); color: #0f1117; }
  .btn-danger  { background: var(--accent2); color: #fff; }
  .btn-ghost   { background: transparent; border: 1px solid var(--border); color: var(--muted); }
  .btn-warn    { background: var(--accent3); color: #0f1117; }

  .tag {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 99px;
    font-weight: 500;
  }
  .tag-green { background: #0d3326; color: var(--accent); }
  .tag-red   { background: #3a1a1a; color: var(--accent2); }
  .tag-yellow{ background: #3a2e00; color: var(--accent3); }

  .scrollbar-thin::-webkit-scrollbar { width: 4px; }
  .scrollbar-thin::-webkit-scrollbar-track { background: var(--surface); }
  .scrollbar-thin::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
  .fade-in { animation: fadeIn .25s ease both; }
`;

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => `$${Number(n).toFixed(2)}`;

function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("cycle");
  const [people, setPeople] = useState([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [receipts, setReceipts] = useState([]); // { id, personId, amount, note }
  const [dinners, setDinners] = useState({});   // { [personId]: count }
  const [cycleId, setCycleId] = useState(null);
  const [cycleName, setCycleName] = useState("");
  const [plaidStatus, setPlaidStatus] = useState("idle"); // idle | loading | done | error
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const dinnersModified = useRef(false);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      try {
        const [peopleData, allCycles] = await Promise.all([
          api.getPeople(),
          api.getCycles(),
        ]);
        setPeople(peopleData);

        const mk = monthKey();
        let cycle = allCycles.find((c) => c.month_key === mk);
        if (!cycle) cycle = await api.createCycle(mk);

        setCycleId(cycle.id);
        setCycleName(cycle.label);
        setHistory(allCycles.filter((c) => c.month_key !== mk));

        const detail = await api.getCycle(cycle.id);
        applyDetail(detail);
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  function applyDetail(detail) {
    setTransactions(detail.transactions.map((t) => ({ ...t, verified: !!t.verified })));
    setReceipts(
      detail.personalReceipts.map((r) => ({
        id: r.id,
        personId: r.person_id,
        amount: Number(r.amount),
        note: r.note,
      }))
    );
    const dm = {};
    for (const e of detail.dinnerEntries) dm[e.person_id] = e.dinner_count;
    setDinners(dm);
    dinnersModified.current = false;
  }

  // ── Auto-save dinners (debounced) ─────────────────────────────────────────
  useEffect(() => {
    if (!cycleId || !dinnersModified.current) return;
    const timer = setTimeout(() => {
      const entries = Object.entries(dinners).map(([person_id, dinner_count]) => ({
        person_id,
        dinner_count: Number(dinner_count) || 0,
      }));
      api.saveDinners(cycleId, entries).catch(console.error);
    }, 600);
    return () => clearTimeout(timer);
  }, [dinners, cycleId]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totalGroceries = transactions.reduce((s, t) => s + t.amount, 0);
  const totalDinners = people.reduce((s, p) => s + (Number(dinners[p.id]) || 0), 0);

  const bill = people.map((p) => {
    const pct = totalDinners > 0 ? (Number(dinners[p.id]) || 0) / totalDinners : 0;
    const owes = totalGroceries * pct;
    const paid = receipts.filter((r) => r.personId === p.id).reduce((s, r) => s + r.amount, 0);
    return { ...p, dinners: Number(dinners[p.id]) || 0, pct, owes, paid, balance: owes - paid };
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const addPerson = async () => {
    if (!newPersonName.trim()) return;
    try {
      const person = await api.addPerson(newPersonName.trim());
      setPeople((prev) => [...prev, person]);
      setNewPersonName("");
      if (cycleId) {
        await api.saveDinners(cycleId, [{ person_id: person.id, dinner_count: 0 }]);
        setDinners((prev) => ({ ...prev, [person.id]: 0 }));
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const removePerson = async (id) => {
    try {
      await api.removePerson(id);
      setPeople((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleVerified = async (id) => {
    const t = transactions.find((tx) => tx.id === id);
    if (!t || !cycleId) return;
    const next = !t.verified;
    // Optimistic update
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, verified: next } : tx)));
    try {
      await api.setVerified(cycleId, id, next);
    } catch (err) {
      // Revert on failure
      setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, verified: t.verified } : tx)));
    }
  };

  const addReceipt = async (personId, amount, note) => {
    if (!cycleId) return;
    try {
      const updated = await api.addReceipt(cycleId, { person_id: personId, amount: Number(amount), note });
      setReceipts(updated.map((r) => ({ id: r.id, personId: r.person_id, amount: Number(r.amount), note: r.note })));
    } catch (err) {
      alert(err.message);
    }
  };

  const removeReceipt = async (id) => {
    if (!cycleId) return;
    try {
      await api.deleteReceipt(cycleId, id);
      setReceipts((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePlaidSync = async () => {
    if (!cycleId) return;
    setPlaidStatus("loading");
    try {
      await api.syncPlaid(cycleId);
      const txList = await api.getTransactions(cycleId);
      setTransactions(txList.map((t) => ({ ...t, verified: !!t.verified })));
      setPlaidStatus("done");
    } catch (err) {
      setPlaidStatus("error");
    }
  };

  const addManualTransaction = async () => {
    if (!cycleId) return;
    const amt = prompt("Amount?");
    const merchant = prompt("Merchant?");
    if (!amt || !merchant) return;
    try {
      const updated = await api.addTransaction(cycleId, { merchant, amount: Number(amt), source: "receipt" });
      setTransactions(updated.map((t) => ({ ...t, verified: !!t.verified })));
    } catch (err) {
      alert(err.message);
    }
  };

  const removeTransaction = async (id) => {
    if (!cycleId) return;
    try {
      await api.deleteTransaction(cycleId, id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDinnerChange = (personId, value) => {
    dinnersModified.current = true;
    setDinners((prev) => ({ ...prev, [personId]: value }));
  };

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading) return (
    <>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 14 }}>
        Loading…
      </div>
    </>
  );

  if (loadError) return (
    <>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", flexDirection: "column", gap: 12 }}>
        <div style={{ color: "var(--accent2)", fontWeight: 700, fontSize: 18 }}>Could not reach backend</div>
        <div style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{loadError}</div>
        <button className="btn-primary" onClick={() => window.location.reload()}>Retry</button>
      </div>
    </>
  );

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{GLOBAL_STYLE}</style>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <header style={{ borderBottom: `1px solid var(--border)`, padding: "16px 32px", display: "flex", alignItems: "center", gap: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>
              <span style={{ color: "var(--accent)" }}>Groc</span>Split
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              household grocery billing
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 8 }}>
            {["cycle", "transactions", "people", "history"].map((t) => (
              <button
                key={t}
                className={tab === t ? "btn-primary" : "btn-ghost"}
                style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </header>

        <main style={{ flex: 1, padding: "28px 32px", maxWidth: 1100, width: "100%", margin: "0 auto" }}>

          {/* ── CYCLE TAB ── */}
          {tab === "cycle" && (
            <div className="fade-in">
              <SectionHeader title={`${cycleName} Billing Cycle`} subtitle="Enter dinner counts, add receipts, and review the bill" />

              {/* Summary bar */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 28 }}>
                {[
                  { label: "Total Groceries", value: fmt(totalGroceries), color: "var(--accent)" },
                  { label: "Total Dinners Logged", value: totalDinners, color: "var(--accent3)" },
                  { label: "Transactions", value: transactions.length, color: "var(--muted)" },
                ].map((s) => (
                  <div key={s.label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Per-person rows */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 28 }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)" }}>
                  Per-Person Breakdown
                </div>
                {people.length === 0 && (
                  <div style={{ padding: 24, color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    Add people in the People tab first.
                  </div>
                )}
                {people.map((p) => {
                  const b = bill.find((x) => x.id === p.id);
                  return (
                    <PersonRow
                      key={p.id}
                      person={p}
                      billData={b}
                      dinnerVal={dinners[p.id] || ""}
                      onDinnerChange={(v) => handleDinnerChange(p.id, v)}
                      receipts={receipts.filter((r) => r.personId === p.id)}
                      onAddReceipt={(amt, note) => addReceipt(p.id, amt, note)}
                      onRemoveReceipt={removeReceipt}
                    />
                  );
                })}
              </div>

              {/* Final bill table */}
              {people.length > 0 && totalDinners > 0 && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)" }}>
                    Final Bill Summary
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: "var(--muted)", fontSize: 11 }}>
                        {["Person","Dinners","%","Owes","Paid","Balance"].map((h) => (
                          <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bill.map((b) => (
                        <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "12px 20px", fontWeight: 600 }}>{b.name}</td>
                          <td style={{ padding: "12px 20px" }}>{b.dinners}</td>
                          <td style={{ padding: "12px 20px" }}>{(b.pct * 100).toFixed(1)}%</td>
                          <td style={{ padding: "12px 20px" }}>{fmt(b.owes)}</td>
                          <td style={{ padding: "12px 20px", color: "var(--accent)" }}>{fmt(b.paid)}</td>
                          <td style={{ padding: "12px 20px" }}>
                            <span className={`tag ${b.balance <= 0 ? "tag-green" : "tag-red"}`}>
                              {b.balance <= 0 ? `credit ${fmt(Math.abs(b.balance))}` : fmt(b.balance)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── TRANSACTIONS TAB ── */}
          {tab === "transactions" && (
            <div className="fade-in">
              <SectionHeader title="Transactions" subtitle="Visa & manual receipts — check off verified items" />

              {/* Plaid sync */}
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>CIBC Visa via Plaid</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    Pull transactions automatically for this billing period
                  </div>
                </div>
                {plaidStatus === "done" && <span className="tag tag-green">✓ Synced</span>}
                {plaidStatus === "loading" && <span className="tag tag-yellow">syncing…</span>}
                {plaidStatus === "error" && <span className="tag tag-red">sync failed</span>}
                <button className="btn-primary" onClick={handlePlaidSync} disabled={plaidStatus === "loading"}>
                  {plaidStatus === "loading" ? "Syncing…" : "Sync Plaid"}
                </button>
                <button className="btn-ghost" onClick={addManualTransaction}>+ Manual Receipt</button>
              </div>

              {/* Transaction list */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", fontSize: 11 }}>
                      {["Verified","Date","Merchant","Amount","Source",""].map((h) => (
                        <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid var(--border)", opacity: t.verified ? 0.7 : 1 }}>
                        <td style={{ padding: "12px 20px" }}>
                          <input type="checkbox" checked={t.verified} onChange={() => toggleVerified(t.id)}
                            style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                        </td>
                        <td style={{ padding: "12px 20px", color: "var(--muted)" }}>{t.date}</td>
                        <td style={{ padding: "12px 20px", fontWeight: 500 }}>{t.merchant}</td>
                        <td style={{ padding: "12px 20px", color: "var(--accent3)" }}>{fmt(t.amount)}</td>
                        <td style={{ padding: "12px 20px" }}>
                          <span className={`tag ${t.source === "visa" ? "tag-yellow" : "tag-green"}`}>
                            {t.source === "visa" ? "💳 Visa" : "🧾 Receipt"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 20px" }}>
                          <button className="btn-danger" style={{ padding: "4px 10px", fontSize: 11 }}
                            onClick={() => removeTransaction(t.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 20, fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>
                    {transactions.filter((t) => t.verified).length}/{transactions.length} verified
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>Total: {fmt(totalGroceries)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── PEOPLE TAB ── */}
          {tab === "people" && (
            <div className="fade-in">
              <SectionHeader title="Household Members" subtitle="People are remembered across monthly cycles" />
              <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
                <input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="New person's name" onKeyDown={(e) => e.key === "Enter" && addPerson()}
                  style={{ maxWidth: 280 }} />
                <button className="btn-primary" onClick={addPerson}>Add Person</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                {people.map((p) => (
                  <div key={p.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{p.name}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
                      {receipts.filter((r) => r.personId === p.id).length} receipts this cycle
                    </div>
                    <button className="btn-danger" style={{ fontSize: 11, padding: "6px 12px", marginTop: "auto" }}
                      onClick={() => removePerson(p.id)}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── HISTORY TAB ── */}
          {tab === "history" && (
            <div className="fade-in">
              <SectionHeader title="Billing History" subtitle="Past monthly cycles stored for reference" />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {history.length === 0 && (
                  <div style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    No past cycles yet.
                  </div>
                )}
                {history.map((h) => (
                  <div key={h.id} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 24px", display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ fontWeight: 800, fontSize: 16, minWidth: 160 }}>{h.label}</div>
                    <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                      {h.finalized ? <span className="tag tag-green">finalized</span> : <span className="tag tag-yellow">open</span>}
                    </div>
                    <button className="btn-ghost" style={{ fontSize: 11 }}>View</button>
                  </div>
                ))}
                <div style={{ textAlign: "center", color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 8 }}>
                  Current cycle ({cycleName}) will appear here after it is finalized.
                </div>
              </div>
            </div>
          )}

        </main>
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>{title}</h1>
      {subtitle && <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 4 }}>{subtitle}</p>}
    </div>
  );
}

function PersonRow({ person, billData, dinnerVal, onDinnerChange, receipts, onAddReceipt, onRemoveReceipt }) {
  const [showReceipts, setShowReceipts] = useState(false);
  const [rAmt, setRAmt] = useState("");
  const [rNote, setRNote] = useState("");

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px" }}>
        <div style={{ fontWeight: 700, fontSize: 15, minWidth: 100 }}>{person.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>Dinners</label>
          <input type="number" min="0" value={dinnerVal} onChange={(e) => onDinnerChange(e.target.value)}
            placeholder="0" style={{ width: 70 }} />
        </div>
        <div style={{ flex: 1 }} />
        {billData && billData.dinners > 0 && (
          <>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
              {(billData.pct * 100).toFixed(1)}% → <span style={{ color: "var(--text)" }}>{`$${billData.owes.toFixed(2)}`}</span>
            </span>
            <span className={`tag ${billData.balance <= 0 ? "tag-green" : "tag-red"}`} style={{ fontSize: 12 }}>
              {billData.balance <= 0 ? `✓ credit $${Math.abs(billData.balance).toFixed(2)}` : `owes $${billData.balance.toFixed(2)}`}
            </span>
          </>
        )}
        <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setShowReceipts(!showReceipts)}>
          {receipts.length > 0 ? `${receipts.length} receipts` : "+ receipt"} {showReceipts ? "▲" : "▼"}
        </button>
      </div>
      {showReceipts && (
        <div style={{ background: "var(--surface2)", padding: "12px 20px 16px 36px", borderTop: "1px solid var(--border)" }}>
          {receipts.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              <span style={{ color: "var(--accent)" }}>${r.amount.toFixed(2)}</span>
              <span style={{ color: "var(--muted)" }}>{r.note}</span>
              <button className="btn-danger" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => onRemoveReceipt(r.id)}>✕</button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={rAmt} onChange={(e) => setRAmt(e.target.value)} placeholder="Amount" type="number" style={{ width: 90 }} />
            <input value={rNote} onChange={(e) => setRNote(e.target.value)} placeholder="Note (e.g. NoFrills Jan 10)" />
            <button className="btn-warn" style={{ whiteSpace: "nowrap", fontSize: 12 }} onClick={() => {
              if (!rAmt) return;
              onAddReceipt(rAmt, rNote);
              setRAmt(""); setRNote("");
            }}>Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
