# Mean Reversion Pair Dashboard (Binance) — Vercel Ready ✅

Website dashboard mean-reversion **1 long + 1 short** (pair trading) dengan data **Binance**:
- History 1h diambil via **Binance REST** (`/api/v3/klines`)
- Realtime harga via **Binance WebSocket** (langsung dari browser pengguna)
- **Tidak pakai VPS**, **tidak pakai database**, **tidak menyimpan data** (hemat memory & biaya)

> Catatan: Karena realtime diambil via WebSocket di browser, dashboard ini cocok untuk **monitor & eksekusi manual**.
> Kalau mau **alert Telegram 24/7** tanpa membuka web, itu butuh proses background (worker/VPS/cron).

---

## 1) Cara jalankan lokal

1. Install Node.js (disarankan LTS).
2. Di folder project:

```bash
npm install
npm run dev
```

Buka: http://localhost:3000

---

## 2) Deploy ke Vercel (tanpa VPS)

### Opsi A — Upload ke GitHub lalu connect Vercel
1. Buat repo baru di GitHub.
2. Upload semua file project ini.
3. Masuk Vercel → **Add New → Project** → pilih repo.
4. Framework: Next.js (auto-detect)
5. Klik **Deploy**.

### Opsi B — Deploy langsung dari CLI Vercel
1. Install: `npm i -g vercel`
2. Login: `vercel login`
3. Deploy:

```bash
vercel
```

---

## 3) Cara pakai dashboard

- Isi **Leg A** (default BTCUSDT)
- Isi **Leg B** (altcoin contoh: ETHUSDT, SOLUSDT, OPUSDT, ARBUSDT, AVAXUSDT)
- Timeframe: default **1h**
- `History bars`: default 720 (30 hari untuk 1h)
- `Lookback Z`: window rolling mean/std (default 240)
- `Lookback β`: window regresi untuk hedge ratio (default 240)
- Entry/Exit: default entry 2.0σ, exit 0.5σ

Rule di UI:
- Z >= +Entry → **Short A, Long B**
- Z <= -Entry → **Long A, Short B**
- Exit saat |Z| <= Exit

---

## 4) Kenapa ini “irit”?

- Vercel hanya host UI (static + client compute)
- Serverless tidak menjaga websocket.
- WebSocket **langsung** dari browser ke Binance (`wss://stream.binance.com:9443/ws/...`)
- Tidak ada database, tidak ada redis, tidak ada cron

---

## 5) Limitasi / risiko

- Saat kamu close tab, realtime berhenti (normal).
- Pair trading bisa gagal pada:
  - bull parabolik / trend kuat
  - narrative shift
  - fundamental break (hack/delist)
- Binance rate limit: jangan refresh terlalu sering atau pakai terlalu banyak pair sekaligus.

---

## 6) Kustom cepat

File utama:
- `app/page.tsx` → UI + logic Z-score
- `app/lib/binance.ts` → REST + websocket
- `app/lib/stats.ts` → mean/stdev/corr/regression

Stop rule (contoh sederhana) ada di `derived.stopZ` di `page.tsx`.
Silakan ubah jadi:
- time stop (misal max 48 jam)
- trailing exit (misal exit saat Z cross 0)
- filter trend (misal MA200)
- filter korelasi minimal

---

## Disclaimer
Edukasi, bukan saran investasi.


## Screener (Altcoin vs BTC)

Open: `http://localhost:3000/screener`

- Scans a small universe of USDT pairs vs BTC.
- Metrics: correlation, hedge ratio (beta), lightweight cointegration check (ADF t-stat), and current Z-score.
- Click **Trade** to open the main dashboard with the selected pair.

### Auto Mode

Di halaman screener ada mode otomatis:
- **STRONG + Z ready saja** (default ON): hanya tampilkan pair yang kualitasnya STRONG dan **|Z| >= Entry**.
- **Auto-refresh** (default ON): refresh hasil screener tiap **15 menit** (client-side, tetap tanpa VPS).
- Tombol **Open Best Trade** membuka pair STRONG teratas langsung ke dashboard utama.

## Price Movement (% Normalized)

Di dashboard utama, chart price dibuat dalam bentuk **% dari titik awal (0%)** untuk kedua leg.
Ini memudahkan melihat siapa yang outperform/underperform dan membaca "spread" secara visual.
# mean-reversion-pairs
