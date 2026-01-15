'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { useSearchParams } from 'next/navigation';
import { fetchKlines, makeMiniTickerWs } from './lib/binance';
import { corr, mean, olsSlopeIntercept, stdev } from './lib/stats';

type Point = {
  t: number; // closeTime ms
  A: number;
  B: number;
  spread: number;
  z: number;
};

function fmtTime(ms: number) {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function safeLn(x: number) {
  return Math.log(Math.max(x, 1e-12));
}
function fmtNum(x: number) {
  try {
    return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch {
    return String(x);
  }
}

export default function PageClient() {
  // Defaults: BTC vs ETH
  const [symbolA, setSymbolA] = useState('BTCUSDT'); // leg A
  const [symbolB, setSymbolB] = useState('ETHUSDT'); // leg B (altcoin)

  const sp = useSearchParams();
  useEffect(() => {
    const qa = sp.get('a');
    const qb = sp.get('b');
    if (qa) setSymbolA(qa.toUpperCase());
    if (qb) setSymbolB(qb.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const [interval, setInterval] = useState('1h');
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
        const closesA = ka.slice(-n).map((k) => k.close);
        const closesB = kb.slice(-n).map((k) => k.close);

        // Use log-prices for beta regression
        const x = closesB.map(safeLn); // x = ln(B)
        const y = closesA.map(safeLn); // y = ln(A)

        const lb = Math.min(lookbackBeta, n);
        const { beta } = olsSlopeIntercept(x.slice(-lb), y.slice(-lb));

        const out: Point[] = [];
        for (let i = 0; i < n; i++) {
          const t = ka[ka.length - n + i].closeTime;
          const spread = safeLn(closesA[i]) - beta * safeLn(closesB[i]);
          out.push({ t, A: closesA[i], B: closesB[i], spread, z: 0 });
        }

        const zlb = Math.min(lookbackZ, out.length);
        for (let i = 0; i < out.length; i++) {
          const start = Math.max(0, i - zlb + 1);
          const window = out.slice(start, i + 1).map((p) => p.spread);
          const m = mean(window);
          const sd = stdev(window);
          out[i].z = sd && Number.isFinite(sd) && sd > 0 ? (out[i].spread - m) / sd : 0;
        }

        setLastPriceA(closesA[closesA.length - 1]);
        setLastPriceB(closesB[closesB.length - 1]);
        setPoints(out);

        // (optional) correlation check
        const retsA: number[] = [];
        const retsB: number[] = [];
        for (let i = 1; i < n; i++) {
          retsA.push(Math.log(closesA[i] / closesA[i - 1]));
          retsB.push(Math.log(closesB[i] / closesB[i - 1]));
        }
        console.log('corr(returns):', corr(retsA, retsB), 'beta:', beta);
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
  }, [symbolA, symbolB, interval, historyBars, lookbackZ, lookbackBeta]);

  // Realtime websocket (client-side)
  useEffect(() => {
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

    wsa.onerror = () => {};
    wsb.onerror = () => {};
    return () => {
      wsa.close();
      wsb.close();
    };
  }, [symbolA, symbolB]);

  const derived = useMemo(() => {
    if (points.length < 10 || lastPriceA == null || lastPriceB == null) return null;

    const n = points.length;
    const lb = Math.min(lookbackBeta, n);
    const x = points.slice(-lb).map((p) => safeLn(p.B));
    const y = points.slice(-lb).map((p) => safeLn(p.A));
    const { beta } = olsSlopeIntercept(x, y);

    const spreadNow = safeLn(lastPriceA) - beta * safeLn(lastPriceB);

    const zlb = Math.min(lookbackZ, points.length);
    const window = points.slice(-zlb).map((p) => p.spread);
    const m = mean(window);
    const sd = stdev(window) || 0;
    const z = sd > 0 ? (spreadNow - m) / sd : 0;

    let action: 'WAIT' | 'LONG_A_SHORT_B' | 'SHORT_A_LONG_B' = 'WAIT';
    if (z >= entryZ) action = 'SHORT_A_LONG_B';
    else if (z <= -entryZ) action = 'LONG_A_SHORT_B';

    return { beta, spreadNow, z, m, sd, action };
  }, [points, lastPriceA, lastPriceB, lookbackBeta, lookbackZ, entryZ]);

  const zSeries = useMemo(() => points.map((p) => ({ t: p.t, z: p.z })), [points]);
  const priceSeries = useMemo(() => points.map((p) => ({ t: p.t, A: p.A, B: p.B })), [points]);

  const badge =
    derived?.action === 'SHORT_A_LONG_B'
      ? 'STRONG SELL (A) / BUY (B)'
      : derived?.action === 'LONG_A_SHORT_B'
      ? 'STRONG BUY (A) / SELL (B)'
      : 'WAIT';

  const conclusion =
    derived?.action === 'SHORT_A_LONG_B'
      ? `KESIMPULAN: SHORT ${symbolA} + LONG ${symbolB}`
      : derived?.action === 'LONG_A_SHORT_B'
      ? `KESIMPULAN: LONG ${symbolA} + SHORT ${symbolB}`
      : 'KESIMPULAN: WAIT (belum ada entry)';

  const lastZ = derived?.z ?? 0;

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-8">
      <header className="flex flex-col gap-2 mb-6">
        <h1 className="text-2xl md:text-3xl font-semibold">Mean Reversion Pair</h1>
        <p className="text-zinc-300">
          History via REST (Binance) + realtime via WebSocket (browser). Tidak simpan DB, tidak perlu VPS.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm text-zinc-300 mb-2">Pair</div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400">Pair A</label>
              <input
                value={symbolA}
                onChange={(e) => setSymbolA(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Pair B</label>
              <input
                value={symbolB}
                onChange={(e) => setSymbolB(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Timeframe</label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              >
                <option value="1h">1h</option>
                <option value="30m">30m</option>
                <option value="15m">15m</option>
                <option value="4h">4h</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-zinc-400">History bars</label>
              <input
                type="number"
                min={100}
                max={1000}
                value={historyBars}
                onChange={(e) => setHistoryBars(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-zinc-400">Lookback Z</label>
              <input
                type="number"
                min={50}
                max={1000}
                value={lookbackZ}
                onChange={(e) => setLookbackZ(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Lookback β</label>
              <input
                type="number"
                min={50}
                max={1000}
                value={lookbackBeta}
                onChange={(e) => setLookbackBeta(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Entry |Z|</label>
              <input
                type="number"
                step="0.1"
                min={0.5}
                max={5}
                value={entryZ}
                onChange={(e) => setEntryZ(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400">Exit |Z|</label>
              <input
                type="number"
                step="0.1"
                min={0}
                max={3}
                value={exitZ}
                onChange={(e) => setExitZ(Number(e.target.value))}
                className="mt-1 w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          {err && <div className="mt-3 text-sm text-red-300">Error: {err}</div>}
          {loading && <div className="mt-3 text-sm text-zinc-300">Loading data…</div>}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-zinc-300">Trading Signal</div>
              <div className="mt-1 text-xl font-semibold">{badge}</div>
              <div className="mt-2 text-sm font-semibold text-zinc-100">{conclusion}</div>
              <div className="mt-2 text-sm text-zinc-300">
                Z sekarang: <span className="font-semibold">{lastZ.toFixed(2)}σ</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-zinc-400">Realtime</div>
              <div className="mt-1 text-sm">
                {symbolA}: <span className="font-semibold">{lastPriceA ? fmtNum(lastPriceA) : '-'}</span>
              </div>
              <div className="text-sm">
                {symbolB}: <span className="font-semibold">{lastPriceB ? fmtNum(lastPriceB) : '-'}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-400">β (hedge ratio)</div>
              <div className="text-lg font-semibold">{derived?.beta?.toFixed(3) ?? '-'}</div>
            </div>
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-400">Spread sekarang</div>
              <div className="text-lg font-semibold">{derived ? derived.spreadNow.toFixed(5) : '-'}</div>
              <div className="text-xs text-zinc-500">ln(A) − β·ln(B)</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm text-zinc-300">Rule</div>
          <ul className="mt-2 list-disc ml-5 space-y-2 text-sm text-zinc-300">
            <li>
              Jika Z ≥ +{entryZ}: <b>Short {symbolA}</b>, <b>Long {symbolB}</b>
            </li>
            <li>
              Jika Z ≤ -{entryZ}: <b>Long {symbolA}</b>, <b>Short {symbolB}</b>
            </li>
            <li>Exit saat |Z| ≤ {exitZ}</li>
          </ul>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Z-score */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-zinc-300">Spread Z-Score</div>
            <div className="text-xs text-zinc-500">Entry ±{entryZ}σ</div>
          </div>
          <div className="h-[360px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={zSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={(v) => fmtTime(Number(v))} minTickGap={30} />
                <YAxis domain={['auto', 'auto']} />
                <Tooltip labelFormatter={(v) => fmtTime(Number(v))} />
                <Legend />
                <ReferenceLine y={0} strokeDasharray="6 6" />
                <ReferenceLine y={entryZ} strokeDasharray="6 6" />
                <ReferenceLine y={-entryZ} strokeDasharray="6 6" />
                <Line type="monotone" dataKey="z" dot={false} name="Z-Score" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Price movement: dual-axis like your screenshot */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-zinc-300">Price Movement (Dual Axis)</div>
            <div className="text-xs text-zinc-500">Last {historyBars} bars • {interval}</div>
          </div>
          <div className="h-[360px] mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={priceSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={(v) => fmtTime(Number(v))} minTickGap={30} />

                {/* Left axis = Pair A price */}
                <YAxis
                  yAxisId="left"
                  orientation="left"
                  tickFormatter={(v) => fmtNum(Number(v))}
                  width={72}
                  domain={['auto', 'auto']}
                />

                {/* Right axis = Pair B price */}
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={(v) => fmtNum(Number(v))}
                  width={72}
                  domain={['auto', 'auto']}
                />

                <Tooltip
                  labelFormatter={(v) => fmtTime(Number(v))}
                  formatter={(value: any, name: any) => [fmtNum(Number(value)), name]}
                />
                <Legend />

                <Line yAxisId="left" type="monotone" dataKey="A" dot={false} name={symbolA} strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="B" dot={false} name={symbolB} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 text-xs text-zinc-400">
            Kiri = harga {symbolA}, kanan = harga {symbolB}. (Mirip screenshot kamu)
          </div>
        </div>
      </section>

      <footer className="mt-10 text-xs text-zinc-500">Disclaimer: edukasi, bukan saran investasi. Binance rate-limit berlaku.</footer>
    </main>
  );
}
