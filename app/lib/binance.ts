export type Kline = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com",
  "https://data-api.binance.vision",
];

async function fetchJsonWithFallback(
  path: string,
  params: Record<string, string>
): Promise<any> {
  let lastErr: any = null;

  for (const host of BINANCE_HOSTS) {
    try {
      const url = new URL(path, host);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

      const res = await fetch(url.toString(), { cache: "no-store" });

      if (!res.ok) {
        lastErr = new Error(`Binance REST error ${res.status} via ${host}`);
        continue;
      }

      return await res.json();
    } catch (e) {
      lastErr = e;
      continue;
    }
  }

  throw lastErr ?? new Error("Binance REST error (all hosts failed)");
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number
): Promise<Kline[]> {
  const data = (await fetchJsonWithFallback("/api/v3/klines", {
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(limit),
  })) as any[];

  return data.map((d) => ({
    openTime: Number(d[0]),
    closeTime: Number(d[6]),
    open: Number(d[1]),
    high: Number(d[2]),
    low: Number(d[3]),
    close: Number(d[4]),
    volume: Number(d[5]),
  }));
}

// NOTE:
// makeMiniTickerWs sengaja dihapus dulu biar aman di Vercel server runtime.
// Kalau nanti mau realtime di UI (client-side), kita bisa bikin file khusus client.
