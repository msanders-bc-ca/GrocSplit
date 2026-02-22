import { useState, useEffect, useRef, useCallback } from "react";
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
  const [plaidStatus, setPlaidStatus] = useState("idle");   // idle | loading | done | error
  const [plaidConnected, setPlaidConnected] = useState(false);
  const [plaidInstitution, setPlaidInstitution] = useState(null);
  const [plaidSyncError, setPlaidSyncError] = useState(null);
  const [allCycles, setAllCycles] = useState([]);
  const [showNewCycle, setShowNewCycle] = useState(false);
  const [newCycleMonth, setNewCycleMonth] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualMerchant, setManualMerchant] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResult, setCsvResult] = useState(null); // null | { added, skipped, errors }
  const dinnersModified = useRef(false);
  const csvFileRef = useRef(null);
  const [cycleFinalized, setCycleFinalized] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyView, setHistoryView] = useState(null); // null | cycle detail object

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      try {
        const [peopleData, cyclesData, plaidStatusData] = await Promise.all([
          api.getPeople(),
          api.getCycles(),
          api.getPlaidStatus().catch(() => ({ connected: false })),
        ]);
        if (plaidStatusData.connected) {
          setPlaidConnected(true);
          setPlaidInstitution(plaidStatusData.institution || null);
        }
        setPeople(peopleData);

        const mk = monthKey();
        let cycle = cyclesData.find((c) => c.month_key === mk);
        let finalCyclesData = cyclesData;
        if (!cycle) {
          cycle = await api.createCycle(mk);
          finalCyclesData = [cycle, ...cyclesData];
        }

        setAllCycles(finalCyclesData);
        setCycleId(cycle.id);
        setCycleName(cycle.label);

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
        date: r.date || "",
      }))
    );
    const dm = {};
    for (const e of detail.dinnerEntries) dm[e.person_id] = e.dinner_count;
    setDinners(dm);
    dinnersModified.current = false;
    if (detail.cycle) setCycleFinalized(!!detail.cycle.finalized);
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
  // Total includes both shared transactions (Visa/CSV/manual) and per-person
  // out-of-pocket receipts — all represent real grocery spend the household splits.
  const totalGroceries =
    transactions.reduce((s, t) => s + t.amount, 0) +
    receipts.reduce((s, r) => s + r.amount, 0);

  // Combined sorted list for the Transactions tab (shared charges + personal out-of-pocket)
  const allEntries = [
    ...transactions.map((t) => ({ _type: "tx", id: t.id, date: t.date || "", label: t.merchant, amount: t.amount, verified: t.verified, source: t.source })),
    ...receipts.map((r) => ({ _type: "receipt", id: r.id, date: r.date || "", label: r.note || "(no note)", amount: r.amount, personName: people.find((p) => p.id === r.personId)?.name || "?" })),
  ].sort((a, b) => b.date.localeCompare(a.date));
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

  const addReceipt = async (personId, amount, note, date) => {
    if (!cycleId) return;
    try {
      const updated = await api.addReceipt(cycleId, { person_id: personId, amount: Number(amount), note, date });
      setReceipts(updated.map((r) => ({ id: r.id, personId: r.person_id, amount: Number(r.amount), note: r.note, date: r.date || "" })));
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

  const handleConnectBank = async () => {
    if (!window.Plaid) {
      alert("Plaid Link script not loaded. Check your internet connection and refresh.");
      return;
    }
    try {
      const { link_token } = await api.getLinkToken();
      const handler = window.Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            await api.exchangeToken({ public_token, institution_name: metadata.institution?.name });
            setPlaidConnected(true);
            setPlaidInstitution(metadata.institution?.name || "Connected");
          } catch (err) {
            alert("Failed to save bank connection: " + err.message);
          }
        },
        onExit: (err) => {
          if (err) console.error("[Plaid] Link exited with error:", err);
        },
      });
      handler.open();
    } catch (err) {
      const detail = err.message || "Unknown error";
      alert("Could not open Plaid Link: " + detail);
    }
  };

  const handlePlaidSync = async () => {
    if (!cycleId) return;
    setPlaidStatus("loading");
    setPlaidSyncError(null);
    try {
      const result = await api.syncPlaid(cycleId);
      const txList = await api.getTransactions(cycleId);
      setTransactions(txList.map((t) => ({ ...t, verified: !!t.verified })));
      setPlaidStatus("done");
      console.log(`[Plaid] Sync complete: ${result.added} added, ${result.skipped} skipped`);
    } catch (err) {
      setPlaidStatus("error");
      setPlaidSyncError(err.message);
    }
  };

  const openManualForm = () => {
    setManualMerchant("");
    setManualAmount("");
    setManualDate(new Date().toISOString().slice(0, 10));
    setShowManualForm(true);
  };

  const submitManualTransaction = async () => {
    if (!cycleId || !manualMerchant.trim() || !manualAmount) return;
    try {
      const updated = await api.addTransaction(cycleId, {
        merchant: manualMerchant.trim(),
        amount: Number(manualAmount),
        source: "receipt",
        date: manualDate || new Date().toISOString().slice(0, 10),
      });
      setTransactions(updated.map((t) => ({ ...t, verified: !!t.verified })));
      setShowManualForm(false);
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

  const handleCsvImport = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file || !cycleId) return;
    e.target.value = ""; // reset so same file can be re-selected
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const text = await file.text();
      const result = await api.importCsv(cycleId, text);
      setTransactions(result.transactions.map((t) => ({ ...t, verified: !!t.verified })));
      setCsvResult({ added: result.added, skipped: result.skipped, errors: result.errors });
      setTimeout(() => setCsvResult(null), 6000);
    } catch (err) {
      alert("CSV import failed: " + err.message);
    } finally {
      setCsvImporting(false);
    }
  }, [cycleId]);

  const handleDinnerChange = (personId, value) => {
    dinnersModified.current = true;
    setDinners((prev) => ({ ...prev, [personId]: value }));
  };

  const handleFinalize = async () => {
    if (!cycleId) return;
    if (!window.confirm(`Finalize ${cycleName}? You can unfinalize it later if needed.`)) return;
    try {
      await api.finalizeCycle(cycleId);
      setCycleFinalized(true);
      setAllCycles((prev) => prev.map((c) => c.id === cycleId ? { ...c, finalized: 1 } : c));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUnfinalize = async () => {
    if (!cycleId) return;
    if (!window.confirm(`Unfinalize ${cycleName}? This will allow edits again.`)) return;
    try {
      await api.unfinalizeCycle(cycleId);
      setCycleFinalized(false);
      setAllCycles((prev) => prev.map((c) => c.id === cycleId ? { ...c, finalized: 0 } : c));
    } catch (err) {
      alert(err.message);
    }
  };

  const switchCycle = async (id) => {
    try {
      const detail = await api.getCycle(id);
      setCycleId(detail.cycle.id);
      setCycleName(detail.cycle.label);
      applyDetail(detail);
    } catch (err) {
      alert(err.message);
    }
  };

  const openNewCycle = () => {
    const latestKey = allCycles[0]?.month_key;
    if (latestKey) {
      const [y, m] = latestKey.split("-").map(Number);
      const next = new Date(y, m, 1); // first day of the month after latestKey
      setNewCycleMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`);
    } else {
      setNewCycleMonth(monthKey());
    }
    setShowNewCycle(true);
  };

  const handleCreateCycle = async () => {
    if (!newCycleMonth) return;
    try {
      const newCycle = await api.createCycle(newCycleMonth);
      const updatedCycles = await api.getCycles();
      setAllCycles(updatedCycles);
      setShowNewCycle(false);
      await switchCycle(newCycle.id);
      setTab("cycle");
    } catch (err) {
      alert(err.message);
    }
  };

  const copyBillSummary = async () => {
    const lines = [
      `${cycleName} — Grocery Bill`,
      `Total: $${totalGroceries.toFixed(2)} | ${totalDinners} dinners`,
      ``,
      ...bill.map((b) => {
        const balStr =
          b.balance <= 0
            ? `credit $${Math.abs(b.balance).toFixed(2)}`
            : `owes $${b.balance.toFixed(2)}`;
        return `${b.name}: ${b.dinners} dinners (${(b.pct * 100).toFixed(1)}%) → ${balStr}`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Could not copy to clipboard.");
    }
  };

  const viewHistoryCycle = async (id) => {
    try {
      const detail = await api.getCycle(id);
      setHistoryView(detail);
    } catch (err) {
      alert(err.message);
    }
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
              {(() => {
                const activeCycleIdx = allCycles.findIndex((c) => c.id === cycleId);
                const canGoPrev = activeCycleIdx < allCycles.length - 1;
                const canGoNext = activeCycleIdx > 0;
                return (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
                    {/* Month navigator */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        className="btn-ghost"
                        disabled={!canGoPrev}
                        style={{ fontSize: 18, padding: "4px 12px", opacity: canGoPrev ? 1 : 0.3 }}
                        onClick={() => switchCycle(allCycles[activeCycleIdx + 1].id)}
                        title="Previous month"
                      >←</button>
                      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, margin: "0 4px" }}>{cycleName}</h1>
                      <button
                        className="btn-ghost"
                        disabled={!canGoNext}
                        style={{ fontSize: 18, padding: "4px 12px", opacity: canGoNext ? 1 : 0.3 }}
                        onClick={() => switchCycle(allCycles[activeCycleIdx - 1].id)}
                        title="Next month"
                      >→</button>
                      <button className="btn-ghost" style={{ fontSize: 11, marginLeft: 4 }} onClick={openNewCycle}>+ New Month</button>
                    </div>
                    {/* Finalize / Unfinalize */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {cycleFinalized
                        ? <>
                            <span className="tag tag-green" style={{ fontSize: 12, padding: "5px 12px" }}>✓ Finalized</span>
                            <button className="btn-ghost" style={{ fontSize: 11 }} onClick={handleUnfinalize}>Unfinalize</button>
                          </>
                        : <button className="btn-warn" onClick={handleFinalize}>Finalize Month</button>
                      }
                    </div>
                  </div>
                );
              })()}

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
                <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)" }}>Per-Person Breakdown</div>
                  {!cycleFinalized && <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 4, opacity: 0.7 }}>Use +/− to set how many dinners each person ate this month — the bill splits proportionally.</div>}
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
                      onAddReceipt={(amt, note, date) => addReceipt(p.id, amt, note, date)}
                      onRemoveReceipt={removeReceipt}
                      finalized={cycleFinalized}
                    />
                  );
                })}
              </div>

              {/* Final bill table */}
              {people.length > 0 && totalDinners > 0 && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)" }}>Final Bill Summary</span>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={copyBillSummary}>
                      {copied ? "✓ Copied!" : "Copy Summary"}
                    </button>
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
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px", marginBottom: 24 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {plaidConnected ? (plaidInstitution || "Bank") + " via Plaid" : "Connect Bank via Plaid"}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {plaidConnected
                        ? "Pull grocery transactions automatically for this billing period"
                        : "Connect your bank account to automatically import grocery transactions"}
                    </div>
                  </div>
                  {/* Status tags */}
                  {plaidConnected && plaidStatus === "idle"    && <span className="tag tag-green">✓ Connected</span>}
                  {plaidConnected && plaidStatus === "done"    && <span className="tag tag-green">✓ Synced</span>}
                  {plaidConnected && plaidStatus === "loading" && <span className="tag tag-yellow">syncing…</span>}
                  {plaidConnected && plaidStatus === "error"   && <span className="tag tag-red">sync failed</span>}
                  {!plaidConnected && <span className="tag tag-yellow">not connected</span>}
                  {/* Action buttons */}
                  {plaidConnected
                    ? <button className="btn-primary" onClick={handlePlaidSync} disabled={plaidStatus === "loading"}>
                        {plaidStatus === "loading" ? "Syncing…" : "Sync Now"}
                      </button>
                    : <button className="btn-primary" onClick={handleConnectBank}>Connect Bank</button>
                  }
                  <button className="btn-ghost" onClick={openManualForm}>+ Manual</button>
                  <button
                    className="btn-ghost"
                    onClick={() => csvFileRef.current?.click()}
                    disabled={csvImporting}
                    title="Import a CIBC CSV transaction file"
                  >
                    {csvImporting ? "Importing…" : "Import CSV"}
                  </button>
                  <input
                    ref={csvFileRef}
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: "none" }}
                    onChange={handleCsvImport}
                  />
                </div>
                {/* Inline error detail */}
                {plaidStatus === "error" && plaidSyncError && (
                  <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent2)", background: "#3a1a1a", borderRadius: 6, padding: "8px 12px" }}>
                    {plaidSyncError}
                  </div>
                )}
                {/* CSV import result */}
                {csvResult && (
                  <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", background: "#0d3326", borderRadius: 6, padding: "8px 12px", display: "flex", gap: 16 }}>
                    <span>✓ CSV imported</span>
                    <span>Added: <strong>{csvResult.added}</strong></span>
                    <span>Skipped (duplicate): <strong>{csvResult.skipped}</strong></span>
                    {csvResult.errors > 0 && <span style={{ color: "var(--accent2)" }}>Parse errors: <strong>{csvResult.errors}</strong></span>}
                  </div>
                )}
              </div>

              {/* Combined transaction + personal receipt list */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", fontSize: 11 }}>
                      {["✓","Date","Description","Amount","Source",""].map((h) => (
                        <th key={h} style={{ padding: "10px 20px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allEntries.map((entry) => entry._type === "tx" ? (
                      <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)", opacity: entry.verified ? 0.6 : 1 }}>
                        <td style={{ padding: "12px 20px" }}>
                          <input type="checkbox" checked={entry.verified} onChange={() => toggleVerified(entry.id)}
                            style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
                        </td>
                        <td style={{ padding: "12px 20px", color: "var(--muted)" }}>{entry.date}</td>
                        <td style={{ padding: "12px 20px", fontWeight: 500 }}>{entry.label}</td>
                        <td style={{ padding: "12px 20px", color: "var(--accent3)" }}>{fmt(entry.amount)}</td>
                        <td style={{ padding: "12px 20px" }}>
                          <span className={`tag ${entry.source === "visa" ? "tag-yellow" : entry.source === "csv" ? "tag-yellow" : "tag-green"}`}>
                            {entry.source === "visa" ? "💳 Visa" : entry.source === "csv" ? "📄 CSV" : "🧾 Manual"}
                          </span>
                        </td>
                        <td style={{ padding: "12px 20px" }}>
                          <button className="btn-danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeTransaction(entry.id)}>Remove</button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={entry.id} style={{ borderBottom: "1px solid var(--border)", background: "rgba(79,255,176,0.03)" }}>
                        <td style={{ padding: "12px 20px", color: "var(--muted)", fontSize: 16 }}>—</td>
                        <td style={{ padding: "12px 20px", color: "var(--muted)" }}>{entry.date}</td>
                        <td style={{ padding: "12px 20px", fontWeight: 500 }}>{entry.label}</td>
                        <td style={{ padding: "12px 20px", color: "var(--accent)" }}>{fmt(entry.amount)}</td>
                        <td style={{ padding: "12px 20px" }}>
                          <span className="tag tag-green">👤 {entry.personName}</span>
                        </td>
                        <td style={{ padding: "12px 20px" }}>
                          <button className="btn-danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeReceipt(entry.id)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 20, fontFamily: "var(--font-mono)", fontSize: 13 }}>
                  <span style={{ color: "var(--muted)" }}>
                    {transactions.filter((t) => t.verified).length}/{transactions.length} visa verified
                  </span>
                  <span style={{ color: "var(--muted)" }}>
                    {receipts.length} out-of-pocket
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--accent)" }}>Shared total: {fmt(totalGroceries)}</span>
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
                {allCycles.length === 0 && (
                  <div style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
                    No cycles yet.
                  </div>
                )}
                {allCycles.map((h) => {
                  const isActive = h.id === cycleId;
                  return (
                    <div key={h.id} style={{ background: "var(--surface)", border: `1px solid ${isActive ? "var(--accent)" : "var(--border)"}`, borderRadius: 10, padding: "18px 24px", display: "flex", alignItems: "center", gap: 20 }}>
                      <div style={{ fontWeight: 800, fontSize: 16, minWidth: 160 }}>{h.label}</div>
                      <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {h.finalized ? <span className="tag tag-green">finalized</span> : <span className="tag tag-yellow">open</span>}
                        {isActive && <span className="tag" style={{ background: "#0d1e33", color: "var(--accent)", border: "1px solid var(--accent)" }}>active</span>}
                      </div>
                      <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => viewHistoryCycle(h.id)}>Summary</button>
                      <button
                        className={isActive ? "btn-ghost" : "btn-primary"}
                        style={{ fontSize: 11 }}
                        onClick={() => { switchCycle(h.id); setTab("cycle"); }}
                      >{isActive ? "— editing —" : "Switch to"}</button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </main>
      </div>
      {historyView && <HistoryModal detail={historyView} onClose={() => setHistoryView(null)} />}
      {showManualForm && (
        <ManualTransactionModal
          merchant={manualMerchant}
          amount={manualAmount}
          date={manualDate}
          onMerchantChange={setManualMerchant}
          onAmountChange={setManualAmount}
          onDateChange={setManualDate}
          onSubmit={submitManualTransaction}
          onClose={() => setShowManualForm(false)}
        />
      )}
      {showNewCycle && (
        <NewCycleModal
          defaultMonth={newCycleMonth}
          onMonthChange={setNewCycleMonth}
          onCreate={handleCreateCycle}
          onClose={() => setShowNewCycle(false)}
        />
      )}
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function ManualTransactionModal({ merchant, amount, date, onMerchantChange, onAmountChange, onDateChange, onSubmit, onClose }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 28, width: 380 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Add Manual Transaction</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>
          Cash or debit grocery purchase to add to the shared pool.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Merchant</div>
            <input placeholder="e.g. Farmer's Market" value={merchant} onChange={(e) => onMerchantChange(e.target.value)} />
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Amount</div>
            <input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => onAmountChange(e.target.value)} />
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Date</div>
            <input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={onSubmit} disabled={!merchant.trim() || !amount}>Add Transaction</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function NewCycleModal({ defaultMonth, onMonthChange, onCreate, onClose }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 28, width: 340 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>New Billing Cycle</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 20 }}>
          Choose a month to create a billing cycle for.
        </div>
        <input
          type="month"
          value={defaultMonth}
          onChange={(e) => onMonthChange(e.target.value)}
          style={{ marginBottom: 20 }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={onCreate}>Create Cycle</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ detail, onClose }) {
  const { cycle, bill } = detail;
  const { total, totalDinners, billRows } = bill;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 28, maxWidth: 620, width: "90%", maxHeight: "80vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{cycle.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              {cycle.date_from} → {cycle.date_to}
              {cycle.finalized ? <span className="tag tag-green" style={{ marginLeft: 10 }}>finalized</span> : <span className="tag tag-yellow" style={{ marginLeft: 10 }}>open</span>}
            </div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 12 }} onClick={onClose}>✕ Close</button>
        </div>

        {/* Summary cards */}
        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          {[
            { label: "Total Groceries", value: `$${Number(total).toFixed(2)}`, color: "var(--accent)" },
            { label: "Total Dinners", value: totalDinners, color: "var(--accent3)" },
          ].map((s) => (
            <div key={s.label} style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 18px", flex: 1 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Bill table */}
        {billRows.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: 11 }}>
                {["Person", "Dinners", "%", "Owes", "Paid", "Balance"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 500, borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {billRows.map((b) => (
                <tr key={b.person_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{b.person_name}</td>
                  <td style={{ padding: "10px 12px" }}>{b.dinner_count}</td>
                  <td style={{ padding: "10px 12px" }}>{b.pct.toFixed(1)}%</td>
                  <td style={{ padding: "10px 12px" }}>${Number(b.owes).toFixed(2)}</td>
                  <td style={{ padding: "10px 12px", color: "var(--accent)" }}>${Number(b.paid).toFixed(2)}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <span className={`tag ${b.balance <= 0 ? "tag-green" : "tag-red"}`}>
                      {b.balance <= 0 ? `credit $${Math.abs(b.balance).toFixed(2)}` : `$${Number(b.balance).toFixed(2)}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 13 }}>No billing data recorded for this cycle.</div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }}>{title}</h1>
      {subtitle && <p style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12, marginTop: 4 }}>{subtitle}</p>}
    </div>
  );
}

