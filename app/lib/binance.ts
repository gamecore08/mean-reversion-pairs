export type Kline = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BINANCE_REST = "https://api.binance.com";

export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const url = new URL("/api/v3/klines", BINANCE_REST);
  url.searchParams.set("symbol", symbol.toUpperCase());
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Binance REST error ${res.status}`);
  const data = (await res.json()) as any[];

  // Kline array format:
  // [
  //  0 open time,
  //  1 open,
  //  2 high,
  //  3 low,
  //  4 close,
  //  5 volume,
  //  6 close time, ...
  // ]
  return data.map(d => ({
    openTime: Number(d[0]),
    closeTime: Number(d[6]),
    open: Number(d[1]),
    high: Number(d[2]),
    low: Number(d[3]),
    close: Number(d[4]),
    volume: Number(d[5]),
  }));
}

/**
 * Browser-side websocket for realtime (no VPS).
 * Uses "miniTicker" stream for each symbol.
 *
 * Example: wss://stream.binance.com:9443/ws/btcusdt@miniTicker
 */
export function makeMiniTickerWs(symbolLower: string): WebSocket {
  const url = `wss://stream.binance.com:9443/ws/${symbolLower}@miniticker`;
  return new WebSocket(url);
}
