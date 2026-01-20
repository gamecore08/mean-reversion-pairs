import { fetchKlines } from "@/lib/binance";
import { zscore } from "@/lib/stats";

export async function GET() {
  const btc = await fetchKlines("BTCUSDT", "1h", 200);
  const eth = await fetchKlines("ETHUSDT", "1h", 200);

  const spread = btc.map((b, i) => Math.log(b.c / eth[i].c));
  const z = zscore(spread, 168);

  return Response.json({ btc, eth, spread, z });
}
