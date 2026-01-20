import { sendTelegram } from "@/lib/telegram";
import { fetchKlines } from "@/lib/binance";
import { zscore } from "@/lib/stats";

export async function GET(req: Request) {
  const url = new URL(req.url);

  // optional secret protection
  if (process.env.ALERT_SECRET && url.searchParams.get("secret") !== process.env.ALERT_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const btc = await fetchKlines("BTCUSDT", "1h", 200);
  const eth = await fetchKlines("ETHUSDT", "1h", 200);

  const spread = btc.map((b, i) => Math.log(b.c / eth[i].c));
  const z = zscore(spread, 168);

  const prev = z[z.length - 2];
  const cur = z[z.length - 1];

  if (prev < 2 && cur >= 2) await sendTelegram(`ENTRY SHORT BTC / LONG ETH | z=${cur.toFixed(2)}`);
  if (prev > -2 && cur <= -2) await sendTelegram(`ENTRY LONG BTC / SHORT ETH | z=${cur.toFixed(2)}`);
  if (Math.abs(prev) > 0.7 && Math.abs(cur) <= 0.7) await sendTelegram(`EXIT | z=${cur.toFixed(2)}`);
  if (Math.abs(prev) < 3 && Math.abs(cur) >= 3) await sendTelegram(`RISK | z=${cur.toFixed(2)}`);

  return Response.json({ z: cur });
}
