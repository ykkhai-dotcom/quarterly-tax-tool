import { useState, useMemo, useCallback } from "react";
import Papa from "papaparse";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const SE_TAX_RATE = 0.153;
const SE_NET_EARNINGS_FACTOR = 0.9235;
const STANDARD_DEDUCTION = { single: 15000, married: 30000 };

const BRACKETS_SINGLE = [
  { upTo: 11925, rate: 0.10 },
  { upTo: 48475, rate: 0.12 },
  { upTo: 103350, rate: 0.22 },
  { upTo: 197300, rate: 0.24 },
  { upTo: 250525, rate: 0.32 },
  { upTo: 626350, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];
const BRACKETS_MARRIED = [
  { upTo: 23850, rate: 0.10 },
  { upTo: 96950, rate: 0.12 },
  { upTo: 206700, rate: 0.22 },
  { upTo: 394600, rate: 0.24 },
  { upTo: 501050, rate: 0.32 },
  { upTo: 751600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
];

function progressiveTax(taxableIncome, brackets) {
  let tax = 0;
  let last = 0;
  for (const b of brackets) {
    if (taxableIncome > last) {
      const chunk = Math.min(taxableIncome, b.upTo) - last;
      tax += chunk * b.rate;
      last = b.upTo;
    } else break;
  }
  return tax;
}

const QUARTERS = [
  { key: "q1", label: "Q1", months: [0, 1, 2], due: "Apr 15" },
  { key: "q2", label: "Q2", months: [3, 4], due: "Jun 15" },
  { key: "q3", label: "Q3", months: [5, 6, 7], due: "Sep 15" },
  { key: "q4", label: "Q4", months: [8, 9, 10, 11], due: "Jan 15 (next yr)" },
];

function quarterForMonth(m) {
  return QUARTERS.find((q) => q.months.includes(m)) || QUARTERS[0];
}

function parseAmount(v) {
  if (v == null) return NaN;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  return parseFloat(cleaned);
}

function findColumn(fields, candidates) {
  const lower = fields.map((f) => f.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.findIndex((f) => f.includes(cand));
    if (idx !== -1) return fields[idx];
  }
  return null;
}

export default function QuarterlyTaxEstimator() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [otherIncome, setOtherIncome] = useState(0);
  const [statePct, setStatePct] = useState(0);
  const [filing, setFiling] = useState("single");
  const [expensePct, setExpensePct] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    setError("");
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fields = results.meta.fields || [];
        const dateCol = findColumn(fields, ["date"]);
        const amountCol = findColumn(fields, ["amount", "credit", "income", "total", "deposit"]);
        if (!dateCol || !amountCol) {
          setError(
            "Couldn't find date/amount columns automatically. Make sure your CSV has a column with 'date' and one with 'amount' in the header."
          );
          setRows([]);
          return;
        }
        const parsed = results.data
          .map((r) => {
            const d = new Date(r[dateCol]);
            const amt = parseAmount(r[amountCol]);
            return { date: d, amount: amt, raw: r };
          })
          .filter((r) => !isNaN(r.date.getTime()) && !isNaN(r.amount) && r.amount > 0);
        if (parsed.length === 0) {
          setError("No valid positive income rows found after parsing. Check the file's date/amount format.");
        }
        setRows(parsed);
      },
      error: () => setError("Could not read that file. Please upload a CSV."),
    });
  }, []);

  const quarterTotals = useMemo(() => {
    const totals = { q1: 0, q2: 0, q3: 0, q4: 0 };
    rows.forEach((r) => {
      const q = quarterForMonth(r.date.getMonth());
      totals[q.key] += r.amount;
    });
    return totals;
  }, [rows]);

  const grossIncome = rows.reduce((s, r) => s + r.amount, 0);
  const netEarnings = grossIncome * (1 - expensePct / 100);

  const estimate = useMemo(() => {
    if (netEarnings <= 0) return null;
    const seBase = netEarnings * SE_NET_EARNINGS_FACTOR;
    const seTax = seBase * SE_TAX_RATE;

    const totalIncome = netEarnings + Number(otherIncome || 0);
    const deduction = STANDARD_DEDUCTION[filing];
    const taxable = Math.max(0, totalIncome - deduction - seTax / 2);
    const brackets = filing === "single" ? BRACKETS_SINGLE : BRACKETS_MARRIED;
    const incomeTax = progressiveTax(taxable, brackets);
    const stateTax = totalIncome * (statePct / 100);

    const totalTax = seTax + incomeTax + stateTax;
    const effectiveRate = totalTax / netEarnings;
    return { seTax, incomeTax, stateTax, totalTax, effectiveRate };
  }, [netEarnings, otherIncome, filing, statePct]);

  const chartData = QUARTERS.map((q) => ({
    name: q.label,
    income: Math.round(quarterTotals[q.key] || 0),
  }));

  const fmt = (n) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  return (
    <div
      style={{
        fontFamily: "'Source Serif 4', Georgia, serif",
        background: "#EDE8DA",
        color: "#20302B",
        minHeight: "100vh",
        padding: "2.5rem 1.5rem",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500&display=swap');
        .mono { font-family: 'IBM Plex Mono', monospace; }
        .ui { font-family: 'IBM Plex Sans', sans-serif; }
        .ledger-row { border-bottom: 1px solid #C9BFA6; }
        .ledger-row:first-child { border-top: 1px solid #20302B; }
        input[type=number], select {
          font-family: 'IBM Plex Mono', monospace;
          background: transparent;
          border: none;
          border-bottom: 1px solid #7A6F55;
          padding: 2px 4px;
          color: #20302B;
          width: 100%;
          font-size: 0.95rem;
        }
        input[type=number]:focus, select:focus { outline: none; border-bottom: 1px solid #20302B; }
        .drop-zone {
          border: 1.5px dashed #7A6F55;
          transition: border-color .15s, background .15s;
        }
        .drop-zone.over {
          border-color: #8A3324;
          background: rgba(138,51,36,0.06);
        }
        .btn {
          font-family: 'IBM Plex Sans', sans-serif;
          background: #20302B;
          color: #EDE8DA;
          border: none;
          padding: 0.55rem 1.1rem;
          font-size: 0.85rem;
          cursor: pointer;
          letter-spacing: 0.01em;
        }
        .btn:hover { background: #33463F; }
      `}</style>

      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <div style={{ borderBottom: "2px solid #20302B", paddingBottom: "1rem", marginBottom: "1.75rem" }}>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 700, margin: 0 }}>Quarterly Set-Aside Ledger</h1>
          <p className="ui" style={{ margin: "0.4rem 0 0", fontSize: "0.92rem", color: "#4A5A54" }}>
            Upload your income and see what to set aside for estimated taxes, and when it's due.
          </p>
        </div>

        <div
          className={`drop-zone ${dragOver ? "over" : ""}`}
          style={{ padding: "1.75rem", textAlign: "center", marginBottom: "1.5rem" }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <p className="ui" style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
            {fileName ? `Loaded: ${fileName}` : "Drop a bank or invoice CSV here, or"}
          </p>
          <label className="btn" style={{ display: "inline-block" }}>
            Choose file
            <input
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
          <p className="ui" style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "#6B6250" }}>
            Needs a column with a date and one with an amount (e.g. "Date", "Amount" or "Deposit").
          </p>
          {error && (
            <p className="ui" style={{ color: "#8A3324", fontSize: "0.82rem", marginTop: "0.75rem" }}>
              {error}
            </p>
          )}
        </div>

        <div
          className="ui"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem 1.5rem",
            marginBottom: "1.75rem",
            fontSize: "0.85rem",
          }}
        >
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", color: "#4A5A54" }}>Filing status</label>
            <select value={filing} onChange={(e) => setFiling(e.target.value)}>
              <option value="single">Single</option>
              <option value="married">Married filing jointly</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", color: "#4A5A54" }}>
              Other taxable income this year ($)
            </label>
            <input type="number" min="0" value={otherIncome} onChange={(e) => setOtherIncome(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", color: "#4A5A54" }}>
              Business expenses (% of income)
            </label>
            <input type="number" min="0" max="90" value={expensePct} onChange={(e) => setExpensePct(e.target.value)} />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem", color: "#4A5A54" }}>
              State income tax rate (%, flat estimate)
            </label>
            <input type="number" min="0" max="15" step="0.1" value={statePct} onChange={(e) => setStatePct(e.target.value)} />
          </div>
        </div>

        {rows.length > 0 && estimate && (
          <>
            <div style={{ height: 180, marginBottom: "1.5rem" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#C9BFA6" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontFamily: "IBM Plex Sans", fontSize: 12, fill: "#4A5A54" }} axisLine={{ stroke: "#7A6F55" }} tickLine={false} />
                  <YAxis tick={{ fontFamily: "IBM Plex Mono", fontSize: 11, fill: "#4A5A54" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v / 1000}k`} />
                  <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontFamily: "IBM Plex Sans", fontSize: 12, background: "#20302B", border: "none", color: "#EDE8DA" }} />
                  <Bar dataKey="income" fill="#8A3324" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ marginBottom: "1.75rem" }}>
              <div className="ledger-row ui" style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.88rem" }}>
                <span>Gross income parsed</span>
                <span className="mono">{fmt(grossIncome)}</span>
              </div>
              <div className="ledger-row ui" style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.88rem" }}>
                <span>Net earnings (after expenses)</span>
                <span className="mono">{fmt(netEarnings)}</span>
              </div>
              <div className="ledger-row ui" style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.88rem" }}>
                <span>Self-employment tax (15.3%)</span>
                <span className="mono">{fmt(estimate.seTax)}</span>
              </div>
              <div className="ledger-row ui" style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.88rem" }}>
                <span>Federal income tax</span>
                <span className="mono">{fmt(estimate.incomeTax)}</span>
              </div>
              <div className="ledger-row ui" style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", fontSize: "0.88rem" }}>
                <span>State income tax (estimate)</span>
                <span className="mono">{fmt(estimate.stateTax)}</span>
              </div>
              <div className="ledger-row" style={{ display: "flex", justifyContent: "space-between", padding: "0.65rem 0", fontSize: "1rem", fontWeight: 700 }}>
                <span>Total estimated tax</span>
                <span className="mono">{fmt(estimate.totalTax)}</span>
              </div>
            </div>

            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Set aside by quarter</h2>
            <div style={{ marginBottom: "1rem" }}>
              {QUARTERS.map((q) => {
                const qIncome = quarterTotals[q.key] || 0;
                const qNet = qIncome * (1 - expensePct / 100);
                const setAside = qNet * estimate.effectiveRate;
                return (
                  <div key={q.key} className="ledger-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0.7rem 0" }}>
                    <div>
                      <span style={{ fontWeight: 600 }}>{q.label}</span>
                      <span className="ui" style={{ fontSize: "0.78rem", color: "#6B6250", marginLeft: "0.6rem" }}>due {q.due}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="mono" style={{ fontSize: "1.05rem" }}>{fmt(setAside)}</div>
                      <div className="ui" style={{ fontSize: "0.75rem", color: "#6B6250" }}>on {fmt(qIncome)} earned</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="ui" style={{ fontSize: "0.78rem", color: "#6B6250", lineHeight: 1.5, borderTop: "1px solid #C9BFA6", paddingTop: "1rem" }}>
              This is a simplified estimate for planning purposes only — it is not tax advice and doesn't
              account for credits, prior-year safe harbor rules, or all deduction types. Confirm actual
              payments with a tax professional or the IRS Form 1040-ES instructions.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
