"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, ReferenceLine
} from "recharts";
import { fetchKlines, makeMiniTickerWs } from "./lib/binance";
import { corr, mean, olsSlopeIntercept, stdev } from "./lib/stats";

export default function PageClient() {
  const sp = useSearchParams();

  const [symbolA, setSymbolA] = useState("BTCUSDT");
  const [symbolB, setSymbolB] = useState("ETHUSDT");
  const [interval, setInterval] = useState("1h");
  const [historyBars] = useState(720);

  useEffect(() => {
    const a = sp.get("a");
    const b = sp.get("b");
    if (a) setSymbolA(a.toUpperCase());
    if (b) setSymbolB(b.toUpperCase());
  }, [sp]);

  const [points, setPoints] = useState<any[]>([]);
  const [lastA, setLastA] = useState<number | null>(null);
  const [lastB, setLastB] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [ka, kb] = await Promise.all([
        fetchKlines(symbolA, interval, historyBars),
        fetchKlines(symbolB, interval, historyBars),
      ]);

      const n = Math.min(ka.length, kb.length);
      const A = ka.slice(-n).map(k => k.close);
      const B = kb.slice(-n).map(k => k.close);

      const { beta } = olsSlopeIntercept(
        B.map(Math.log),
        A.map(Math.log)
      );

      const out = [];
      for (let i = 0; i < n; i++) {
        out.push({
          t: ka[i].closeTime,
          z: (Math.log(A[i]) - beta * Math.log(B[i]))
        });
      }

      const m = mean(out.map(o => o.z));
      const sd = stdev(out.map(o => o.z));

      out.forEach(o => o.z = (o.z - m) / sd);

      setPoints(out);
      setLastA(A[A.length - 1]);
      setLastB(B[B.length - 1]);
    })();
  }, [symbolA, symbolB, interval]);

  const signal =
    points.length === 0 ? "WAIT" :
    points.at(-1).z > 2 ? `SHORT ${symbolA} / LONG ${symbolB}` :
    points.at(-1).z < -2 ? `LONG ${symbolA} / SHORT ${symbolB}` :
    "WAIT";

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Mean Reversion Pair</h1>
      <p className="mb-4 text-zinc-400">
        Signal: <b>{signal}</b>
      </p>

      <div className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" />
            <YAxis />
            <Tooltip />
            <ReferenceLine y={0} />
            <ReferenceLine y={2} stroke="red" />
            <ReferenceLine y={-2} stroke="green" />
            <Line dataKey="z" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-4 text-sm text-zinc-500">
        Live prices: {symbolA} = {lastA?.toFixed(2)} | {sy
