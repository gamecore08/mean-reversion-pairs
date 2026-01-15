"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { fetchKlines, makeMiniTickerWs } from "./lib/binance";
import { corr, mean, olsSlopeIntercept, stdev } from "./lib/stats";

type Point = {
  t: number; // closeTime ms
  A: number;
  B: number;
  spread: number;
  z: number;
};

function fmtTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function safeLn(x: number) {
  return Math.log(Math.max(x, 1e-12));
}

export default function Home() {
  // Defaults: BTC vs ETH
  const [symbolA, setSymbolA] = useState("BTCUSDT"); // leg A
  const [symbolB, setSymbolB] = useState("ETHUSDT"); // leg B (altcoin)
  
  const sp = useSearchParams();

  useEffect(() => {
    const qa = sp.get("a");
    const qb = sp.get("b");
    if (qa) setSymbolA(qa.toUpperCase());
    if (qb) setSymbolB(qb.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
const [interval, setInterval] = useState("1h");
  const [historyBars, setHistoryBars] = useState(720); // last 30 days of 1h
  const [lookbackZ, setLookbackZ] = useState(240); // rolling mean/std window (10 days on 1h)
  const [lookbackBeta, setLookbackBeta] = useState(240);
  const [entryZ, setEntryZ] = useState(2.0);
  const [exitZ, setExitZ] = useState(0.5);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [points, setPoints] = useState<Point[]>([]);
  const [lastPriceA, setLastPriceA] = useState<number | null>(null);
  const [lastPriceB, setLastPriceB] = useState<number | null>(null);

  const wsA = useRef<WebSocket | null>(null);
  const wsB = useRef<WebSocket | null>(null);

  // Load historical data (REST)
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);
      try {
        const [ka, kb] = await Promise.all([
          fetchKlines(symbolA, interval, historyBars),
          fetchKlines(symbolB, interval, historyBars),
        ]);
        if (cancelled) return;

        const n = Math.min(ka.length, kb.length);
        const closesA = ka.slice(-n).map(k => k.close);
        const closesB = kb.slice(-n).map(k => k.close);

        // Use log-prices for beta regression
        const x = closesB.map(safeLn); // x = ln(B)
        const y = closesA.map(safeLn); // y = ln(A)

        // beta is computed on last lookbackBeta window (default 240)
        const lb = Math.min(lookbackBeta, n);
        const { beta } = olsSlopeIntercept(x.slice(-lb), y.slice(-lb));

        // Build points with rolling Z on spread = ln(A) - beta*ln(B)
        const out: Point[] = [];
        for (let i = 0; i < n; i++) {
          const t = ka[ka.length - n + i].closeTime;
          const spread = safeLn(closesA[i]) - beta * safeLn(closesB[i]);
          out.push({ t, A: closesA[i], B: closesB[i], spread, z: 0 });
        }

        // rolling z-score on spread
        const zlb = Math.min(lookbackZ, out.length);
        for (let i = 0; i < out.length; i++) {
          const start = Math.max(0, i - zlb + 1);
          const window = out.slice(start, i + 1).map(p => p.spread);
          const m = mean(window);
          const sd = stdev(window);
          out[i].z = sd && Number.isFinite(sd) && sd > 0 ? (out[i].spread - m) / sd : 0;
        }

        // update last
        setLastPriceA(closesA[closesA.length - 1]);
        setLastPriceB(closesB[closesB.length - 1]);

        setPoints(out);

        // correlation on returns (rough check)
        const retsA = [];
        const retsB = [];
        for (let i = 1; i < n; i++) {
          retsA.push(Math.log(closesA[i] / closesA[i - 1]));
          retsB.push(Math.log(closesB[i] / closesB[i - 1]));
        }
        const rho = corr(retsA, retsB);
        console.log("corr(returns):", rho, "beta:", beta);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [symbolA, symbolB, interval, historyBars, lookbackZ, lookbackBeta]);

  // Realtime websocket (client-side) updates last candle price only (no persistence)
  useEffect(() => {
    // cleanup old
    wsA.current?.close();
    wsB.current?.close();
    wsA.current = null;
    wsB.current = null;

    const a = symbolA.toLowerCase();
    const b = symbolB.toLowerCase();

    const wsa = makeMiniTickerWs(a);
    const wsb = makeMiniTickerWs(b);
    wsA.current = wsa;
    wsB.current = wsb;

    wsa.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        // miniTicker has: c = close price (string)
        const px = Number(msg?.c);
        if (Number.isFinite(px)) setLastPriceA(px);
      } catch {}
    };
    wsb.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        const px = Number(msg?.c);
        if (Number.isFinite(px)) setLastPriceB(px);
      } catch {}
    };

    // errors are normal sometimes
    wsa.onerror = () => {};
    wsb.onerror = () => {};

    return () => {
      wsa.close();
      wsb.close();
    };
  }, [symbolA, symbolB]);

  // Compute current signal from latest prices + current beta (recomputed from history points)
  const derived = useMemo(() => {
    if (points.length < 10 || lastPriceA == null || lastPriceB == null) return null;

    // Recompute beta from last lookbackBeta of history using closes in points (log)
    const n = points.length;
    const lb = Math.min(lookbackBeta, n);
    const x = points.slice(-lb).map(p => safeLn(p.B));
    const y = points.slice(-lb).map(p => safeLn(p.A));
    const { beta } = olsSlopeIntercept(x, y);

    const spreadNow = safeLn(lastPriceA) - beta * safeLn(lastPriceB);

    const zlb = Math.min(lookbackZ, points.length);
    const window = points.slice(-zlb).map(p => p.spread);
    const m = mean(window);
    const sd = stdev(window) || 0;
    const z = sd > 0 ? (spreadNow - m) / sd : 0;

    // Signal rules:
    // z > entryZ: A expensive vs B => Short A, Long B
    // z < -entryZ: A cheap vs B => Long A, Short B
    let action: "WAIT" | "LONG_A_SHORT_B" | "SHORT_A_LONG_B" = "WAIT";
    if (z >= entryZ) action = "SHORT_A_LONG_B";
    else if (z <= -entryZ) action = "LONG_A_SHORT_B";

    // A simple "target" is z -> 0 and stop if z beyond entryZ+1 (example)
    const stopZ = entryZ + 1.0;

    return { beta, spreadNow, z, m, sd, action, stopZ };
  }, [points, lastPriceA, lastPriceB, lookbackBeta, lookbackZ, entryZ]);

  const zSeries = useMemo(() => {
    return points.map(p => ({ t: p.t, z: p.z }));
  }, [points]);

  const priceSeries = useMemo(() => {
    return points.map(p => ({ t: p.t, A: p.A, B: p.B }));
  }, [points]);

  // Normalize prices into % change from the first visible point.
  // This helps you see relative performance and "spread" visually.
  const percentSeries = useMemo(() => {
    if (points.length === 0) return [] as Array<{ t: number; A_pct: number; B_pct: number; rel: number }>;
    const a0 = points[0].A;
    const b0 = points[0].B;
    if (!Number.isFinite(a0) || !Number.isFinite(b0) || a0 <= 0 || b0 <= 0) {
      return points.map(p => ({ t: p.t, A_pct: 0, B_pct: 0, rel: 0 }));
    }
    return points.map(p => {
      const A_pct = ((p.A / a0) - 1) * 100;
      const B_pct = ((p.B / b0) - 1) * 100;
      const rel = A_pct - B_pct; // simple relative performance
      return { t: p.t, A_pct, B_pct, rel };
    });
  }, [points]);

  const lastZ = derived?.z ?? 0;
  const badge = derived?.action === "SHORT_A_LONG_B" ? "STRONG SELL (A) / BUY (B)" :
                derived?.action === "LONG_A_SHORT_B" ? "STRONG BUY (A) / SELL (B)" : "WAIT";

  const conclusion = derived?.action === "SHORT_A_LONG_B"
    ? `KESIMPULAN: SHORT ${symbolA} + LONG ${symbolB}`
    : derived?.action === "LONG_A_SHORT_B"
      ? `KESIMPULAN: LONG ${symbolA} + SHORT ${symbolB}`
      : "KESIMPULAN: WAIT (belum ada entry)";

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="flex flex-col gap-2 mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold">Mean Reversion Pair (Binance) — 1 Long + 1 Short</h1>
        <p className="text-zinc-300">
          Semua kalkulasi di browser (client-side): ambil history via REST + update realtime via WebSocket Binance. Tidak simpan database, tidak perlu VPS.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm text-zinc-300 mb-2">Pair</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400">Leg A (biasanya BTC)</label>
              <input value={symbolA} onChange={e => setSymbolA(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Leg B (Altcoin)</label>
              <input value={symbolB} onChange={e => setSymbolB(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Timeframe</label>
              <select value={interval} onChange={e => setInterval(e.target.value)}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600">
                <option value="1h">1h</option>
                <option value="30m">30m</option>
                <option value="15m">15m</option>
                <option value="4h">4h</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400">History bars</label>
              <input type="number" min={100} max={1000} value={historyBars} onChange={e => setHistoryBars(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400">Lookback Z</label>
              <input type="number" min={50} max={1000} value={lookbackZ} onChange={e => setLookbackZ(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Lookback β</label>
              <input type="number" min={50} max={1000} value={lookbackBeta} onChange={e => setLookbackBeta(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Entry |Z|</label>
              <input type="number" step="0.1" min={0.5} max={5} value={entryZ} onChange={e => setEntryZ(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Exit |Z|</label>
              <input type="number" step="0.1" min={0} max={3} value={exitZ} onChange={e => setExitZ(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600" />
            </div>
          </div>

          {err && <div className="mt-3 text-sm text-red-300">Error: {err}</div>}
          {loading && <div className="mt-3 text-sm text-zinc-300">Loading data…</div>}
          <div className="mt-3 text-xs text-zinc-400">
            Tips: simbol harus ada di Binance Spot (contoh: BTCUSDT, ETHUSDT, SOLUSDT, OPUSDT, ARBUSDT, AVAXUSDT).
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-zinc-300">Trading Signal</div>
              <div className="mt-1 text-xl font-semibold">{badge}</div>
              <div className="mt-2 text-sm font-semibold text-zinc-100">{conclusion}</div>
              <div className="mt-2 text-sm text-zinc-300">
                Z-Score sekarang: <span className="font-semibold">{lastZ.toFixed(2)}σ</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-400">Realtime prices</div>
              <div className="mt-1 text-sm">{symbolA}: <span className="font-semibold">{lastPriceA?.toFixed(2) ?? "-"}</span></div>
              <div className="text-sm">{symbolB}: <span className="font-semibold">{lastPriceB?.toFixed(2) ?? "-"}</span></div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-400">Hedge ratio (β)</div>
              <div className="text-lg font-semibold">{derived?.beta?.toFixed(3) ?? "-"}</div>
              <div className="text-xs text-zinc-500">β dari regresi ln(A) terhadap ln(B) pada lookback β.</div>
            </div>
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-400">Spread sekarang</div>
              <div className="text-lg font-semibold">{derived ? derived.spreadNow.toFixed(5) : "-"}</div>
              <div className="text-xs text-zinc-500">Spread = ln(A) − β·ln(B)</div>
            </div>
          </div>

          <div className="mt-4 text-sm text-zinc-300">
            <div className="font-semibold mb-1">Rule eksekusi (simultan)</div>
            <ul className="list-disc ml-5 space-y-1 text-zinc-300">
              <li>Jika Z ≥ +{entryZ}: <b>Short {symbolA}</b>, <b>Long {symbolB}</b></li>
              <li>Jika Z ≤ -{entryZ}: <b>Long {symbolA}</b>, <b>Short {symbolB}</b></li>
              <li>Exit saat |Z| kembali ≤ {exitZ} (atau pakai trailing / time stop).</li>
              <li>Stop sederhana: jika |Z| ≥ {(entryZ + 1).toFixed(1)} (contoh, silakan ubah di kode).</li>
            </ul>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm text-zinc-300">Catatan penting (biar “irit” & aman)</div>
          <ul className="mt-2 list-disc ml-5 space-y-2 text-sm text-zinc-300">
            <li><b>Tanpa database</b>: data history di-fetch saat load, lalu dihitung di browser.</li>
            <li><b>Tanpa VPS</b>: realtime pakai WebSocket Binance langsung dari browser pengguna.</li>
            <li>Vercel hanya host UI. Tidak ada proses background 24/7.</li>
            <li>Jika butuh alert Telegram otomatis 24/7, itu memang butuh worker/server yang jalan terus (VPS/Cloud Run/Upstash/cron). Tapi website ini fokus “dashboard manual”.</li>
            <li>Gunakan <b>isolated margin / leverage kecil</b>. Pair trading bisa gagal saat narrative shift / trend parabolik.</li>
          </ul>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-zinc-300">Price Movement (% Normalized)</div>
            <div className="text-xs text-zinc-500">Last {historyBars} bars • {interval}</div>
          </div>
          <div className="h-[360px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={percentSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v)} minTickGap={30} />
                <YAxis domain={["auto", "auto"]} />
                <Tooltip labelFormatter={(v) => fmtTime(Number(v))} />
                <Legend />
                <ReferenceLine y={0} strokeDasharray="6 6" />
                <Line type="monotone" dataKey="A_pct" dot={false} name={`${symbolA} %`} strokeWidth={2} />
                <Line type="monotone" dataKey="B_pct" dot={false} name={`${symbolB} %`} strokeWidth={2} />
                <Line type="monotone" dataKey="rel" dot={false} name="A% - B%" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 text-xs text-zinc-400">
            Semua garis dinormalisasi dari titik pertama (0%). Garis <b>A% - B%</b> membantu lihat selisih performa (proxy spread visual).
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-zinc-300">Spread Z-Score</div>
            <div className="text-xs text-zinc-500">Entry ±{entryZ}σ</div>
          </div>
          <div className="h-[360px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={zSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={(v) => fmtTime(v)} minTickGap={30} />
                <YAxis domain={["auto", "auto"]} />
                <Tooltip labelFormatter={(v) => fmtTime(Number(v))} />
                <Legend />
                <ReferenceLine y={0} strokeDasharray="6 6" />
                <ReferenceLine y={entryZ} strokeDasharray="6 6" />
                <ReferenceLine y={-entryZ} strokeDasharray="6 6" />
                <Line type="monotone" dataKey="z" dot={false} name="Z-Score" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 text-xs text-zinc-400">
            Perhitungan: spread = ln(A) − β·ln(B). Z-score rolling dari spread (lookback Z).
          </div>
        </div>
      </section>

      <footer className="mt-10 text-xs text-zinc-500">
        Disclaimer: ini contoh edukasi, bukan saran investasi. Binance API rate-limit berlaku.
      </footer>
    </main>
  );
}
