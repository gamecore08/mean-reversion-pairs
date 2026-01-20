import { fetchKlines } from "../../lib/binance";
import { zscoreSeries } from "../../lib/stats";

export async function GET() {
  try {
    const btc = await fetchKlines("BTCUSDT", "1h", 200);
    const eth = await fetchKlines("ETHUSDT", "1h", 200);

    const n = Math.min(btc.length, eth.length);
    const btc2 = btc.slice(-n);
    const eth2 = eth.slice(-n);

    const spread = btc2.map((b, i) => Math.log(b.close / eth2[i].close));
    const z = zscoreSeries(spread, 168);

    return new Response(JSON.stringify({ btc: btc2, eth: eth2, spread, z }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
