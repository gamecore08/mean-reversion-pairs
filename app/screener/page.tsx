"use client";

export const dynamic = "force-dynamic";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchKlines } from "../lib/binance";
import { corr, olsSlopeIntercept, toLogSeries, logReturns, zscoreSeries } from "../lib/stats";
import { adfTestResidual } from "../lib/adf";

type TF = "1h" | "4h";

type Row = {
  symbol: string;
  corr: number | null;
  beta: number | null;
  adfT: number | null;
  cointPass5: boolean | null;
  zNow: number | null;
  zMaxAbs: number | null;
  status: "STRONG" | "POTENTIAL" | "WAIT";
  note: string;
};

const DEFAULT_UNIVERSE = [
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "LTCUSDT",
  "OPUSDT",
  "ARBUSDT",
  "MATICUSDT",
];

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export default function ScreenerPage() {
  const [base, setBase] = useState("BTCUSDT");
  const [tf, setTf] = useState<TF>("1h");
  const [bars, setBars] = useState(720); // 30 hari utk 1h
  const [lookCorr, setLookCorr] = useState(240);
  const [lookBeta, setLookBeta] = useState(240);
  const [lookZ, setLookZ] = useState(240);
  const [entryZ, setEntryZ] = useState(2.0);

  // UX helpers
  const [onlyStrongReady, setOnlyStrongReady] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMinutes, setRefreshMinutes] = useState(15);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  const [universeText, setUniverseText] = useState(DEFAULT_UNIVERSE.join(","));
  const universe = useMemo(
    () =>
      universeText
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .filter((s) => s.endsWith("USDT")),
    [universeText]
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runScan() {
    setErr(null);
    setLoading(true);

    try {
      const baseK = await fetchKlines(base, tf, bars);
      const baseClose = baseK.map((k) => k.close);

      const lnBase = toLogSeries(baseClose);
      const baseRet = logReturns(baseClose);

      const alts = universe.filter((s) => s !== base);
      const altKlinesList = await Promise.allSettled(
        alts.map((sym) => fetchKlines(sym, tf, bars))
      );

      const out: Row[] = [];

      for (let i = 0; i < alts.length; i++) {
        const symbol = alts[i];
        const res = altKlinesList[i];

        if (res.status !== "fulfilled") {
          out.push({
            symbol,
            corr: null,
            beta: null,
            adfT: null,
            cointPass5: null,
            zNow: null,
            zMaxAbs: null,
            status: "WAIT",
            note: "Fetch gagal",
          });
          continue;
        }

        const altK = res.value;
        const altClose = altK.map((k) => k.close);

        const lnAlt = toLogSeries(altClose);
        const altRet = logReturns(altClose);

        // align lengths
        const n = Math.min(lnBase.length, lnAlt.length);
        const lnB = lnBase.slice(lnBase.length - n);
        const lnA = lnAlt.slice(lnAlt.length - n);

        // correlation on returns
        const rN = Math.min(baseRet.length, altRet.length);
        const rB = baseRet.slice(baseRet.length - rN);
        const rA = altRet.slice(altRet.length - rN);

        const wCorr = clamp(lookCorr, 50, rN);
        const rho = corr(rA.slice(-wCorr), rB.slice(-wCorr));

        // beta via OLS: ln(base) ~ alpha + beta*ln(alt)
        const wBeta = clamp(lookBeta, 50, n);
        const x = lnA.slice(-wBeta);
        const y = lnB.slice(-wBeta);
        const { beta } = olsSlopeIntercept(x, y);

        // spread
        const spread = lnB.map((v, idx) => v - beta * lnA[idx]);

        // ADF on spread
        const adf = adfTestResidual(spread);

        // Z-score (rolling)
        const wZ = clamp(lookZ, 50, spread.length);
        const z = zscoreSeries(spread, wZ);
        const zNow = z[z.length - 1];
        const zWindow = z.slice(-wZ).filter((v) => Number.isFinite(v));
        const zMaxAbs =
          zWindow.length > 0
            ? zWindow.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
            : null;

        const cointPass5 = adf.pass5;

        const zOpportunity = Number.isFinite(zNow) && Math.abs(zNow) >= entryZ;

        let status: Row["status"] = "WAIT";
        let note = "";

        if (Number.isFinite(rho) && rho >= 0.75 && cointPass5) {
          status = "STRONG";
          note = zOpportunity ? "STRONG + Entry ready" : "STRONG (wait Z)";
        } else if (Number.isFinite(rho) && rho >= 0.70 && (cointPass5 || adf.pass10)) {
          status = "POTENTIAL";
          note = zOpportunity ? "Potential + Entry ready" : "Potential (watch)";
        } else if (Number.isFinite(rho) && rho >= 0.65 && zOpportunity) {
          status = "POTENTIAL";
          note = "Corr ok, Z ready (coint weak)";
        } else {
          status = "WAIT";
          note = Number.isFinite(rho) && rho < 0.65 ? "Corr rendah" : "Coint tidak pass";
        }

        out.push({
          symbol,
          corr: Number.isFinite(rho) ? rho : null,
          beta: Number.isFinite(beta) ? beta : null,
          adfT: adf.tStat,
          cointPass5,
          zNow: Number.isFinite(zNow) ? zNow : null,
          zMaxAbs,
          status,
          note,
        });
      }

      const rank = (s: Row["status"]) => (s === "STRONG" ? 0 : s === "POTENTIAL" ? 1 : 2);
      out.sort((a, b) => rank(a.status) - rank(b.status) || ((b.corr ?? -999) - (a.corr ?? -999)));
      setRows(out);
      setLastScanAt(Date.now());
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh screener (client-side) — no VPS needed.
  useEffect(() => {
    if (!autoRefresh) return;
    const mins = Math.max(1, Number(refreshMinutes) || 15);
    const id = window.setInterval(() => {
      runScan();
    }, mins * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, refreshMinutes]);

  const displayRows = useMemo(() => {
    if (!onlyStrongReady) return rows;
    return rows.filter((r) => r.status === "STRONG" && r.zNow !== null && Math.abs(r.zNow) >= entryZ);
  }, [rows, onlyStrongReady, entryZ]);

  const best = displayRows[0] ?? null;

  const badge = (s: Row["status"]) => {
    const cls =
      s === "STRONG"
        ? "bg-green-600/20 text-green-300 border-green-600/30"
        : s === "POTENTIAL"
        ? "bg-yellow-600/20 text-yellow-300 border-yellow-600/30"
        : "bg-red-600/20 text-red-300 border-red-600/30";
    return <span className={`px-2 py-1 text-xs rounded border ${cls}`}>{s}</span>;
  };

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">BTC Pair Screener</h1>
          <p className="text-sm opacity-70">Scan altcoin vs BTC ({tf}) — corr + cointegration + z-score</p>
        </div>

        <div className="flex gap-2">
          <Link href="/" className="px-3 py-2 rounded border border-white/15 hover:border-white/30 text-sm">
            Pair Trading
          </Link>
          <button
            onClick={runScan}
            className="px-3 py-2 rounded bg-white/10 hover:bg-white/15 border border-white/15 text-sm"
            disabled={loading}
          >
            {loading ? "Scanning..." : "Run Scan"}
          </button>
        </div>
      </div>

      <div className="mb-6 p-4 rounded border border-white/10 bg-white/5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold">Auto Mode</div>
            <div className="opacity-70">
              {onlyStrongReady ? "Menampilkan hanya STRONG + |Z| ≥ Entry" : "Menampilkan semua hasil"} • {autoRefresh ? `Auto-refresh tiap ${refreshMinutes} menit` : "Auto-refresh OFF"}
              {lastScanAt ? ` • Last scan: ${new Date(lastScanAt).toLocaleTimeString()}` : ""}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={onlyStrongReady} onChange={(e) => setOnlyStrongReady(e.target.checked)} />
              STRONG + Z ready saja
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              Auto-refresh
            </label>
            <label className="flex items-center gap-2 text-sm">
              Interval
              <input
                type="number"
                min={1}
                value={refreshMinutes}
                onChange={(e) => setRefreshMinutes(Number(e.target.value))}
                className="w-20 px-2 py-1 rounded bg-black/30 border border-white/10"
              />
              menit
            </label>

            {best && (
              <Link
                href={`/?a=${encodeURIComponent(base)}&b=${encodeURIComponent(best.symbol)}`}
                className="px-3 py-2 rounded bg-white/10 hover:bg-white/15 border border-white/15 text-sm"
              >
                Open Best Trade ({best.symbol})
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="p-4 rounded border border-white/10 bg-white/5">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Base
              <input value={base} onChange={(e) => setBase(e.target.value.toUpperCase())} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10" />
            </label>

            <label className="text-sm">
              Timeframe
              <select value={tf} onChange={(e) => setTf(e.target.value as TF)} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10">
                <option value="1h">1h</option>
                <option value="4h">4h</option>
              </select>
            </label>

            <label className="text-sm">
              Bars
              <input type="number" value={bars} onChange={(e) => setBars(Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10" />
            </label>

            <label className="text-sm">
              Entry Z
              <input type="number" step="0.1" value={entryZ} onChange={(e) => setEntryZ(Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10" />
            </label>

            <label className="text-sm">
              Lookback Corr
              <input type="number" value={lookCorr} onChange={(e) => setLookCorr(Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10" />
            </label>

            <label className="text-sm">
              Lookback β
              <input type="number" value={lookBeta} onChange={(e) => setLookBeta(Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10" />
            </label>

            <label className="text-sm col-span-2">
              Lookback Z
              <input type="number" value={lookZ} onChange={(e) => setLookZ(Number(e.target.value))} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10" />
            </label>
          </div>
        </div>

        <div className="p-4 rounded border border-white/10 bg-white/5">
          <label className="text-sm">
            Universe (comma separated, USDT pairs)
            <textarea value={universeText} onChange={(e) => setUniverseText(e.target.value)} className="mt-1 w-full px-3 py-2 rounded bg-black/30 border border-white/10 h-28" />
          </label>
          <div className="mt-3 text-xs opacity-70">Tip: mulai 10–15 pair biar cepat & ringan.</div>
        </div>
      </div>

      {err && <div className="mb-4 p-3 rounded border border-red-500/30 bg-red-500/10 text-red-200">{err}</div>}

      <div className="overflow-x-auto rounded border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5">
            <tr className="text-left">
              <th className="p-3">Alt</th>
              <th className="p-3">Status</th>
              <th className="p-3">Corr</th>
              <th className="p-3">β</th>
              <th className="p-3">ADF t</th>
              <th className="p-3">Coint (5%)</th>
              <th className="p-3">Z now</th>
              <th className="p-3">Max |Z|</th>
              <th className="p-3">Action</th>
              <th className="p-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((r) => (
              <tr key={r.symbol} className="border-t border-white/10">
                <td className="p-3 font-medium">{r.symbol}</td>
                <td className="p-3">{badge(r.status)}</td>
                <td className="p-3">{r.corr === null ? "-" : r.corr.toFixed(3)}</td>
                <td className="p-3">{r.beta === null ? "-" : r.beta.toFixed(3)}</td>
                <td className="p-3">{r.adfT === null ? "-" : r.adfT.toFixed(3)}</td>
                <td className="p-3">{r.cointPass5 === null ? "-" : r.cointPass5 ? "PASS" : "FAIL"}</td>
                <td className="p-3">{r.zNow === null ? "-" : r.zNow.toFixed(2)}</td>
                <td className="p-3">{r.zMaxAbs === null ? "-" : r.zMaxAbs.toFixed(2)}</td>
                <td className="p-3">
                  <Link href={`/?a=${encodeURIComponent(base)}&b=${encodeURIComponent(r.symbol)}`} className="px-2 py-1 rounded border border-white/15 hover:border-white/30">
                    Trade
                  </Link>
                </td>
                <td className="p-3 opacity-80">{r.note}</td>
              </tr>
            ))}
            {displayRows.length === 0 && !loading && (
              <tr>
                <td className="p-3 opacity-70" colSpan={10}>
                  {onlyStrongReady ? "Tidak ada STRONG + Z ready saat ini (coba turunkan Entry Z atau matikan filter)." : "No data"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs opacity-70">
        Cointegration check: ADF residual vs critical value (approx 5%: t &lt; -2.86).
      </div>
    </div>
  );
}