function PersonRow({ person, billData, dinnerVal, onDinnerChange, receipts, onAddReceipt, onRemoveReceipt, finalized }) {
  const [showReceipts, setShowReceipts] = useState(false);
  const [rAmt, setRAmt] = useState("");
  const [rNote, setRNote] = useState("");
  const [rDate, setRDate] = useState(new Date().toISOString().slice(0, 10));

  const count = Number(dinnerVal) || 0;
  const stepperBtn = {
    background: "var(--surface)",
    border: "none",
    color: "var(--text)",
    padding: "0 14px",
    fontSize: 20,
    lineHeight: 1,
    borderRadius: 0,
    height: "100%",
    cursor: finalized ? "default" : "pointer",
    opacity: finalized ? 0.4 : 1,
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 20px", flexWrap: "wrap" }}>

        {/* Name */}
        <div style={{ fontWeight: 700, fontSize: 15, minWidth: 110 }}>{person.name}</div>

        {/* Dinner stepper */}
        <div style={{ display: "flex", alignItems: "stretch", height: 44, background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
          <button
            style={stepperBtn}
            disabled={finalized || count === 0}
            onClick={() => !finalized && count > 0 && onDinnerChange(count - 1)}
          >−</button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", padding: "0 4px", minWidth: 64 }}>
            <input
              type="number"
              min="0"
              value={dinnerVal}
              onChange={(e) => onDinnerChange(e.target.value)}
              disabled={finalized}
              style={{ width: 56, textAlign: "center", border: "none", background: "transparent", fontSize: 20, fontWeight: 800, padding: 0, color: count > 0 ? "var(--accent3)" : "var(--muted)" }}
            />
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted)", marginTop: -2, letterSpacing: 1 }}>DINNERS</div>
          </div>
          <button
            style={stepperBtn}
            disabled={finalized}
            onClick={() => !finalized && onDinnerChange(count + 1)}
          >+</button>
        </div>

        <div style={{ flex: 1 }} />

        {/* Bill preview — shows once dinners > 0 */}
        {billData && billData.dinners > 0 && (
          <>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
              {(billData.pct * 100).toFixed(1)}%{" "}
              <span style={{ color: "var(--text)" }}>→ ${billData.owes.toFixed(2)}</span>
            </span>
            <span className={`tag ${billData.balance <= 0 ? "tag-green" : "tag-red"}`} style={{ fontSize: 12 }}>
              {billData.balance <= 0
                ? `✓ credit $${Math.abs(billData.balance).toFixed(2)}`
                : `owes $${billData.balance.toFixed(2)}`}
            </span>
          </>
        )}

        <button className="btn-ghost" style={{ fontSize: 11 }} onClick={() => setShowReceipts(!showReceipts)}>
          {receipts.length > 0 ? `${receipts.length} receipt${receipts.length !== 1 ? "s" : ""}` : "+ receipt"}{" "}
          {showReceipts ? "▲" : "▼"}
        </button>
      </div>
      {showReceipts && (
        <div style={{ background: "var(--surface2)", padding: "12px 20px 16px 36px", borderTop: "1px solid var(--border)" }}>
          {receipts.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {r.date && <span style={{ color: "var(--muted)", minWidth: 80 }}>{r.date}</span>}
              <span style={{ color: "var(--accent)", minWidth: 60 }}>${r.amount.toFixed(2)}</span>
              <span style={{ color: "var(--muted)", flex: 1 }}>{r.note}</span>
              {!finalized && (
                <button className="btn-danger" style={{ padding: "2px 8px", fontSize: 10 }} onClick={() => onRemoveReceipt(r.id)}>✕</button>
              )}
            </div>
          ))}
          {!finalized && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} style={{ width: 140 }} />
              <input value={rAmt} onChange={(e) => setRAmt(e.target.value)} placeholder="Amount" type="number" style={{ width: 90 }} />
              <input value={rNote} onChange={(e) => setRNote(e.target.value)} placeholder="Note (e.g. NoFrills Jan 10)" style={{ flex: 1, minWidth: 160 }} />
              <button className="btn-warn" style={{ whiteSpace: "nowrap", fontSize: 12 }} onClick={() => {
                if (!rAmt) return;
                onAddReceipt(rAmt, rNote, rDate);
                setRAmt(""); setRNote("");
                setRDate(new Date().toISOString().slice(0, 10));
              }}>Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
