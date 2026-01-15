"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";

type Kline = { closeTime: number; close: number };

async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url =
    "https://api.binance.com/api/v3/klines" +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&limit=${limit}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance klines error ${res.status}`);
  const data = (await res.json()) as any[];

  return data.map((row) => ({
    closeTime: Number(row[6]),
    close: Number(row[4]),
  }));
}

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
}
function stdev(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export default function PageClient() {
  const sp = useSearchParams();

  const [symbolA, setSymbolA] = useState("BTCUSDT");
  const [symbolB, setSymbolB] = useState("ETHUSDT");
  const [interval, setInterval] = useState("1h");

  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [zPoints, setZPoints] = useState<Array<{ t: number; z: number }>>([]);

  // read query params ?a=BTCUSDT&b=ETHUSDT
  useEffect(() => {
    const a = sp.get("a");
    const b = sp.get("b");
    if (a) setSymbolA(a.toUpperCase());
    if (b) setSymbolB(b.toUpperCase());
  }, [sp]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const limit = 720;
        const [ka, kb] = await Promise.all([
          fetchKlines(symbolA, interval, limit),
          fetchKlines(symbolB, interval, limit),
        ]);

        const n = Math.min(ka.length, kb.length);
        const A = ka.slice(-n).map((k) => k.close);
        const B = kb.slice(-n).map((k) => k.close);

        // simple spread without beta: ln(A) - ln(B)
        const spread = A.map((a, i) => Math.log(Math.max(a, 1e-12)) - Math.log(Math.max(B[i], 1e-12)));

        const m = mean(spread);
        const sd = stdev(spread);
        const z = spread.map((s) => (sd > 0 ? (s - m) / sd : 0));

        const out = ka.slice(-n).map((k, i) => ({ t: k.closeTime, z: z[i] }));

        if (!cancelled) setZPoints(out);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [symbolA, symbolB, interval]);

  const lastZ = zPoints.length ? zPoints[zPoints.length - 1].z : 0;
  const signal =
    lastZ >= 2 ? `SHORT ${symbolA} + LONG ${symbolB}` :
    lastZ <= -2 ? `LONG ${symbolA} + SHORT ${symbolB}` :
    "WAIT";

  const chartData = useMemo(() => zPoints, [zPoints]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Mean Reversion Pair</h1>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-xs text-zinc-400">Pair A</div>
          <input
            value={symbolA}
            onChange={(e) => setSymbolA(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2"
          />
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-xs text-zinc-400">Pair B</div>
          <input
            value={symbolB}
            onChange={(e) => setSymbolB(e.target.value.toUpperCase())}
            className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2"
          />
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
          <div className="text-xs text-zinc-400">Timeframe</div>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2"
          >
            <option value="1h">1h</option>
            <option value="30m">30m</option>
            <option value="15m">15m</option>
            <option value="4h">4h</option>
          </select>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-sm text-zinc-300">Signal</div>
        <div className="mt-1 text-lg font-semibold">{signal}</div>
        <div className="mt-1 text-sm text-zinc-400">Z now: {lastZ.toFixed(2)}σ</div>
        {loading && <div className="mt-2 text-sm text-zinc-400">Loading…</div>}
        {err && <div className="mt-2 text-sm text-red-300">Error: {err}</div>}
      </div>

      <div className="mt-4 h-[380px] rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" hide />
            <YAxis domain={["auto", "auto"]} />
            <Tooltip />
            <Legend />
            <ReferenceLine y={0} strokeDasharray="6 6" />
            <ReferenceLine y={2} strokeDasharray="6 6" />
            <ReferenceLine y={-2} strokeDasharray="6 6" />
            <Line type="monotone" dataKey="z" dot={false} name="Z-Score" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </main>
  );
}
