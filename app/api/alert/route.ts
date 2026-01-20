import { sendTelegram } from "../../lib/telegram";
import { fetchKlines } from "../../lib/binance";
import { zscoreSeries } from "../../lib/stats";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    if (process.env.ALERT_SECRET && url.searchParams.get("secret") !== process.env.ALERT_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    await sendTelegram("✅ TEST: Telegram alert route OK");

    const btc = await fetchKlines("BTCUSDT", "1h", 200);
    const eth = await fetchKlines("ETHUSDT", "1h", 200);

    const n = Math.min(btc.length, eth.length);
    const btc2 = btc.slice(-n);
    const eth2 = eth.slice(-n);

    const spread = btc2.map((b, i) => Math.log(b.close / eth2[i].close));
    const z = zscoreSeries(spread, 168);

    const prev = z[z.length - 2];
    const cur = z[z.length - 1];

    if (!Number.isFinite(prev) || !Number.isFinite(cur)) {
      return new Response(JSON.stringify({ z: cur }), { headers: { "Content-Type": "application/json" } });
    }

    if (prev < 2 && cur >= 2) await sendTelegram(`ENTRY SHORT BTC / LONG ETH | z=${cur.toFixed(2)}`);
    if (prev > -2 && cur <= -2) await sendTelegram(`ENTRY LONG BTC / SHORT ETH | z=${cur.toFixed(2)}`);
    if (Math.abs(prev) > 0.7 && Math.abs(cur) <= 0.7) await sendTelegram(`EXIT | z=${cur.toFixed(2)}`);
    if (Math.abs(prev) < 3 && Math.abs(cur) >= 3) await sendTelegram(`RISK | z=${cur.toFixed(2)}`);

    return new Response(JSON.stringify({ z: cur }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
