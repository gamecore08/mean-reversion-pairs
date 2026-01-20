import { fetchKlines } from "../../../lib/binance";
import { zscoreSeries } from "../../../lib/stats";

export async function GET() {
  const btc = await fetchKlines("BTCUSDT", "1h", 200);
  const eth = await fetchKlines("ETHUSDT", "1h", 200);

  const spread = btc.map((b, i) => Math.log(b.close / eth[i].close));
  const z = zscoreSeries(spread, 168);

  return new Response(JSON.stringify({ btc, eth, spread, z }), {
    headers: { "Content-Type": "application/json" },
  });
}
